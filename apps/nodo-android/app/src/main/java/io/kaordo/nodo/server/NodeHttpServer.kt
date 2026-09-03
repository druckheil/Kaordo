package io.kaordo.nodo.server

import io.kaordo.nodo.storage.TusUploadStore
import io.kaordo.nodo.storage.FluoPostStore
import io.kaordo.nodo.storage.RondoMessageStore
import io.kaordo.nodo.storage.LigoEnvelopeStore
import io.kaordo.nodo.data.NodeAccessClient.AccessGrant
import io.kaordo.nodo.model.NodePolicy
import io.kaordo.nodo.model.DiskBenchmark
import io.kaordo.nodo.model.NodeMetrics
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.thread
import kotlin.concurrent.read
import kotlin.concurrent.write

class NodeHttpServer(
    private val port: Int,
    private val spaces: Map<NodeSpace, SpaceStorage>,
    private val authorize: (String, String?) -> AccessGrant?,
    private val authorizeRondo: ((String, String?, String?) -> AccessGrant?)? = null,
    private val policy: () -> NodePolicy,
    private val available: () -> Boolean,
    private val quickTest: () -> DiskBenchmark,
    private val metricsSnapshot: (() -> NodeMetrics)? = null,
    private val latencyTest: (() -> Long)? = null,
    private val onPublicPostDeleted: (String) -> Unit = {},
    private val onPublicReservationReleased: (String) -> Unit = {},
    private val onPublicStorageChanged: () -> Unit = {},
) {
    private val running = AtomicBoolean(false)
    private val clients = ThreadPoolExecutor(
        12,
        12,
        30,
        TimeUnit.SECONDS,
        ArrayBlockingQueue(64),
    )
    private val storageLock = ReentrantReadWriteLock(true)
    private val voiceHub = RondoVoiceHub()
    private var socket: ServerSocket? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val server = try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress("0.0.0.0", port))
            }
        } catch (error: Throwable) {
            running.set(false)
            throw error
        }
        socket = server
        thread(name = "nodo-http-accept", isDaemon = true) {
            while (running.get()) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                runCatching { clients.execute { handle(client) } }
                    .onFailure { runCatching { client.close() } }
            }
        }
    }

    fun stop() {
        running.set(false)
        runCatching { socket?.close() }
        socket = null
        clients.shutdownNow()
    }

    private fun handle(client: Socket) {
        client.use { connection ->
            // A dead upload must release its worker and store lock quickly so the
            // tus client can recover the persisted offset with HEAD.
            connection.soTimeout = 15_000
            runCatching {
                val input = BufferedInputStream(connection.getInputStream())
                val output = BufferedOutputStream(connection.getOutputStream())
                val request = readRequest(input) ?: return
                route(request, input, output)
                output.flush()
            }.onFailure { error ->
                runCatching {
                    val output = BufferedOutputStream(connection.getOutputStream())
                    if (error is BadRequest) {
                        writeJson(output, 400, "Bad Request", JSONObject().put("error", "Malformed request."))
                    } else {
                        writeJson(output, 500, "Internal Server Error", JSONObject().put("error", "Node request failed."))
                    }
                    output.flush()
                }
            }
        }
    }

    private fun route(request: HttpRequest, input: InputStream, output: BufferedOutputStream) {
        if (request.method == "OPTIONS") {
            writeResponse(output, 204, "No Content", tusHeaders() + mapOf(
                "Tus-Version" to TUS_VERSION,
                "Tus-Extension" to "creation,termination",
                "Tus-Max-Size" to (spaces.values.maxOfOrNull { it.uploads.quotaBytes() } ?: 0).toString(),
            ))
            return
        }
        if (request.method == "GET" && request.path == "/v1/health") {
            writeJson(output, 200, "OK", JSONObject()
                .put("status", "ok")
                .put("protocol", "tus/$TUS_VERSION"))
            return
        }
        val grant = authorized(request)
        if (grant == null) {
            writeJson(output, 401, "Unauthorized", JSONObject().put("error", "Authentication required."),
                mapOf("WWW-Authenticate" to "Bearer"))
            return
        }
        if (request.method == "POST" && request.path == "/v1/diagnostics/quick-test") {
            if (!grant.isOwner) return writeForbidden(output)
            runQuickTest(output)
            return
        }
        if (request.method == "POST" && request.path.startsWith("/v1/diagnostics/")) {
            if (!grant.isOwner) return writeForbidden(output)
            runFreshDiagnostic(request.path, output)
            return
        }
        if (request.method == "DELETE" && request.path == "/v1/storage") {
            if (!grant.isOwner) return writeForbidden(output)
            writeStorageClear(output, clearStorage())
            return
        }
        if (request.method == "DELETE" && request.path == "/v1/spaces/private/storage") {
            if (!grant.isOwner) return writeForbidden(output)
            writeStorageClear(output, clearSpace(NodeSpace.PRIVATE))
            return
        }
        if (!available() && request.path != "/v1/status") {
            writeJson(output, 503, "Service Unavailable", JSONObject().put("error", "Node policy has paused transfers."))
            return
        }
        if (request.method == "GET" && request.path == "/v1/status") {
            writeJson(output, 200, "OK", JSONObject()
                .put("status", "online")
                .put("port", port)
                .put("usedBytes", spaces.values.sumOf { it.uploads.usedBytes() })
                .put("uploadCount", spaces.values.sumOf { it.uploads.uploadCount() })
                .put("spaces", JSONObject().apply {
                    spaces.forEach { (space, storage) -> put(space.segment, JSONObject()
                        .put("quotaBytes", storage.uploads.quotaBytes())
                        .put("usedBytes", storage.uploads.usedBytes())
                        .put("uploadCount", storage.uploads.uploadCount())) }
                }))
            return
        }
        val storageItemsPath = STORAGE_ITEMS_PATH.matchEntire(request.path)
        if (storageItemsPath != null) {
            val space = NodeSpace.entries.first { it.segment == storageItemsPath.groupValues[1] }
            val kind = storageItemsPath.groupValues[2].takeIf { it.isNotBlank() }
            val id = storageItemsPath.groupValues[3].takeIf { it.isNotBlank() }
            val selected = storage(space)
            when {
                request.method == "GET" && kind == null -> {
                    if (!policy().allowDownloads) return transferDenied(output)
                    storageLock.read { listStorageItems(space, selected, grant, output) }
                }
                request.method == "DELETE" && kind != null && id != null -> {
                    storageLock.write { deleteStorageItem(space, selected, kind, id, grant, output) }
                }
                else -> methodNotAllowed(output)
            }
            return
        }
        val rondoPath = resolveRondoPath(request.path)
        if (rondoPath != null) {
            val scope = grant.rondo
            if (scope == null || scope.spaceId != rondoPath.spaceId || scope.roomId != rondoPath.roomId) {
                return writeForbidden(output)
            }
            val nodeSpace = if (scope.storage == NodeSpace.PUBLIC.segment) {
                NodeSpace.PUBLIC
            } else {
                NodeSpace.PRIVATE
            }
            val messages = storage(nodeSpace).messages
                ?: return writeJson(output, 503, "Service Unavailable", JSONObject().put("error", "Rondo storage is unavailable."))
            when {
                request.method == "GET" && rondoPath.messageId == null -> {
                    if (!policy().allowDownloads) return transferDenied(output)
                    storageLock.read { listRondoMessages(messages, scope.spaceId, scope.roomId, request, output) }
                }
                request.method == "POST" && rondoPath.messageId == null -> {
                    if (!policy().allowUploads) return transferDenied(output)
                    storageLock.write { createRondoMessage(messages, grant, request, input, output) }
                }
                request.method == "DELETE" && rondoPath.messageId != null -> {
                    if (!policy().allowUploads) return transferDenied(output)
                    storageLock.write {
                        deleteRondoMessage(messages, rondoPath.messageId, grant, output)
                    }
                }
                else -> writeJson(output, 405, "Method Not Allowed", JSONObject().put("error", "Method not allowed."))
            }
            return
        }
        val voicePath = resolveRondoVoicePath(request.path)
        if (voicePath != null) {
            val scope = grant.rondo
            if (scope == null || scope.spaceId != voicePath.spaceId || scope.roomId != voicePath.roomId) {
                return writeForbidden(output)
            }
            when (voicePath.action) {
                "join" -> if (request.method == "POST") {
                    joinRondoVoice(voicePath, grant, request, input, output)
                } else methodNotAllowed(output)
                "sync" -> if (request.method == "GET") {
                    syncRondoVoice(voicePath, request, output)
                } else methodNotAllowed(output)
                "peek" -> if (request.method == "GET") {
                    writeJson(output, 200, "OK", voiceJson(voiceHub.peek(voicePath.spaceId, voicePath.roomId)))
                } else methodNotAllowed(output)
                "signals" -> if (request.method == "POST") {
                    signalRondoVoice(voicePath, grant, request, input, output)
                } else methodNotAllowed(output)
                "leave" -> if (request.method == "DELETE") {
                    leaveRondoVoice(voicePath, grant, request, output)
                } else methodNotAllowed(output)
                else -> methodNotAllowed(output)
            }
            return
        }
        val envelopePath = resolveSpacePath(request.path, "/v1/ligo/envelopes", "/ligo/envelopes")
        val envelopeId = envelopePath?.remainder?.removePrefix("/")?.takeIf {
            envelopePath.remainder.startsWith('/') && !it.contains('/')
        }
        if (request.method == "POST" && envelopePath?.remainder == "") {
            if (!policy().allowUploads) return transferDenied(output)
            if (!canWrite(envelopePath.space, grant)) return writeForbidden(output)
            storageLock.write {
                createLigoEnvelope(storage(envelopePath.space).envelopes, grant, request, input, output)
            }
            if (envelopePath.space == NodeSpace.PUBLIC) onPublicStorageChanged()
            return
        }
        if (request.method == "GET" && envelopeId != null) {
            if (!policy().allowDownloads) return transferDenied(output)
            storageLock.read {
                readLigoEnvelope(storage(envelopePath.space).envelopes, envelopeId, grant, output)
            }
            return
        }
        if (request.method == "DELETE" && envelopeId != null) {
            storageLock.write {
                deleteLigoEnvelope(storage(envelopePath.space).envelopes, envelopeId, grant, output)
            }
            if (envelopePath.space == NodeSpace.PUBLIC) onPublicStorageChanged()
            return
        }
        if (request.method == "GET" && request.path == "/v1/fluo/state") {
            if (!policy().allowDownloads) return transferDenied(output)
            storageLock.read {
                writeJson(output, 200, "OK", JSONObject()
                    .put("spaces", JSONObject()
                        .put("private", fluoStateJson(storage(NodeSpace.PRIVATE).posts))
                        .put("public", fluoStateJson(storage(NodeSpace.PUBLIC).posts))))
            }
            return
        }
        val postPath = resolveSpacePath(request.path, "/v1/fluo/posts", "/fluo/posts")
        if (request.method == "GET" && postPath?.remainder == "") {
            if (!policy().allowDownloads) return transferDenied(output)
            storageLock.read { listFluoPosts(storage(postPath.space).posts, request, output) }
            return
        }
        if (request.method == "POST" && postPath?.remainder == "") {
            if (!policy().allowUploads) return transferDenied(output)
            if (!canWrite(postPath.space, grant)) return writeForbidden(output)
            val selected = storage(postPath.space)
            storageLock.write {
                createFluoPost(postPath.space, selected.posts, grant, request, input, output)
            }
            return
        }
        val postId = postPath?.remainder?.removePrefix("/")?.takeIf {
            postPath.remainder.startsWith('/') && !it.contains('/')
        }
        if (request.method == "DELETE" && postId != null) {
            if (!policy().allowUploads) return transferDenied(output)
            val selected = storage(postPath.space)
            val deleted = storageLock.write {
                deleteFluoPost(selected.posts, postId, grant, output)
            }
            if (deleted && postPath.space == NodeSpace.PUBLIC) {
                onPublicPostDeleted(postId)
                onPublicStorageChanged()
            }
            return
        }
        val uploadPath = resolveSpacePath(request.path, "/files", "/files")
        if (request.method == "POST" && uploadPath?.remainder == "") {
            if (!policy().allowUploads) return transferDenied(output)
            if (!canWrite(uploadPath.space, grant)) return writeForbidden(output)
            storageLock.write { createUpload(storage(uploadPath.space).uploads, uploadPath, grant, request, output) }
            return
        }
        val uploadId = uploadPath?.remainder?.removePrefix("/")?.takeIf {
            uploadPath.remainder.startsWith('/') && !it.contains('/')
        }
        if (uploadId != null) {
            val selected = storage(uploadPath.space).uploads
            if (request.method == "DELETE") {
                if (!policy().allowUploads) return transferDenied(output)
                if (!canDelete(uploadPath.space, grant)) return writeForbidden(output)
            } else if (request.method != "HEAD") {
                if (!policy().allowUploads) return transferDenied(output)
                if (!canWrite(uploadPath.space, grant)) return writeForbidden(output)
            } else if (!policy().allowDownloads) return transferDenied(output)
            val storageOperation: (() -> Unit) = {
                when (request.method) {
                    "HEAD" -> headUpload(selected, uploadId, output)
                    "PATCH" -> patchUpload(selected, uploadId, grant, request, input, output)
                    "DELETE" -> {
                        val reservationId = selected.record(uploadId)?.publicReservationId
                        if (deleteUpload(selected, uploadId, grant, output) &&
                            uploadPath.space == NodeSpace.PUBLIC) {
                            reservationId?.let(onPublicReservationReleased)
                            onPublicStorageChanged()
                        }
                    }
                    else -> writeJson(output, 405, "Method Not Allowed", JSONObject().put("error", "Method not allowed."))
                }
            }
            if (request.method == "DELETE") storageLock.write(storageOperation)
            else storageLock.read(storageOperation)
            return
        }
        val contentPath = resolveSpacePath(request.path, "/v1/files", "/content")
        val fileId = contentPath?.remainder?.removePrefix("/")?.takeIf {
            contentPath.remainder.startsWith('/') && !it.contains('/')
        }
        if ((request.method == "GET" || request.method == "HEAD") && fileId != null) {
            if (!policy().allowDownloads) return transferDenied(output)
            storageLock.read { download(storage(contentPath.space).uploads, fileId, request, output) }
            return
        }
        writeJson(output, 404, "Not Found", JSONObject().put("error", "Not found."))
    }

    private fun transferDenied(output: BufferedOutputStream) {
        writeJson(output, 403, "Forbidden", JSONObject().put("error", "This transfer direction is disabled."))
    }

    private fun methodNotAllowed(output: BufferedOutputStream) {
        writeJson(output, 405, "Method Not Allowed", JSONObject().put("error", "Method not allowed."))
    }

    private fun writeForbidden(output: BufferedOutputStream) {
        writeJson(output, 403, "Forbidden", JSONObject().put("error", "This space is read-only for your account."))
    }

    fun clearStorage(): StorageClearResult = storageLock.write {
        val privateResult = clearSpaceLocked(NodeSpace.PRIVATE)
        val publicResult = clearSpaceLocked(NodeSpace.PUBLIC)
        StorageClearResult(
            deletedBytes = privateResult.deletedBytes + publicResult.deletedBytes,
            deletedUploads = privateResult.deletedUploads + publicResult.deletedUploads,
            deletedPosts = privateResult.deletedPosts + publicResult.deletedPosts,
            publicPostIds = publicResult.publicPostIds,
            publicReservationIds = publicResult.publicReservationIds,
        )
    }

    fun clearSpace(space: NodeSpace): StorageClearResult = storageLock.write {
        clearSpaceLocked(space)
    }

    private fun clearSpaceLocked(space: NodeSpace): StorageClearResult {
        val selected = storage(space)
        val postsDeleted = selected.posts.clearAll()
        if (space == NodeSpace.PUBLIC) postsDeleted.postIds.forEach(onPublicPostDeleted)
        val uploads = selected.uploads.clearAll()
        val messageBytes = selected.messages?.clearAll() ?: 0
        val envelopeBytes = selected.envelopes.clearAll()
        if (space == NodeSpace.PUBLIC) {
            uploads.publicReservationIds.forEach(onPublicReservationReleased)
            onPublicStorageChanged()
        }
        return StorageClearResult(
            uploads.deletedBytes + postsDeleted.deletedBytes + messageBytes + envelopeBytes,
            uploads.deletedUploads,
            postsDeleted.deletedPosts,
            publicPostIds = if (space == NodeSpace.PUBLIC) postsDeleted.postIds else emptyList(),
            publicReservationIds = if (space == NodeSpace.PUBLIC) uploads.publicReservationIds else emptyList(),
        )
    }

    fun applySpaceQuotas(publicQuotaBytes: Long, privateQuotaBytes: Long) = storageLock.write {
        require(publicQuotaBytes >= 0 && privateQuotaBytes >= 0)
        val publicStore = storage(NodeSpace.PUBLIC).uploads
        val privateStore = storage(NodeSpace.PRIVATE).uploads
        publicStore.setQuotaBytes(publicQuotaBytes)
        privateStore.setQuotaBytes(privateQuotaBytes)
    }

    private fun writeStorageClear(output: BufferedOutputStream, result: StorageClearResult) {
        writeJson(output, 200, "OK", JSONObject()
            .put("deletedBytes", result.deletedBytes)
            .put("deletedPosts", result.deletedPosts)
            .put("deletedUploads", result.deletedUploads))
    }

    private fun runQuickTest(output: BufferedOutputStream) {
        try {
            val result = quickTest()
            writeJson(output, 200, "OK", JSONObject()
                .put("completedAt", result.completedAt)
                .put("diskReadBps", result.readBps)
                .put("diskWriteBps", result.writeBps))
        } catch (_: Exception) {
            writeJson(output, 500, "Internal Server Error", JSONObject()
                .put("error", "The quick test could not be completed."))
        }
    }

    private fun runFreshDiagnostic(path: String, output: BufferedOutputStream) {
        val snapshot = metricsSnapshot
        if (snapshot == null || latencyTest == null) {
            writeFreshJson(output, 501, "Not Implemented", JSONObject()
                .put("error", "Fresh telemetry requires the latest Nodo version."))
            return
        }
        try {
            val completedAt = System.currentTimeMillis() / 1_000
            val value = JSONObject().put("completedAt", completedAt)
            when (path) {
                "/v1/diagnostics/battery" -> snapshot().also { metrics ->
                    value.putNullable("batteryPercent", metrics.batteryPercent)
                    value.putNullable("charging", metrics.charging)
                }
                "/v1/diagnostics/memory" -> snapshot().also { metrics ->
                    value.put("memoryAvailableBytes", metrics.memoryAvailableBytes)
                    value.put("memoryTotalBytes", metrics.memoryTotalBytes)
                    value.put("storageAvailableBytes", metrics.storageAvailableBytes)
                }
                "/v1/diagnostics/network" -> snapshot().also { metrics ->
                    value.put("networkType", metrics.networkType)
                    value.put("networkMetered", metrics.networkMetered)
                    value.putNullable("networkDownBps", metrics.networkDownBps)
                    value.putNullable("networkUpBps", metrics.networkUpBps)
                }
                "/v1/diagnostics/latency" -> value.put("coordinatorLatencyMs", latencyTest.invoke())
                "/v1/diagnostics/disk" -> quickTest().also { benchmark ->
                    value.put("completedAt", benchmark.completedAt)
                    value.put("diskReadBps", benchmark.readBps)
                    value.put("diskWriteBps", benchmark.writeBps)
                }
                else -> {
                    writeFreshJson(output, 404, "Not Found", JSONObject().put("error", "Diagnostic not found."))
                    return
                }
            }
            writeFreshJson(output, 200, "OK", value)
        } catch (_: Exception) {
            writeFreshJson(output, 500, "Internal Server Error", JSONObject()
                .put("error", "This telemetry field could not be refreshed."))
        }
    }

    private fun JSONObject.putNullable(name: String, value: Any?): JSONObject =
        put(name, value ?: JSONObject.NULL)

    private fun writeFreshJson(
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        value: JSONObject,
    ) = writeJson(output, status, reason, value, mapOf("Cache-Control" to "no-store"))

    private fun listFluoPosts(
        posts: FluoPostStore,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        val limit = request.query["limit"]?.let { value ->
            value.toIntOrNull()?.takeIf { it in 1..FluoPostStore.MAX_PAGE_SIZE } ?: run {
                writeJson(output, 400, "Bad Request", JSONObject().put("error", "Page limit is invalid."))
                return
            }
        } ?: DEFAULT_POST_PAGE_SIZE
        val cursor = request.query["cursor"]?.let { value ->
            value.toLongOrNull()?.takeIf { it >= 0 } ?: run {
                writeJson(output, 400, "Bad Request", JSONObject().put("error", "Page cursor is invalid."))
                return
            }
        }
        val author = request.query["author"]?.let { value ->
            if (value.length !in 1..32 || value.any { it.code < 32 || it.code == 127 }) {
                writeJson(output, 400, "Bad Request", JSONObject().put("error", "Author filter is invalid."))
                return
            }
            value
        }
        val page = posts.page(limit, cursor, author)
        writeJson(output, 200, "OK", JSONObject()
            .put("posts", org.json.JSONArray(page.posts.map(::postJson)))
            .put("nextCursor", page.nextCursor?.toString()))
    }

    private fun listStorageItems(
        space: NodeSpace,
        selected: SpaceStorage,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ) {
        val items = mutableListOf<JSONObject>()
        selected.uploads.listRecords().forEach { record ->
            val filename = safeFilename(metadataFilename(record.metadata)) ?: "${record.id}.bin"
            val owner = record.createdBy.orEmpty()
            items += storageItemJson(
                kind = "file",
                id = record.id,
                storageKey = record.id,
                name = filename,
                sizeBytes = selected.uploads.storedBytes(record.id).coerceAtLeast(record.offset),
                createdAt = record.createdAt,
                completed = record.complete,
                owner = owner,
                deletable = grant.isOwner || owner == grant.username,
                mimeType = metadataMediaType(record.metadata),
                preview = null,
            )
        }
        selected.posts.list().forEach { post ->
            val size = post.body.toByteArray(Charsets.UTF_8).size.toLong() + post.attachments.sumOf { it.size }
            items += storageItemJson(
                kind = "fluo-post",
                id = post.id,
                storageKey = post.id,
                name = "Fluo post",
                sizeBytes = size,
                createdAt = post.createdAt,
                completed = true,
                owner = post.author,
                deletable = grant.isOwner || post.author == grant.username,
                mimeType = null,
                preview = post.body.take(180),
            )
        }
        selected.envelopes.list(grant.username).forEach { envelope ->
            val size = envelope.body.toByteArray(Charsets.UTF_8).size.toLong() + envelope.attachments.sumOf { it.size }
            items += storageItemJson(
                kind = "ligo-envelope",
                id = envelope.id,
                storageKey = envelope.id,
                name = "Ligo message",
                sizeBytes = size,
                createdAt = envelope.createdAt,
                completed = true,
                owner = envelope.sender,
                deletable = envelope.sender == grant.username || envelope.recipient == grant.username,
                mimeType = null,
                preview = envelope.body.take(180),
            )
        }
        selected.messages?.listAll()?.forEach { stored ->
            val message = stored.message
            items += storageItemJson(
                kind = "rondo-message",
                id = message.id,
                storageKey = "${stored.spaceId}.${stored.roomId}.${message.id}",
                name = "Rondo message",
                sizeBytes = message.body.toByteArray(Charsets.UTF_8).size.toLong(),
                createdAt = message.createdAt,
                completed = true,
                owner = message.author,
                deletable = grant.isOwner || message.author == grant.username,
                mimeType = null,
                preview = message.body.take(180),
            )
        }
        items.sortWith(compareByDescending<JSONObject> { it.optLong("createdAt") }.thenByDescending { it.optString("id") })
        writeJson(output, 200, "OK", JSONObject().put("items", org.json.JSONArray(items)))
    }

    private fun storageItemJson(
        kind: String,
        id: String,
        storageKey: String,
        name: String,
        sizeBytes: Long,
        createdAt: Long,
        completed: Boolean,
        owner: String,
        deletable: Boolean,
        mimeType: String?,
        preview: String?,
    ) = JSONObject()
        .put("completed", completed)
        .put("createdAt", createdAt)
        .put("deletable", deletable)
        .put("id", id)
        .put("kind", kind)
        .put("name", name)
        .put("owner", owner)
        .put("sizeBytes", sizeBytes)
        .put("storageKey", storageKey)
        .apply {
            mimeType?.let { put("mimeType", it) }
            preview?.let { put("preview", it) }
        }

    private fun deleteStorageItem(
        space: NodeSpace,
        selected: SpaceStorage,
        kind: String,
        storageKey: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ) {
        when (kind) {
            "file" -> {
                val reservation = selected.uploads.record(storageKey)?.publicReservationId
                if (!selected.uploads.delete(storageKey, grant.username, grant.isOwner)) {
                    return writeJson(output, 404, "Not Found", JSONObject().put("error", "File not found."))
                }
                reservation?.let { if (space == NodeSpace.PUBLIC) onPublicReservationReleased(it) }
                if (space == NodeSpace.PUBLIC) onPublicStorageChanged()
            }
            "fluo-post" -> when (selected.posts.delete(storageKey, grant.username, grant.isOwner)) {
                FluoPostStore.DeleteResult.DELETED -> {
                    if (space == NodeSpace.PUBLIC) {
                        onPublicPostDeleted(storageKey)
                        onPublicStorageChanged()
                    }
                }
                FluoPostStore.DeleteResult.FORBIDDEN -> return writeForbidden(output)
                FluoPostStore.DeleteResult.MISSING -> return writeJson(output, 404, "Not Found", JSONObject().put("error", "Post not found."))
            }
            "ligo-envelope" -> when (selected.envelopes.delete(storageKey, grant.username)) {
                LigoEnvelopeStore.DeleteResult.DELETED -> if (space == NodeSpace.PUBLIC) onPublicStorageChanged()
                LigoEnvelopeStore.DeleteResult.FORBIDDEN -> return writeForbidden(output)
                LigoEnvelopeStore.DeleteResult.MISSING -> return writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
            }
            "rondo-message" -> {
                val parts = storageKey.split('.')
                if (parts.size != 3 || selected.messages == null) {
                    return writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
                }
                when (selected.messages.delete(parts[0], parts[1], parts[2], grant.username, grant.isOwner)) {
                    RondoMessageStore.DeleteResult.DELETED -> Unit
                    RondoMessageStore.DeleteResult.FORBIDDEN -> return writeForbidden(output)
                    RondoMessageStore.DeleteResult.MISSING -> return writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
                }
            }
            else -> return writeJson(output, 404, "Not Found", JSONObject().put("error", "Storage item not found."))
        }
        writeJson(output, 200, "OK", JSONObject().put("ok", true))
    }

    private fun listRondoMessages(
        messages: RondoMessageStore,
        spaceId: String,
        roomId: String,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        val limit = request.query["limit"]?.toIntOrNull()?.takeIf {
            it in 1..RondoMessageStore.MAX_PAGE_SIZE
        } ?: if (request.query.containsKey("limit")) {
            return writeJson(output, 400, "Bad Request", JSONObject().put("error", "Page limit is invalid."))
        } else DEFAULT_MESSAGE_PAGE_SIZE
        val cursor = request.query["cursor"]?.toLongOrNull()?.takeIf { it >= 0 }
        if (request.query.containsKey("cursor") && cursor == null) {
            return writeJson(output, 400, "Bad Request", JSONObject().put("error", "Page cursor is invalid."))
        }
        val page = messages.page(spaceId, roomId, limit, cursor)
        writeJson(output, 200, "OK", JSONObject()
            .put("messages", org.json.JSONArray(page.messages.map(::messageJson)))
            .put("nextCursor", page.nextCursor?.toString()))
    }

    private fun createRondoMessage(
        messages: RondoMessageStore,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        val scope = grant.rondo ?: return writeForbidden(output)
        if (request.headers["content-type"]?.substringBefore(';') != "application/json") {
            return writeJson(output, 415, "Unsupported Media Type", JSONObject().put("error", "JSON is required."))
        }
        val length = request.contentLength
        if (length == null || length !in 1..MAX_RONDO_REQUEST_BYTES) {
            return writeJson(output, 400, "Bad Request", JSONObject().put("error", "Message payload is invalid."))
        }
        try {
            val body = JSONObject(readBody(input, length.toInt()).toString(Charsets.UTF_8)).getString("body")
            val message = messages.create(scope.spaceId, scope.roomId, grant.username, body, scope.limitBytes)
            writeJson(output, 201, "Created", JSONObject().put("message", messageJson(message)))
        } catch (_: RondoMessageStore.QuotaExceeded) {
            writeJson(output, 413, "Content Too Large", JSONObject().put("error", "This Space storage limit is full."))
        } catch (_: TusUploadStore.QuotaExceeded) {
            writeJson(output, 413, "Content Too Large", JSONObject().put("error", "Nodo storage is full."))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Message payload is invalid."))
        }
    }

    private fun deleteRondoMessage(
        messages: RondoMessageStore,
        messageId: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ) {
        val scope = grant.rondo ?: return writeForbidden(output)
        when (messages.delete(scope.spaceId, scope.roomId, messageId, grant.username, scope.owner)) {
            RondoMessageStore.DeleteResult.DELETED -> writeJson(output, 200, "OK", JSONObject().put("ok", true))
            RondoMessageStore.DeleteResult.FORBIDDEN -> writeForbidden(output)
            RondoMessageStore.DeleteResult.MISSING -> writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
        }
    }

    private fun messageJson(message: RondoMessageStore.Message) = JSONObject()
        .put("author", message.author)
        .put("body", message.body)
        .put("createdAt", message.createdAt)
        .put("id", message.id)

    private fun createLigoEnvelope(
        envelopes: LigoEnvelopeStore,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        if (request.headers["content-type"]?.substringBefore(';') != "application/json") {
            return writeJson(output, 415, "Unsupported Media Type", JSONObject().put("error", "JSON is required."))
        }
        val length = request.contentLength
        if (length == null || length !in 1..MAX_LIGO_REQUEST_BYTES) {
            return writeJson(output, 400, "Bad Request", JSONObject().put("error", "Message envelope is invalid."))
        }
        try {
            val value = JSONObject(readBody(input, length.toInt()).toString(Charsets.UTF_8))
            val items = value.getJSONArray("attachments")
            if (items.length() > LigoEnvelopeStore.MAX_ATTACHMENTS) throw IllegalArgumentException()
            val attachments = List(items.length()) { index -> items.getJSONObject(index).let {
                LigoEnvelopeStore.Attachment(
                    it.getString("id"), it.getString("mimeType"), it.getString("name"), it.getLong("size"),
                )
            } }
            val envelope = envelopes.create(
                value.getString("id"), grant.username, value.getString("recipient").lowercase(),
                value.optString("body"), attachments, grant.publicReservation?.id,
            )
            writeJson(output, 201, "Created", JSONObject().put("envelope", envelopeJson(envelope)))
        } catch (_: LigoEnvelopeStore.AlreadyExists) {
            writeJson(output, 409, "Conflict", JSONObject().put("error", "Message already exists."))
        } catch (_: TusUploadStore.QuotaExceeded) {
            writeJson(output, 413, "Content Too Large", JSONObject().put("error", "Nodo storage is full."))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Message envelope is invalid."))
        }
    }

    private fun readLigoEnvelope(
        envelopes: LigoEnvelopeStore,
        id: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ) {
        val envelope = envelopes.read(id, grant.username)
            ?: return writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
        writeJson(output, 200, "OK", JSONObject().put("envelope", envelopeJson(envelope)))
    }

    private fun deleteLigoEnvelope(
        envelopes: LigoEnvelopeStore,
        id: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ) {
        when (envelopes.delete(id, grant.username)) {
            LigoEnvelopeStore.DeleteResult.DELETED -> writeJson(output, 200, "OK", JSONObject().put("ok", true))
            LigoEnvelopeStore.DeleteResult.FORBIDDEN -> writeForbidden(output)
            LigoEnvelopeStore.DeleteResult.MISSING -> writeJson(output, 404, "Not Found", JSONObject().put("error", "Message not found."))
        }
    }

    private fun envelopeJson(envelope: LigoEnvelopeStore.Envelope) = JSONObject()
        .put("attachments", org.json.JSONArray(envelope.attachments.map { JSONObject()
            .put("id", it.id).put("mimeType", it.mimeType).put("name", it.name).put("size", it.size) }))
        .put("body", envelope.body)
        .put("createdAt", envelope.createdAt)
        .put("id", envelope.id)
        .put("recipient", envelope.recipient)
        .put("sender", envelope.sender)

    private fun joinRondoVoice(
        path: RondoVoicePath,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        try {
            val value = voiceBody(request, input)
            val snapshot = voiceHub.join(path.spaceId, path.roomId, value.getString("peerId"), grant.username)
            writeJson(output, 200, "OK", voiceJson(snapshot))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Voice join payload is invalid."))
        }
    }

    private fun syncRondoVoice(
        path: RondoVoicePath,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        val peerId = request.query["peerId"]
        val after = request.query["after"]?.toLongOrNull()
        if (peerId == null || after == null || after < 0) {
            return writeJson(output, 400, "Bad Request", JSONObject().put("error", "Voice sync query is invalid."))
        }
        try {
            writeJson(output, 200, "OK", voiceJson(voiceHub.sync(path.spaceId, path.roomId, peerId, after)))
        } catch (_: RondoVoiceHub.ParticipantMissing) {
            writeJson(output, 409, "Conflict", JSONObject().put("error", "Voice session expired."))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Voice sync query is invalid."))
        }
    }

    private fun signalRondoVoice(
        path: RondoVoicePath,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        try {
            val value = voiceBody(request, input)
            val sequence = voiceHub.signal(
                path.spaceId,
                path.roomId,
                value.getString("peerId"),
                value.getString("toPeerId"),
                value.getString("type"),
                value.getString("payload"),
                grant.username,
            )
            writeJson(output, 202, "Accepted", JSONObject().put("sequence", sequence))
        } catch (_: RondoVoiceHub.ParticipantMissing) {
            writeJson(output, 409, "Conflict", JSONObject().put("error", "Voice participant is no longer connected."))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Voice signal is invalid."))
        }
    }

    private fun leaveRondoVoice(
        path: RondoVoicePath,
        grant: AccessGrant,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        val peerId = request.query["peerId"]
        if (peerId == null || !voiceHub.leave(path.spaceId, path.roomId, peerId, grant.username)) {
            return writeJson(output, 404, "Not Found", JSONObject().put("error", "Voice session not found."))
        }
        writeJson(output, 200, "OK", JSONObject().put("ok", true))
    }

    private fun voiceBody(request: HttpRequest, input: InputStream): JSONObject {
        require(request.headers["content-type"]?.substringBefore(';') == "application/json")
        val length = request.contentLength ?: throw BadRequest()
        require(length in 1..MAX_VOICE_REQUEST_BYTES)
        return JSONObject(readBody(input, length.toInt()).toString(Charsets.UTF_8))
    }

    private fun voiceJson(snapshot: RondoVoiceHub.Snapshot) = JSONObject()
        .put("cursor", snapshot.cursor)
        .put("participants", org.json.JSONArray(snapshot.participants.map { participant -> JSONObject()
            .put("joinedAt", participant.joinedAt)
            .put("peerId", participant.peerId)
            .put("username", participant.username)
        }))
        .put("signals", org.json.JSONArray(snapshot.signals.map { signal -> JSONObject()
            .put("fromPeerId", signal.fromPeerId)
            .put("payload", signal.payload)
            .put("sequence", signal.sequence)
            .put("type", signal.type)
        }))

    private fun createFluoPost(
        space: NodeSpace,
        posts: FluoPostStore,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        if (request.headers["content-type"]?.substringBefore(';') != "application/json") {
            writeJson(output, 415, "Unsupported Media Type", JSONObject().put("error", "JSON is required."))
            return
        }
        val length = request.headers["x-kaordo-chunk-length"]?.toLongOrNull()
            ?: request.headers[LEGACY_CHUNK_LENGTH_HEADER]?.toLongOrNull()
            ?: request.contentLength
        if (length == null || length !in 1..MAX_FLUO_REQUEST_BYTES) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Post payload is invalid."))
            return
        }
        try {
            val value = JSONObject(readBody(input, length.toInt()).toString(Charsets.UTF_8))
            val attachments = value.optJSONArray("attachments") ?: org.json.JSONArray()
            if (attachments.length() > FluoPostStore.MAX_ATTACHMENTS) throw IllegalArgumentException()
            val body = value.optString("body", "")
            val parsedAttachments = List(attachments.length()) { index ->
                parseFluoAttachment(attachments.getJSONObject(index))
            }
            val quote = value.optJSONObject("quote")?.let { quoted ->
                val quoteAttachments = quoted.optJSONArray("attachments") ?: org.json.JSONArray()
                if (quoteAttachments.length() > FluoPostStore.MAX_ATTACHMENTS) throw IllegalArgumentException()
                FluoPostStore.QuotedPost(
                    attachments = List(quoteAttachments.length()) { index ->
                        parseFluoAttachment(quoteAttachments.getJSONObject(index))
                    },
                    author = quoted.getString("author"),
                    body = quoted.optString("body", ""),
                    createdAt = quoted.getLong("createdAt"),
                    id = quoted.getString("id"),
                    nodeId = quoted.getString("nodeId"),
                    space = quoted.getString("space"),
                )
            }
            val reservation = grant.publicReservation.takeIf { space == NodeSpace.PUBLIC }
            if (space == NodeSpace.PUBLIC && reservation == null) return writeForbidden(output)
            if (reservation != null) {
                if (posts.hasPublicReservation(reservation.id)) {
                    writeJson(output, 409, "Conflict", JSONObject().put("error", "Public reservation was already used."))
                    return
                }
                val payloadBytes = body.toByteArray(Charsets.UTF_8).size.toLong() +
                    (quote?.let { quotedPostJson(it).toString().toByteArray(Charsets.UTF_8).size.toLong() } ?: 0L) +
                    parsedAttachments.sumOf { it.size }
                if (payloadBytes <= 0 || payloadBytes > reservation.bytes) {
                    writeJson(output, 413, "Content Too Large", JSONObject().put("error", "Public reservation is too small."))
                    return
                }
            }
            val post = posts.create(
                author = grant.username,
                body = body,
                attachments = parsedAttachments,
                publicReservationId = reservation?.id,
                quote = quote,
            )
            writeJson(output, 201, "Created", JSONObject().put("post", postJson(post)))
        } catch (_: FluoPostStore.MissingMedia) {
            writeJson(output, 409, "Conflict", JSONObject().put("error", "Attached media is incomplete."))
        } catch (_: FluoPostStore.PublicReservationUsed) {
            writeJson(output, 409, "Conflict", JSONObject().put("error", "Public reservation was already used."))
        } catch (_: TusUploadStore.QuotaExceeded) {
            writeJson(output, 413, "Content Too Large", JSONObject().put("error", "Allocated storage is full."))
        } catch (_: Exception) {
            writeJson(output, 400, "Bad Request", JSONObject().put("error", "Post payload is invalid."))
        }
    }

    private fun deleteFluoPost(
        posts: FluoPostStore,
        id: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ): Boolean {
        when (posts.delete(id, grant.username, grant.isOwner)) {
            FluoPostStore.DeleteResult.MISSING -> {
                writeJson(output, 404, "Not Found", JSONObject().put("error", "Post not found."))
                return false
            }
            FluoPostStore.DeleteResult.FORBIDDEN -> {
                writeForbidden(output)
                return false
            }
            FluoPostStore.DeleteResult.DELETED -> Unit
        }
        writeJson(output, 200, "OK", JSONObject().put("ok", true))
        return true
    }

    private fun postJson(post: FluoPostStore.Post) = JSONObject()
        .put("attachments", org.json.JSONArray(post.attachments.map(::fluoAttachmentJson)))
        .put("author", post.author)
        .put("body", post.body)
        .put("createdAt", post.createdAt)
        .put("id", post.id)
        .apply { post.quote?.let { put("quote", quotedPostJson(it)) } }

    private fun quotedPostJson(post: FluoPostStore.QuotedPost) = JSONObject()
        .put("attachments", org.json.JSONArray(post.attachments.map(::fluoAttachmentJson)))
        .put("author", post.author)
        .put("body", post.body)
        .put("createdAt", post.createdAt)
        .put("id", post.id)
        .put("nodeId", post.nodeId)
        .put("space", post.space)

    private fun parseFluoAttachment(item: JSONObject) = FluoPostStore.Attachment(
        id = item.getString("id"),
        kind = item.getString("kind"),
        mimeType = item.getString("mimeType"),
        name = item.getString("name"),
        size = item.getLong("size"),
        width = item.optInt("width", 0).takeIf { it > 0 },
        height = item.optInt("height", 0).takeIf { it > 0 },
    )

    private fun fluoAttachmentJson(attachment: FluoPostStore.Attachment) = JSONObject()
        .put("id", attachment.id)
        .put("kind", attachment.kind)
        .put("mimeType", attachment.mimeType)
        .put("name", attachment.name)
        .put("size", attachment.size)
        .apply {
            attachment.width?.let { put("width", it) }
            attachment.height?.let { put("height", it) }
        }

    private fun fluoStateJson(posts: FluoPostStore): JSONObject {
        val state = posts.state()
        return JSONObject()
            .put("postCount", state.postCount)
            .put("stateHash", state.stateHash)
    }

    private fun createUpload(
        store: TusUploadStore,
        path: SpacePath,
        grant: AccessGrant,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        if (!validTusVersion(request, output)) return
        val length = request.headers["upload-length"]?.toLongOrNull()
        if (length == null || length < 0) {
            writeTusError(output, 400, "Bad Request", "Upload-Length is required.")
            return
        }
        val metadata = request.headers["upload-metadata"].orEmpty()
        if (metadata.length > 8_192 || metadata.any { it == '\r' || it == '\n' }) {
            writeTusError(output, 400, "Bad Request", "Upload-Metadata is invalid.")
            return
        }
        try {
            val reservation = grant.publicReservation.takeIf { path.space == NodeSpace.PUBLIC }
            val record = store.create(
                length,
                metadata,
                grant.username,
                reservation?.id,
                reservation?.bytes,
            )
            writeResponse(output, 201, "Created", tusHeaders() + mapOf(
                "Location" to "${path.base}/${record.id}",
                "Upload-Offset" to "0",
            ))
        } catch (_: TusUploadStore.QuotaExceeded) {
            writeTusError(output, 413, "Content Too Large", "Allocated storage is full.")
        } catch (_: IllegalArgumentException) {
            writeTusError(output, 400, "Bad Request", "Upload-Length is invalid.")
        }
    }

    private fun headUpload(store: TusUploadStore, id: String, output: BufferedOutputStream) {
        val record = store.record(id)
        if (record == null) {
            writeTusError(output, 404, "Not Found", "Upload not found.")
            return
        }
        val headers = mutableMapOf(
            "Upload-Length" to record.length.toString(),
            "Upload-Offset" to record.offset.toString(),
            "Cache-Control" to "no-store",
        )
        if (record.metadata.isNotEmpty()) headers["Upload-Metadata"] = record.metadata
        writeResponse(output, 200, "OK", tusHeaders() + headers)
    }

    private fun patchUpload(
        store: TusUploadStore,
        id: String,
        grant: AccessGrant,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream,
    ) {
        if (!validTusVersion(request, output)) return
        if (request.headers["content-type"]?.substringBefore(';') != "application/offset+octet-stream") {
            writeTusError(output, 415, "Unsupported Media Type", "PATCH requires application/offset+octet-stream.")
            return
        }
        val offset = request.headers["upload-offset"]?.toLongOrNull()
        val length = request.contentLength
        if (offset == null || offset < 0 || length == null) {
            writeTusError(output, 400, "Bad Request", "Upload-Offset and Content-Length are required.")
            return
        }
        try {
            if (request.headers["expect"]?.equals("100-continue", ignoreCase = true) == true) {
                output.write("HTTP/1.1 100 Continue\r\n\r\n".toByteArray(Charsets.US_ASCII))
                output.flush()
            }
            val record = store.append(id, offset, length, input, grant.username, grant.isOwner)
            writeResponse(output, 204, "No Content", tusHeaders() + mapOf("Upload-Offset" to record.offset.toString()))
        } catch (_: TusUploadStore.UploadMissing) {
            writeTusError(output, 404, "Not Found", "Upload not found.")
        } catch (_: TusUploadStore.AccessDenied) {
            writeTusError(output, 403, "Forbidden", "This upload belongs to another account.")
        } catch (error: TusUploadStore.OffsetMismatch) {
            writeTusError(output, 409, "Conflict", "Upload offset does not match.", mapOf("Upload-Offset" to error.correctOffset.toString()))
        } catch (_: TusUploadStore.InvalidChunk) {
            writeTusError(output, 400, "Bad Request", "Upload chunk is invalid.")
        }
    }

    private fun deleteUpload(
        store: TusUploadStore,
        id: String,
        grant: AccessGrant,
        output: BufferedOutputStream,
    ): Boolean {
        if (!store.delete(id, grant.username, grant.isOwner)) {
            writeTusError(output, 404, "Not Found", "Upload not found.")
            return false
        }
        writeResponse(output, 204, "No Content", tusHeaders())
        return true
    }

    private fun download(
        store: TusUploadStore,
        id: String,
        request: HttpRequest,
        output: BufferedOutputStream,
    ) {
        val (record, file) = store.completedFile(id) ?: run {
            writeJson(output, 404, "Not Found", JSONObject().put("error", "File not found."))
            return
        }
        val filename = safeFilename(metadataFilename(record.metadata)) ?: "${record.id}.bin"
        val etag = "\"${record.id}-${file.length()}\""
        val cacheHeaders = mapOf(
            // Upload IDs are content-immutable after completion. A private
            // year-long cache lets WebKit remount feed media without another
            // network transfer or main-thread decode pipeline.
            "Cache-Control" to "private, max-age=31536000, immutable",
            "ETag" to etag,
        )
        if (request.headers["if-none-match"] == etag) {
            writeResponse(output, 304, "Not Modified", cacheHeaders)
            return
        }
        val requestedRange = request.headers["range"]
        val range = if (requestedRange == null) {
            0L until file.length()
        } else {
            byteRange(requestedRange, file.length()) ?: run {
                writeResponse(output, 416, "Range Not Satisfiable", mapOf(
                    "Accept-Ranges" to "bytes",
                    "Content-Range" to "bytes */${file.length()}",
                ))
                return
            }
        }
        val partial = requestedRange != null
        val headers = (cacheHeaders + mapOf(
            "Accept-Ranges" to "bytes",
            "Content-Type" to (metadataMediaType(record.metadata) ?: mediaType(filename)),
            "Content-Length" to (range.last - range.first + 1).toString(),
            "Content-Disposition" to "inline; filename=\"$filename\"",
        )).toMutableMap()
        if (partial) headers["Content-Range"] = "bytes ${range.first}-${range.last}/${file.length()}"
        writeResponse(output, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", headers, body = null)
        if (request.method == "HEAD") return
        RandomAccessFile(file, "r").use { source ->
            source.seek(range.first)
            var remaining = range.last - range.first + 1
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (remaining > 0) {
                val read = source.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                if (read < 0) break
                output.write(buffer, 0, read)
                remaining -= read
            }
        }
    }

    private fun authorized(request: HttpRequest): AccessGrant? {
        val header = request.headers["authorization"]
            ?: request.query["access_token"]?.let { "Bearer $it" }
            ?: return null
        if (!header.startsWith("Bearer ")) return null
        val token = header.removePrefix("Bearer ")
        val reservationId = request.headers["x-kaordo-public-reservation"]
            ?: request.headers[LEGACY_PUBLIC_RESERVATION_HEADER]
        val rondoSpaceId = request.headers["x-kaordo-rondo-space"]
            ?: request.headers[LEGACY_RONDO_SPACE_HEADER]
        val rondoRoomId = request.headers["x-kaordo-rondo-room"]
            ?: request.headers[LEGACY_RONDO_ROOM_HEADER]
        return token.takeIf { it.length == 43 }?.let {
            if (rondoSpaceId != null || rondoRoomId != null) {
                authorizeRondo?.invoke(it, rondoSpaceId, rondoRoomId)
            } else authorize(it, reservationId)
        }
    }

    private fun canWrite(space: NodeSpace, grant: AccessGrant): Boolean = when (space) {
        NodeSpace.PRIVATE -> grant.isOwner
        NodeSpace.PUBLIC -> grant.publicReservation != null
    }

    private fun canDelete(space: NodeSpace, grant: AccessGrant): Boolean = when (space) {
        NodeSpace.PRIVATE -> grant.isOwner
        NodeSpace.PUBLIC -> grant.isOwner || grant.publicReservation != null
    }

    private fun storage(space: NodeSpace): SpaceStorage =
        requireNotNull(spaces[space]) { "Missing ${space.segment} storage." }

    private fun resolveSpacePath(path: String, legacyBase: String, scopedSuffix: String): SpacePath? {
        if (path == legacyBase || path.startsWith("$legacyBase/")) {
            return SpacePath(NodeSpace.PRIVATE, legacyBase, path.removePrefix(legacyBase))
        }
        for (space in NodeSpace.entries) {
            val base = "/v1/spaces/${space.segment}$scopedSuffix"
            if (path == base || path.startsWith("$base/")) {
                return SpacePath(space, base, path.removePrefix(base))
            }
        }
        return null
    }

    private fun resolveRondoPath(path: String): RondoPath? {
        val match = RONDO_PATH.matchEntire(path) ?: return null
        return RondoPath(match.groupValues[1], match.groupValues[2], match.groupValues[3].ifBlank { null })
    }

    private fun resolveRondoVoicePath(path: String): RondoVoicePath? {
        val match = RONDO_VOICE_PATH.matchEntire(path) ?: return null
        return RondoVoicePath(match.groupValues[1], match.groupValues[2], match.groupValues[3])
    }

    private fun validTusVersion(request: HttpRequest, output: BufferedOutputStream): Boolean {
        if (request.headers["tus-resumable"] == TUS_VERSION) return true
        writeTusError(output, 412, "Precondition Failed", "Unsupported tus version.", mapOf("Tus-Version" to TUS_VERSION))
        return false
    }

    private fun readRequest(input: BufferedInputStream): HttpRequest? {
        val requestLine = readLine(input, 8_192) ?: return null
        val parts = requestLine.split(' ')
        if (parts.size != 3 || !parts[2].startsWith("HTTP/1.")) throw BadRequest()
        val headers = linkedMapOf<String, String>()
        var bytes = requestLine.length
        while (true) {
            val line = readLine(input, 8_192) ?: throw BadRequest()
            bytes += line.length
            if (bytes > 32_768) throw BadRequest()
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator <= 0) throw BadRequest()
            headers[line.take(separator).trim().lowercase()] = line.drop(separator + 1).trim()
        }
        val rawTarget = parts[1]
        val target = rawTarget.substringBefore('?')
        if (!target.startsWith('/') || target.contains("..")) throw BadRequest()
        val query = try {
            rawTarget.substringAfter('?', "").split('&')
                .filter { it.isNotEmpty() }
                .take(16)
                .associate { item ->
                    val name = URLDecoder.decode(item.substringBefore('='), Charsets.UTF_8.name())
                    val value = URLDecoder.decode(item.substringAfter('=', ""), Charsets.UTF_8.name())
                    name to value
                }
        } catch (_: IllegalArgumentException) {
            throw BadRequest()
        }
        val contentLength = headers["content-length"]?.toLongOrNull()
        if (contentLength != null && contentLength < 0) throw BadRequest()
        return HttpRequest(parts[0].uppercase(), target, query, headers, contentLength)
    }

    private fun readLine(input: InputStream, limit: Int): String? {
        val bytes = ArrayList<Byte>()
        while (bytes.size <= limit) {
            val value = input.read()
            if (value < 0) return if (bytes.isEmpty()) null else throw BadRequest()
            if (value == '\n'.code) {
                if (bytes.lastOrNull() == '\r'.code.toByte()) bytes.removeAt(bytes.lastIndex)
                return bytes.toByteArray().toString(Charsets.US_ASCII)
            }
            bytes.add(value.toByte())
        }
        throw BadRequest()
    }

    private fun readBody(input: InputStream, length: Int): ByteArray {
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(body, offset, length - offset)
            if (read <= 0) throw BadRequest()
            offset += read
        }
        return body
    }

    private fun writeTusError(
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        message: String,
        headers: Map<String, String> = emptyMap(),
    ) = writeJson(output, status, reason, JSONObject().put("error", message), tusHeaders() + headers)

    private fun writeJson(
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        value: JSONObject,
        headers: Map<String, String> = emptyMap(),
    ) {
        val bytes = value.toString().toByteArray()
        writeResponse(output, status, reason, headers + mapOf(
            "Content-Type" to "application/json; charset=utf-8",
            "Content-Length" to bytes.size.toString(),
        ), bytes)
    }

    private fun writeResponse(
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        headers: Map<String, String>,
        body: ByteArray? = ByteArray(0),
    ) {
        // Explicitly frame empty tus responses. WebKit otherwise keeps the
        // PATCH pending until the client-side watchdog closes the socket.
        val framedHeaders = if (body != null && headers.keys.none { it.equals("Content-Length", true) }) {
            headers + mapOf("Content-Length" to body.size.toString())
        } else {
            headers
        }
        val common = corsHeaders() + mapOf("Connection" to "close") + framedHeaders
        output.write("HTTP/1.1 $status $reason\r\n".toByteArray(Charsets.US_ASCII))
        for ((name, value) in common) output.write("$name: $value\r\n".toByteArray(Charsets.US_ASCII))
        output.write("\r\n".toByteArray(Charsets.US_ASCII))
        if (body != null) output.write(body)
    }

    private fun tusHeaders() = mapOf("Tus-Resumable" to TUS_VERSION)
    private fun corsHeaders() = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Methods" to "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers" to listOf(
            "Authorization", "Cache-Control", "Content-Type", "Tus-Resumable", "Upload-Length", "Upload-Offset",
            "Upload-Metadata", "X-Kaordo-Chunk-Length", "X-Kaordo-Public-Reservation",
            "X-Kaordo-Rondo-Space", "X-Kaordo-Rondo-Room", LEGACY_CHUNK_LENGTH_HEADER,
            LEGACY_PUBLIC_RESERVATION_HEADER, LEGACY_RONDO_SPACE_HEADER, LEGACY_RONDO_ROOM_HEADER,
        ).joinToString(","),
        "Access-Control-Expose-Headers" to "Location,Tus-Resumable,Tus-Version,Tus-Extension,Tus-Max-Size,Upload-Length,Upload-Offset,Upload-Metadata,Accept-Ranges,Content-Length,Content-Range,ETag",
        "Access-Control-Max-Age" to "600",
        "Access-Control-Allow-Private-Network" to "true",
    )

    private fun metadataFilename(metadata: String): String? = metadata.split(',')
        .map { it.trim() }
        .firstOrNull { it.startsWith("filename ") }
        ?.substringAfter(' ')
        ?.let { runCatching { java.util.Base64.getDecoder().decode(it).toString(Charsets.UTF_8) }.getOrNull() }
        ?.take(180)

    private fun metadataMediaType(metadata: String): String? = metadata.split(',')
        .map { it.trim() }
        .firstOrNull { it.startsWith("filetype ") }
        ?.substringAfter(' ')
        ?.let { runCatching { java.util.Base64.getDecoder().decode(it).toString(Charsets.UTF_8) }.getOrNull() }
        ?.lowercase()
        ?.takeIf { value ->
            value.length <= 120 && (value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/")) &&
                value.all { it.code in 33..126 }
        }

    private fun safeFilename(value: String?): String? = value
        ?.filter { it.code in 32..126 && it !in "\"\\/" }
        ?.trim()
        ?.takeIf { it.isNotEmpty() && it != "." && it != ".." }

    private fun byteRange(value: String, length: Long): LongRange? {
        if (length <= 0 || !value.startsWith("bytes=") || value.contains(',')) return null
        val parts = value.removePrefix("bytes=").split('-', limit = 2)
        if (parts.size != 2) return null
        val startText = parts[0]
        val endText = parts[1]
        if (startText.isEmpty()) {
            val suffix = endText.toLongOrNull()?.takeIf { it > 0 } ?: return null
            return (length - suffix).coerceAtLeast(0)..<length
        }
        val start = startText.toLongOrNull()?.takeIf { it in 0 until length } ?: return null
        val end = if (endText.isEmpty()) length - 1 else {
            endText.toLongOrNull()?.coerceAtMost(length - 1) ?: return null
        }
        return (start..end).takeIf { end >= start }
    }

    private fun mediaType(filename: String): String = when (filename.substringAfterLast('.', "").lowercase()) {
        "gif" -> "image/gif"
        "jpeg", "jpg" -> "image/jpeg"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "avif" -> "image/avif"
        "aac" -> "audio/aac"
        "flac" -> "audio/flac"
        "m4a" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "oga", "ogg" -> "audio/ogg"
        "opus" -> "audio/opus"
        "wav" -> "audio/wav"
        "weba" -> "audio/webm"
        "mp4", "m4v" -> "video/mp4"
        "webm" -> "video/webm"
        "mov" -> "video/quicktime"
        else -> "application/octet-stream"
    }

    private data class HttpRequest(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val headers: Map<String, String>,
        val contentLength: Long?,
    )

    private data class SpacePath(
        val space: NodeSpace,
        val base: String,
        val remainder: String,
    )

    private data class RondoPath(val spaceId: String, val roomId: String, val messageId: String?)
    private data class RondoVoicePath(val spaceId: String, val roomId: String, val action: String)

    private class BadRequest : Exception()

    data class StorageClearResult(
        val deletedBytes: Long,
        val deletedUploads: Int,
        val deletedPosts: Int,
        val publicPostIds: List<String> = emptyList(),
        val publicReservationIds: List<String> = emptyList(),
    )

    data class SpaceStorage(
        val uploads: TusUploadStore,
        val posts: FluoPostStore,
        val messages: RondoMessageStore?,
        val envelopes: LigoEnvelopeStore,
    )

    enum class NodeSpace(val segment: String) { PRIVATE("private"), PUBLIC("public") }

    companion object {
        const val DEFAULT_PORT = 49_321
        const val TUS_VERSION = "1.0.0"
        private const val LEGACY_CHUNK_LENGTH_HEADER = "x-" + "veri" + "dimensio-chunk-length"
        private const val LEGACY_PUBLIC_RESERVATION_HEADER = "x-" + "veri" + "dimensio-public-reservation"
        private const val LEGACY_RONDO_SPACE_HEADER = "x-" + "veri" + "dimensio-rondo-space"
        private const val LEGACY_RONDO_ROOM_HEADER = "x-" + "veri" + "dimensio-rondo-room"
        private const val MAX_FLUO_REQUEST_BYTES = 64 * 1_024L
        private const val DEFAULT_POST_PAGE_SIZE = 20
        private const val DEFAULT_MESSAGE_PAGE_SIZE = 40
        private const val MAX_RONDO_REQUEST_BYTES = 16 * 1_024L
        private const val MAX_VOICE_REQUEST_BYTES = 40 * 1_024L
        private const val MAX_LIGO_REQUEST_BYTES = 80 * 1_024L
        private val STORAGE_ITEMS_PATH = Regex("^/v1/storage/items/(private|public)(?:/([a-z-]+)/([^/]+))?$")
        private val RONDO_PATH = Regex("^/v1/rondo/spaces/([0-9a-f-]{36})/rooms/([0-9a-f-]{36})/messages(?:/([0-9a-f-]{36}))?$")
        private val RONDO_VOICE_PATH = Regex("^/v1/rondo/spaces/([0-9a-f-]{36})/rooms/([0-9a-f-]{36})/voice/(join|sync|peek|signals|leave)$")
    }
}
