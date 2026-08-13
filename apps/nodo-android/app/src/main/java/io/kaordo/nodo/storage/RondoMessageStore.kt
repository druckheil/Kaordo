package io.kaordo.nodo.storage

import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.Locale
import java.util.UUID

class RondoMessageStore(private val root: File, private val uploads: TusUploadStore) {
    @Synchronized
    fun page(spaceId: String, roomId: String, limit: Int, cursor: Long?): Page {
        requireId(spaceId)
        requireId(roomId)
        require(limit in 1..MAX_PAGE_SIZE)
        val directory = roomDirectory(spaceId, roomId)
        val indexFile = File(directory, INDEX_NAME)
        if (!indexFile.isFile) rebuildIndex(directory, indexFile)
        RandomAccessFile(indexFile, "r").use { index ->
            var offset = (cursor ?: index.length()).coerceIn(0, index.length())
            offset -= offset % INDEX_ENTRY_BYTES
            val messages = mutableListOf<Message>()
            val entry = ByteArray(INDEX_ENTRY_BYTES.toInt())
            while (offset >= INDEX_ENTRY_BYTES && messages.size < limit) {
                offset -= INDEX_ENTRY_BYTES
                index.seek(offset)
                index.readFully(entry)
                val id = entry.toString(Charsets.US_ASCII).substring(14, 50)
                val file = messageFile(directory, id)
                if (!file.isFile || file.length() > MAX_MESSAGE_FILE_BYTES) continue
                runCatching { parse(JSONObject(file.readText())) }.getOrNull()?.let(messages::add)
            }
            return Page(messages, offset.takeIf { it > 0 })
        }
    }

    @Synchronized
    fun create(
        spaceId: String,
        roomId: String,
        author: String,
        body: String,
        spaceLimitBytes: Long,
    ): Message {
        requireId(spaceId)
        requireId(roomId)
        require(author.length in 1..32 && !hasControls(author))
        val normalized = body.trim()
        require(normalized.isNotEmpty() && normalized.length <= MAX_BODY_LENGTH && !hasControls(normalized, true))
        require(spaceLimitBytes > 0)
        val message = Message(author, normalized, System.currentTimeMillis(), UUID.randomUUID().toString())
        val bytes = json(message).toString().toByteArray()
        require(bytes.size <= MAX_MESSAGE_FILE_BYTES)
        val spaceDirectory = File(File(root, ROOT_NAME), spaceId)
        if (treeBytes(spaceDirectory) + bytes.size + INDEX_ENTRY_BYTES > spaceLimitBytes) throw QuotaExceeded()
        uploads.requireMetadataCapacity(bytes.size.toLong() + INDEX_ENTRY_BYTES)
        val directory = roomDirectory(spaceId, roomId).apply { mkdirs() }
        val target = messageFile(directory, message.id)
        val temporary = File(directory, ".${message.id}.tmp")
        temporary.writeBytes(bytes)
        moveTemporaryFile(temporary, target, replace = false)
        try {
            appendIndex(File(directory, INDEX_NAME), message)
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
        return message
    }

    @Synchronized
    fun delete(
        spaceId: String,
        roomId: String,
        messageId: String,
        actor: String,
        canModerate: Boolean,
    ): DeleteResult {
        requireId(spaceId)
        requireId(roomId)
        if (!ID.matches(messageId)) return DeleteResult.MISSING
        val file = messageFile(roomDirectory(spaceId, roomId), messageId)
        if (!file.isFile) return DeleteResult.MISSING
        val message = runCatching { parse(JSONObject(file.readText())) }.getOrNull()
            ?: return DeleteResult.MISSING
        if (!canModerate && message.author != actor) return DeleteResult.FORBIDDEN
        return if (file.delete()) DeleteResult.DELETED else DeleteResult.MISSING
    }

    @Synchronized
    fun clearAll(): Long {
        val directory = File(root, ROOT_NAME)
        val bytes = treeBytes(directory)
        if (directory.exists() && !directory.deleteRecursively()) throw ClearFailed()
        return bytes
    }

    private fun appendIndex(indexFile: File, message: Message) {
        val line = String.format(Locale.US, "%013d\t%s\n", message.createdAt, message.id)
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

    private fun rebuildIndex(directory: File, indexFile: File) {
        directory.mkdirs()
        val messages = directory.listFiles().orEmpty().asSequence()
            .filter { it.name.endsWith(SUFFIX) && it.length() <= MAX_MESSAGE_FILE_BYTES }
            .mapNotNull { runCatching { parse(JSONObject(it.readText())) }.getOrNull() }
            .sortedWith(compareBy<Message> { it.createdAt }.thenBy { it.id })
            .toList()
        val temporary = File(directory, ".$INDEX_NAME.tmp")
        RandomAccessFile(temporary, "rw").use { index ->
            messages.forEach { message ->
                val line = String.format(Locale.US, "%013d\t%s\n", message.createdAt, message.id)
                    .toByteArray(Charsets.US_ASCII)
                if (line.size.toLong() == INDEX_ENTRY_BYTES) index.write(line)
            }
        }
        moveTemporaryFile(temporary, indexFile)
    }

    private fun roomDirectory(spaceId: String, roomId: String) =
        File(File(File(root, ROOT_NAME), spaceId), roomId)

    private fun messageFile(directory: File, id: String) = File(directory, "$id$SUFFIX")

    private fun json(message: Message) = JSONObject()
        .put("author", message.author)
        .put("body", message.body)
        .put("createdAt", message.createdAt)
        .put("id", message.id)

    private fun parse(value: JSONObject) = Message(
        author = value.getString("author"),
        body = value.getString("body"),
        createdAt = value.getLong("createdAt"),
        id = value.getString("id"),
    ).also {
        require(ID.matches(it.id))
        require(it.author.length in 1..32 && !hasControls(it.author))
        require(it.body.isNotEmpty() && it.body.length <= MAX_BODY_LENGTH && !hasControls(it.body, true))
    }

    private fun requireId(value: String) = require(ID.matches(value))

    private fun treeBytes(file: File): Long = when {
        file.isFile -> file.length()
        file.isDirectory -> file.listFiles().orEmpty().sumOf(::treeBytes)
        else -> 0
    }

    private fun hasControls(value: String, allowWhitespace: Boolean = false): Boolean = value.any {
        it.code == 127 || (it.code < 32 && !(allowWhitespace && it in "\n\t"))
    }

    data class Message(val author: String, val body: String, val createdAt: Long, val id: String)
    data class Page(val messages: List<Message>, val nextCursor: Long?)
    enum class DeleteResult { DELETED, FORBIDDEN, MISSING }
    class QuotaExceeded : Exception()
    class ClearFailed : Exception()

    companion object {
        const val MAX_BODY_LENGTH = 4_000
        const val MAX_PAGE_SIZE = 50
        private const val INDEX_ENTRY_BYTES = 51L
        private const val INDEX_NAME = ".messages-v1.index"
        private const val MAX_MESSAGE_FILE_BYTES = 12 * 1_024
        private const val ROOT_NAME = "rondo-spaces"
        private const val SUFFIX = ".message.json"
        private val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }
}
