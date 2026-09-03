package io.kaordo.nodo.storage

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.Base64
import java.util.Locale
import java.util.UUID

class FluoPostStore(
    root: File,
    private val uploads: TusUploadStore,
    private val legacyOwner: String,
) {
    private val directory = File(root, "fluo-posts").apply { mkdirs() }
    private val indexFile = File(root, ".fluo-posts-v1.index")
    private val stateFile = File(root, ".fluo-posts-v2.state")
    private val publicReservations = mutableMapOf<String, MutableSet<String>>()
    private var stateRevision = 0L
    private var postCount = 0

    init {
        val storedState = readState()
        postCount = rebuildIndex()
        if (storedState == null || storedState.postCount != postCount) {
            stateRevision = (storedState?.revision ?: 0L).coerceAtLeast(0L) + 1L
            persistState()
        } else {
            stateRevision = storedState.revision
        }
    }

    @Synchronized
    fun list(): List<Post> = readPage(MAX_POSTS, null, null).posts

    @Synchronized
    fun page(limit: Int, cursor: Long? = null): Page {
        return page(limit, cursor, null)
    }

    @Synchronized
    fun page(limit: Int, cursor: Long?, author: String?): Page {
        require(limit in 1..MAX_PAGE_SIZE)
        require(author == null || author.length in 1..32 && !hasControls(author))
        return readPage(limit, cursor, author)
    }

    private fun readPage(limit: Int, cursor: Long?, author: String?): Page {
        if (!indexFile.isFile) {
            val rebuiltCount = rebuildIndex()
            if (rebuiltCount != postCount) {
                postCount = rebuiltCount
                advanceState()
            } else {
                postCount = rebuiltCount
            }
        }
        RandomAccessFile(indexFile, "r").use { index ->
            var offset = (cursor ?: index.length()).coerceIn(0, index.length())
            offset -= offset % INDEX_ENTRY_BYTES
            val posts = mutableListOf<Post>()
            val entry = ByteArray(INDEX_ENTRY_BYTES.toInt())
            while (offset >= INDEX_ENTRY_BYTES && posts.size < limit) {
                offset -= INDEX_ENTRY_BYTES
                index.seek(offset)
                index.readFully(entry)
                val id = entry.toString(Charsets.US_ASCII).substring(14, 50)
                if (!ID.matches(id)) continue
                val file = postFile(id)
                if (!file.isFile || file.length() > MAX_POST_FILE_BYTES) continue
                runCatching { parse(JSONObject(file.readText())) }.getOrNull()?.let { post ->
                    if (author == null || post.author.equals(author, ignoreCase = true)) posts += post
                }
            }
            return Page(posts, offset.takeIf { it > 0 })
        }
    }

    @Synchronized
    fun create(
        author: String,
        body: String,
        attachments: List<Attachment>,
        publicReservationId: String? = null,
        quote: QuotedPost? = null,
    ): Post {
        require(author.length in 1..32 && !hasControls(author))
        val normalizedBody = body.trim()
        require(normalizedBody.length <= MAX_BODY_LENGTH)
        require(normalizedBody.isNotEmpty() || attachments.isNotEmpty() || quote != null)
        require(validAttachmentCount(attachments))
        require(attachments.map { it.id }.distinct().size == attachments.size)
        quote?.let(::validateQuote)
        if (publicReservationId != null && hasPublicReservation(publicReservationId)) {
            throw PublicReservationUsed()
        }
        for (attachment in attachments) {
            validateAttachmentMetadata(attachment)
            val (record, file) = uploads.completedFile(attachment.id) ?: throw MissingMedia()
            if (record.createdBy != author && !(record.createdBy == null && author == legacyOwner)) {
                throw MissingMedia()
            }
            if (publicReservationId != null && record.publicReservationId != publicReservationId) {
                throw MissingMedia()
            }
            if (file.length() != attachment.size) throw MissingMedia()
        }
        val post = Post(
            attachments = attachments,
            author = author,
            body = normalizedBody,
            createdAt = System.currentTimeMillis(),
            id = UUID.randomUUID().toString(),
            publicReservationId = publicReservationId,
            quote = quote,
        )
        write(post)
        try {
            appendIndex(post)
        } catch (error: Throwable) {
            postFile(post.id).delete()
            // Media is written before the compact index. Roll it back too so
            // a failed index write cannot leave quota-consuming orphan files.
            post.attachments.forEach { attachment ->
                runCatching { uploads.delete(attachment.id, isNodeOwner = true) }
            }
            throw error
        }
        post.publicReservationId?.let { reservation ->
            publicReservations.getOrPut(reservation) { mutableSetOf() }.add(post.id)
        }
        postCount += 1
        advanceState()
        return post
    }

    @Synchronized
    fun delete(id: String, actor: String? = null, isNodeOwner: Boolean = true): DeleteResult {
        if (!ID.matches(id)) return DeleteResult.MISSING
        val file = postFile(id)
        if (!file.isFile) return DeleteResult.MISSING
        val post = runCatching { parse(JSONObject(file.readText())) }.getOrNull()
        if (!isNodeOwner && (actor == null || post?.author != actor)) return DeleteResult.FORBIDDEN
        if (!file.delete()) return DeleteResult.MISSING
        removePublicReservation(post?.publicReservationId, id)
        post?.attachments?.forEach { uploads.delete(it.id, actor, isNodeOwner) }
        postCount = (postCount - 1).coerceAtLeast(0)
        advanceState()
        return DeleteResult.DELETED
    }

    @Synchronized
    fun clearAll(): ClearResult {
        val files = directory.listFiles().orEmpty().filter { it.isFile }
        val postIds = files.asSequence()
            .filter { it.name.endsWith(SUFFIX) }
            .map { it.name.removeSuffix(SUFFIX) }
            .filter(ID::matches)
            .distinct()
            .toList()
        val result = ClearResult(
            deletedBytes = files.sumOf { it.length() },
            deletedPosts = files.count { it.name.endsWith(SUFFIX) },
            postIds = postIds,
        )
        if (files.any { it.exists() && !it.delete() }) throw ClearFailed()
        indexFile.writeBytes(ByteArray(0))
        publicReservations.clear()
        if (postCount > 0 || result.deletedPosts > 0) {
            postCount = 0
            advanceState()
        }
        return result
    }

    @Synchronized
    fun eraseOwner(owner: String) {
        list().filter { it.author == owner }.forEach { post ->
            delete(post.id, owner, true)
        }
    }

    @Synchronized
    fun hasPublicReservation(id: String): Boolean = id in publicReservations

    @Synchronized
    fun state(): FeedState = FeedState(stateHash(), postCount)

    private fun write(post: Post) {
        val target = postFile(post.id)
        val temporary = File(directory, ".${post.id}.tmp")
        val bytes = json(post).toString().toByteArray()
        uploads.requireMetadataCapacity(bytes.size.toLong())
        temporary.writeBytes(bytes)
        moveTemporaryFile(temporary, target, replace = false)
    }

    private fun appendIndex(post: Post) {
        val line = String.format(Locale.US, "%013d\t%s\n", post.createdAt, post.id)
            .toByteArray(Charsets.US_ASCII)
        check(line.size.toLong() == INDEX_ENTRY_BYTES)
        RandomAccessFile(indexFile, "rw").use { index ->
            val originalLength = index.length()
            try {
                index.seek(originalLength)
                index.write(line)
            } catch (error: Throwable) {
                index.setLength(originalLength)
                throw error
            }
        }
    }

    private fun rebuildIndex(): Int {
        val posts = directory.listFiles().orEmpty().asSequence()
            .filter { it.name.endsWith(SUFFIX) && it.length() <= MAX_POST_FILE_BYTES }
            .mapNotNull { runCatching { parse(JSONObject(it.readText())) }.getOrNull() }
            .sortedWith(compareBy<Post> { it.createdAt }.thenBy { it.id })
            .toList()
        publicReservations.clear()
        posts.forEach { post ->
            post.publicReservationId?.let { reservation ->
                publicReservations.getOrPut(reservation) { mutableSetOf() }.add(post.id)
            }
        }
        val temporary = File(directory, ".${indexFile.name}.tmp")
        RandomAccessFile(temporary, "rw").use { index ->
            posts.forEach { post ->
                val line = String.format(Locale.US, "%013d\t%s\n", post.createdAt, post.id)
                    .toByteArray(Charsets.US_ASCII)
                if (line.size.toLong() == INDEX_ENTRY_BYTES) index.write(line)
            }
        }
        moveTemporaryFile(temporary, indexFile)
        return posts.size
    }

    private fun readState(): StoredState? = runCatching {
        if (!stateFile.isFile) return@runCatching null
        val value = JSONObject(stateFile.readText())
        val revision = value.optLong("revision", -1L)
        val count = value.optInt("postCount", -1)
        if (revision < 0L || count < 0) null else StoredState(revision, count)
    }.getOrNull()

    private fun advanceState() {
        stateRevision = if (stateRevision == Long.MAX_VALUE) 1L else stateRevision + 1L
        persistState()
    }

    private fun persistState() {
        val temporary = File(stateFile.parentFile, ".${stateFile.name}.tmp")
        temporary.writeText(JSONObject()
            .put("postCount", postCount)
            .put("revision", stateRevision)
            .toString())
        moveTemporaryFile(temporary, stateFile)
    }

    private fun stateHash(): String {
        val bytes = MessageDigest.getInstance("SHA-256")
            .digest("$stateRevision:$postCount".toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun postFile(id: String) = File(directory, "$id$SUFFIX")

    private fun removePublicReservation(reservationId: String?, postId: String) {
        if (reservationId !== null) {
            publicReservations[reservationId]?.let { posts ->
                posts.remove(postId)
                if (posts.isEmpty()) publicReservations.remove(reservationId)
            }
            return
        }
        publicReservations.entries.removeAll { (_, posts) ->
            posts.remove(postId)
            posts.isEmpty()
        }
    }

    private fun json(post: Post) = JSONObject()
        .put("attachments", JSONArray(post.attachments.map(::json)))
        .put("author", post.author)
        .put("body", post.body)
        .put("createdAt", post.createdAt)
        .put("id", post.id)
        .apply {
            post.publicReservationId?.let { put("publicReservationId", it) }
            post.quote?.let { put("quote", json(it)) }
        }

    private fun json(quote: QuotedPost) = JSONObject()
        .put("attachments", JSONArray(quote.attachments.map(::json)))
        .put("author", quote.author)
        .put("body", quote.body)
        .put("createdAt", quote.createdAt)
        .put("id", quote.id)
        .put("nodeId", quote.nodeId)
        .put("space", quote.space)

    private fun json(attachment: Attachment) = JSONObject()
        .put("id", attachment.id)
        .put("kind", attachment.kind)
        .put("mimeType", attachment.mimeType)
        .put("name", attachment.name)
        .put("size", attachment.size)
        .apply {
            attachment.width?.let { put("width", it) }
            attachment.height?.let { put("height", it) }
        }

    private fun parse(value: JSONObject): Post {
        val items = value.getJSONArray("attachments")
        require(items.length() <= MAX_ATTACHMENTS)
        return Post(
            attachments = List(items.length()) { index -> parseAttachment(items.getJSONObject(index)) },
            author = value.getString("author"),
            body = value.getString("body"),
            createdAt = value.getLong("createdAt"),
            id = value.getString("id"),
            publicReservationId = value.optString("publicReservationId").takeIf { it.isNotBlank() },
            quote = value.optJSONObject("quote")?.let(::parseQuote),
        ).also {
            require(ID.matches(it.id) && it.body.length <= MAX_BODY_LENGTH)
            require(it.author.length in 1..32 && !hasControls(it.author))
            require(validAttachmentCount(it.attachments))
            it.attachments.forEach(::validateAttachmentMetadata)
        }
    }

    private fun parseQuote(value: JSONObject): QuotedPost {
        val items = value.optJSONArray("attachments") ?: JSONArray()
        require(items.length() <= MAX_ATTACHMENTS)
        val quote = QuotedPost(
            attachments = List(items.length()) { index -> parseAttachment(items.getJSONObject(index)) },
            author = value.getString("author"),
            body = value.optString("body", ""),
            createdAt = value.getLong("createdAt"),
            id = value.getString("id"),
            nodeId = value.getString("nodeId"),
            space = value.getString("space"),
        )
        validateQuote(quote)
        return quote
    }

    private fun parseAttachment(item: JSONObject) = Attachment(
        id = item.getString("id"),
        kind = item.getString("kind"),
        mimeType = item.getString("mimeType"),
        name = item.getString("name"),
        size = item.getLong("size"),
        width = item.optInt("width", 0).takeIf { it > 0 },
        height = item.optInt("height", 0).takeIf { it > 0 },
    ).also(::validateAttachmentMetadata)

    private fun validateQuote(quote: QuotedPost) {
        require(ID.matches(quote.id))
        require(quote.nodeId.length in 1..120 && !hasControls(quote.nodeId))
        require(quote.space == "private" || quote.space == "public")
        require(quote.author.length in 1..32 && !hasControls(quote.author))
        require(quote.body.length <= MAX_BODY_LENGTH)
        require(validAttachmentCount(quote.attachments))
        quote.attachments.forEach(::validateAttachmentMetadata)
    }

    private fun validateAttachmentMetadata(attachment: Attachment) {
        require(ID.matches(attachment.id))
        require(attachment.kind in KINDS)
        require(attachment.mimeType.length in 1..120 && !hasControls(attachment.mimeType))
        require(attachment.name.length in 1..180 && !hasControls(attachment.name))
        require(attachment.size >= 0)
        require((attachment.width == null) == (attachment.height == null))
        require(attachment.width == null || attachment.width in 1..MAX_MEDIA_DIMENSION)
        require(attachment.height == null || attachment.height in 1..MAX_MEDIA_DIMENSION)
    }

    private fun hasControls(value: String) = value.any { it.code < 32 || it.code == 127 }

    data class Attachment(
        val id: String,
        val kind: String,
        val mimeType: String,
        val name: String,
        val size: Long,
        val width: Int? = null,
        val height: Int? = null,
    )

    data class Post(
        val attachments: List<Attachment>,
        val author: String,
        val body: String,
        val createdAt: Long,
        val id: String,
        val publicReservationId: String?,
        val quote: QuotedPost? = null,
    )

    data class QuotedPost(
        val attachments: List<Attachment>,
        val author: String,
        val body: String,
        val createdAt: Long,
        val id: String,
        val nodeId: String,
        val space: String,
    )

    data class Page(val posts: List<Post>, val nextCursor: Long?)

    data class FeedState(val stateHash: String, val postCount: Int)

    private data class StoredState(val revision: Long, val postCount: Int)

    data class ClearResult(
        val deletedBytes: Long,
        val deletedPosts: Int,
        val postIds: List<String>,
    )

    class MissingMedia : Exception()
    class PublicReservationUsed : Exception()
    class ClearFailed : Exception()
    enum class DeleteResult { DELETED, FORBIDDEN, MISSING }

    companion object {
        const val MAX_ATTACHMENTS = 9
        const val MAX_MEDIA_ATTACHMENTS = 4
        const val MAX_AUDIO_ATTACHMENTS = 5
        private const val MAX_MEDIA_DIMENSION = 100_000
        const val MAX_BODY_LENGTH = 5_000
        private const val MAX_POST_FILE_BYTES = 32 * 1_024L
        private const val MAX_POSTS = 2_000
        const val MAX_PAGE_SIZE = 50
        private const val INDEX_ENTRY_BYTES = 51L
        private const val SUFFIX = ".post.json"
        private val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        private val KINDS = setOf("audio", "gif", "image", "video")

        private fun validAttachmentCount(attachments: List<Attachment>): Boolean {
            val audioCount = attachments.count { it.kind == "audio" }
            val mediaCount = attachments.size - audioCount
            return attachments.size <= MAX_ATTACHMENTS &&
                audioCount <= MAX_AUDIO_ATTACHMENTS && mediaCount <= MAX_MEDIA_ATTACHMENTS
        }
    }
}
