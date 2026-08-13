package io.kaordo.nodo.storage

import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.Properties
import java.util.UUID

class TusUploadStore(
    root: File,
    quotaBytes: Long,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Volatile private var quotaBytes = quotaBytes
    private val dataDirectory = File(root, "files").apply { mkdirs() }
    private val metadataDirectory = File(root, "fluo-posts").apply { mkdirs() }
    private val rondoDirectory = File(root, "rondo-spaces").apply { mkdirs() }
    private val ligoDirectory = File(root, "ligo-envelopes").apply { mkdirs() }
    private val recordDirectory = File(root, "records").apply { mkdirs() }

    @Synchronized
    fun create(
        length: Long,
        metadata: String,
        createdBy: String? = null,
        publicReservationId: String? = null,
        publicReservationBytes: Long? = null,
    ): UploadRecord {
        require(length >= 0) { "Upload-Length must be non-negative." }
        require((publicReservationId == null) == (publicReservationBytes == null))
        if (publicReservationId != null) {
            require(publicReservationId.isNotBlank() && publicReservationBytes!! > 0)
            val alreadyReserved = recordDirectory.listFiles().orEmpty()
                .filter { it.extension == "properties" }
                .mapNotNull { runCatching { readRecord(it) }.getOrNull() }
                .filter { it.publicReservationId == publicReservationId }
                .sumOf { it.length }
            if (alreadyReserved + length > publicReservationBytes) throw QuotaExceeded()
        }
        if (reservedBytes() + length > quotaBytes) throw QuotaExceeded()
        val now = clock()
        val record = UploadRecord(
            complete = length == 0L,
            createdAt = now,
            id = UUID.randomUUID().toString(),
            length = length,
            metadata = metadata,
            offset = 0,
            updatedAt = now,
            createdBy = createdBy,
            publicReservationId = publicReservationId,
        )
        val data = dataFile(record.id)
        check(data.createNewFile()) { "Upload data file could not be created." }
        try {
            writeRecord(record)
        } catch (error: Throwable) {
            data.delete()
            recordFile(record.id).delete()
            File(recordDirectory, ".${record.id}.tmp").delete()
            throw error
        }
        return record
    }

    @Synchronized
    fun record(id: String): UploadRecord? {
        if (!isId(id)) return null
        val file = recordFile(id)
        if (!file.isFile) return null
        return runCatching { readRecord(file) }.getOrNull()
    }

    @Synchronized
    fun append(
        id: String,
        expectedOffset: Long,
        contentLength: Long,
        input: InputStream,
        actor: String? = null,
        isNodeOwner: Boolean = true,
    ): UploadRecord {
        val current = record(id) ?: throw UploadMissing()
        if (!isNodeOwner && (actor == null || current.createdBy != actor)) throw AccessDenied()
        if (current.complete) throw OffsetMismatch(current.offset)
        if (expectedOffset != current.offset) throw OffsetMismatch(current.offset)
        if (contentLength < 0 || contentLength > current.length - current.offset) {
            throw InvalidChunk()
        }

        val file = dataFile(id)
        var failure: Throwable? = null
        RandomAccessFile(file, "rw").use { output ->
            output.seek(current.offset)
            var remaining = contentLength
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            try {
                while (remaining > 0) {
                    val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                    if (read <= 0) throw InvalidChunk()
                    output.write(buffer, 0, read)
                    remaining -= read
                }
            } catch (error: Throwable) {
                failure = error
            }
        }
        val offset = file.length().coerceAtMost(current.length)
        val next = current.copy(
            offset = offset,
            complete = offset == current.length,
            updatedAt = clock(),
        )
        writeRecord(next)
        failure?.let { throw it }
        return next
    }

    @Synchronized
    fun delete(id: String, actor: String? = null, isNodeOwner: Boolean = true): Boolean {
        if (!isId(id) || !recordFile(id).exists()) return false
        val record = record(id) ?: return false
        if (!isNodeOwner && (actor == null || record.createdBy != actor)) return false
        val dataDeleted = !dataFile(id).exists() || dataFile(id).delete()
        val recordDeleted = recordFile(id).delete()
        return dataDeleted && recordDeleted
    }

    @Synchronized
    fun clearAll(): ClearResult {
        val dataFiles = dataDirectory.listFiles().orEmpty().filter { it.isFile }
        val recordFiles = recordDirectory.listFiles().orEmpty().filter { it.isFile }
        val publicReservationIds = recordFiles.mapNotNull {
            runCatching { readRecord(it).publicReservationId }.getOrNull()
        }.distinct()
        val result = ClearResult(
            deletedBytes = dataFiles.sumOf { it.length() },
            deletedUploads = recordFiles.count { it.extension == "properties" },
            publicReservationIds = publicReservationIds,
        )
        if ((dataFiles + recordFiles).any { it.exists() && !it.delete() }) throw ClearFailed()
        return result
    }

    @Synchronized
    fun cleanupStalePartials(maxIdleMillis: Long): CleanupResult {
        require(maxIdleMillis > 0)
        val cutoff = clock() - maxIdleMillis
        val recordFiles = recordDirectory.listFiles().orEmpty().filter { it.isFile }
        val records = recordFiles.associateWith { runCatching { readRecord(it) }.getOrNull() }
        val staleRecords = records.filter { (file, record) ->
            record?.let { !it.complete && it.updatedAt <= cutoff }
                ?: (file.lastModified() <= cutoff)
        }
        val staleRecordKeys = staleRecords.map { (file, record) -> record?.id ?: file.name }.toSet()
        val staleIds = staleRecords.values.mapNotNull { it?.id }.filter(::isId).toSet()
        val validIds = records.values.mapNotNull { it?.id }.filter(::isId).toSet()
        val orphanData = dataDirectory.listFiles().orEmpty().filter { file ->
            if (!file.isFile || file.extension != "data" || file.lastModified() > cutoff) return@filter false
            val id = file.name.removeSuffix(".data")
            id !in validIds || id in staleIds
        }
        val pairedData = staleIds.map(::dataFile).filter { it.isFile }
        val targets = (staleRecords.keys + orphanData + pairedData).distinct()
        val result = CleanupResult(
            deletedBytes = (orphanData + pairedData).distinct().sumOf { it.length() },
            deletedUploads = (staleRecordKeys + orphanData.map { it.name.removeSuffix(".data") }).size,
            publicReservationIds = staleRecords.values.mapNotNull { it?.publicReservationId }.distinct(),
        )
        if (targets.any { it.exists() && !it.delete() }) throw ClearFailed()
        return result
    }

    @Synchronized
    fun usedBytes(): Long = dataBytes() + metadataBytes()

    @Synchronized
    fun requireMetadataCapacity(bytes: Long) {
        require(bytes >= 0)
        if (reservedBytes() + bytes > quotaBytes) throw QuotaExceeded()
    }

    fun quotaBytes(): Long = quotaBytes

    @Synchronized
    fun setQuotaBytes(value: Long) {
        require(value >= usedBytes()) { "Space quota cannot be smaller than stored data." }
        quotaBytes = value
    }

    @Synchronized
    fun uploadCount(): Int = recordDirectory.listFiles()?.count { it.extension == "properties" } ?: 0

    fun completedFile(id: String): Pair<UploadRecord, File>? {
        val record = record(id)?.takeIf { it.complete } ?: return null
        val file = dataFile(id).takeIf { it.isFile } ?: return null
        return record to file
    }

    private fun reservedBytes(): Long {
        val records = recordDirectory.listFiles().orEmpty()
            .filter { it.extension == "properties" }
            .mapNotNull { runCatching { readRecord(it) }.getOrNull() }
        val knownIds = records.map { it.id }.toSet()
        val orphanBytes = dataDirectory.listFiles().orEmpty().sumOf { file ->
            if (file.isFile && file.extension == "data" &&
                file.name.removeSuffix(".data") !in knownIds) file.length() else 0L
        }
        return records.sumOf { it.length } + orphanBytes + metadataBytes()
    }

    private fun dataBytes(): Long = dataDirectory.listFiles().orEmpty().sumOf { it.length() }

    private fun metadataBytes(): Long =
        treeBytes(metadataDirectory) + treeBytes(rondoDirectory) + treeBytes(ligoDirectory)

    private fun treeBytes(file: File): Long = when {
        file.isFile -> file.length()
        file.isDirectory -> file.listFiles().orEmpty().sumOf(::treeBytes)
        else -> 0
    }

    private fun writeRecord(record: UploadRecord) {
        val target = recordFile(record.id)
        val temporary = File(recordDirectory, ".${record.id}.tmp")
        val properties = Properties().apply {
            setProperty("complete", record.complete.toString())
            setProperty("createdAt", record.createdAt.toString())
            setProperty("id", record.id)
            setProperty("length", record.length.toString())
            setProperty("metadata", record.metadata)
            setProperty("offset", record.offset.toString())
            setProperty("updatedAt", record.updatedAt.toString())
            record.createdBy?.let { setProperty("createdBy", it) }
            record.publicReservationId?.let { setProperty("publicReservationId", it) }
        }
        temporary.outputStream().buffered().use { properties.store(it, null) }
        moveTemporaryFile(temporary, target)
    }

    private fun readRecord(file: File): UploadRecord {
        val properties = Properties().apply {
            file.inputStream().buffered().use(::load)
        }
        val createdAt = properties.getProperty("createdAt").toLong()
        return UploadRecord(
            complete = properties.getProperty("complete").toBooleanStrict(),
            createdAt = createdAt,
            id = properties.getProperty("id"),
            length = properties.getProperty("length").toLong(),
            metadata = properties.getProperty("metadata", ""),
            offset = properties.getProperty("offset").toLong(),
            updatedAt = properties.getProperty("updatedAt")?.toLongOrNull() ?: createdAt,
            createdBy = properties.getProperty("createdBy")?.takeIf { it.isNotBlank() },
            publicReservationId = properties.getProperty("publicReservationId")?.takeIf { it.isNotBlank() },
        )
    }

    private fun dataFile(id: String) = File(dataDirectory, "$id.data")
    private fun recordFile(id: String) = File(recordDirectory, "$id.properties")
    private fun isId(id: String) = ID_PATTERN.matches(id)

    data class UploadRecord(
        val complete: Boolean,
        val createdAt: Long,
        val id: String,
        val length: Long,
        val metadata: String,
        val offset: Long,
        val updatedAt: Long,
        val createdBy: String?,
        val publicReservationId: String?,
    )

    data class ClearResult(
        val deletedBytes: Long,
        val deletedUploads: Int,
        val publicReservationIds: List<String>,
    )
    data class CleanupResult(
        val deletedBytes: Long,
        val deletedUploads: Int,
        val publicReservationIds: List<String>,
    )

    class ClearFailed : Exception()
    class AccessDenied : Exception()
    class QuotaExceeded : Exception()
    class UploadMissing : Exception()
    class InvalidChunk : Exception()
    class OffsetMismatch(val correctOffset: Long) : Exception()

    private companion object {
        val ID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }
}
