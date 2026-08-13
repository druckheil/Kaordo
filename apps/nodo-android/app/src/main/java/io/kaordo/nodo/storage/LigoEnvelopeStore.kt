package io.kaordo.nodo.storage

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class LigoEnvelopeStore(root: File, private val uploads: TusUploadStore) {
    private val directory = File(root, ROOT_NAME).apply { mkdirs() }

    @Synchronized
    fun create(
        id: String,
        sender: String,
        recipient: String,
        body: String,
        attachments: List<Attachment>,
        publicReservationId: String?,
    ): Envelope {
        require(ID.matches(id))
        requireUsername(sender)
        requireUsername(recipient)
        require(sender != recipient)
        val normalized = body.trim()
        require(normalized.length <= MAX_BODY_LENGTH && !hasControls(normalized, true))
        require(attachments.size <= MAX_ATTACHMENTS)
        require(normalized.isNotEmpty() || attachments.isNotEmpty())
        require(attachments.map { it.id }.distinct().size == attachments.size)
        attachments.forEach { attachment ->
            require(ID.matches(attachment.id))
            require(attachment.name.length in 1..180 && !hasControls(attachment.name))
            require(attachment.mimeType.length in 1..120 && !hasControls(attachment.mimeType))
            require(attachment.size >= 0)
            val (record, file) = uploads.completedFile(attachment.id) ?: throw MissingAttachment()
            if (record.createdBy != sender || file.length() != attachment.size ||
                (publicReservationId != null && record.publicReservationId != publicReservationId)) {
                throw MissingAttachment()
            }
        }
        val envelope = Envelope(attachments, normalized, System.currentTimeMillis(), id, recipient, sender)
        val bytes = json(envelope).toString().toByteArray()
        require(bytes.size <= MAX_ENVELOPE_BYTES)
        uploads.requireMetadataCapacity(bytes.size.toLong())
        val target = file(id)
        if (target.exists()) throw AlreadyExists()
        val temporary = File(directory, ".$id.tmp")
        temporary.writeBytes(bytes)
        moveTemporaryFile(temporary, target, replace = false)
        return envelope
    }

    @Synchronized
    fun read(id: String, actor: String): Envelope? {
        if (!ID.matches(id)) return null
        val envelope = parseFile(file(id)) ?: return null
        return envelope.takeIf { it.sender == actor || it.recipient == actor }
    }

    @Synchronized
    fun delete(id: String, actor: String): DeleteResult {
        if (!ID.matches(id)) return DeleteResult.MISSING
        val target = file(id)
        val envelope = parseFile(target) ?: return DeleteResult.MISSING
        if (envelope.sender != actor && envelope.recipient != actor) return DeleteResult.FORBIDDEN
        envelope.attachments.forEach { uploads.delete(it.id, null, true) }
        return if (target.delete()) DeleteResult.DELETED else DeleteResult.MISSING
    }

    @Synchronized
    fun clearAll(): Long {
        val bytes = directory.listFiles().orEmpty().filter { it.isFile }.sumOf { it.length() }
        if (directory.exists() && !directory.deleteRecursively()) throw ClearFailed()
        directory.mkdirs()
        return bytes
    }

    private fun parseFile(target: File): Envelope? = target.takeIf {
        it.isFile && it.length() <= MAX_ENVELOPE_BYTES
    }?.let { runCatching { parse(JSONObject(it.readText())) }.getOrNull() }

    private fun file(id: String) = File(directory, "$id$SUFFIX")

    private fun json(envelope: Envelope) = JSONObject()
        .put("attachments", JSONArray(envelope.attachments.map { attachment -> JSONObject()
            .put("id", attachment.id)
            .put("mimeType", attachment.mimeType)
            .put("name", attachment.name)
            .put("size", attachment.size) }))
        .put("body", envelope.body)
        .put("createdAt", envelope.createdAt)
        .put("id", envelope.id)
        .put("recipient", envelope.recipient)
        .put("sender", envelope.sender)

    private fun parse(value: JSONObject): Envelope {
        val attachments = value.getJSONArray("attachments")
        require(attachments.length() <= MAX_ATTACHMENTS)
        return Envelope(
            attachments = List(attachments.length()) { index -> attachments.getJSONObject(index).let {
                Attachment(it.getString("id"), it.getString("mimeType"), it.getString("name"), it.getLong("size"))
            } },
            body = value.getString("body"),
            createdAt = value.getLong("createdAt"),
            id = value.getString("id"),
            recipient = value.getString("recipient"),
            sender = value.getString("sender"),
        ).also { envelope ->
            require(ID.matches(envelope.id))
            requireUsername(envelope.sender)
            requireUsername(envelope.recipient)
            require(envelope.body.length <= MAX_BODY_LENGTH && !hasControls(envelope.body, true))
            envelope.attachments.forEach { require(ID.matches(it.id) && it.size >= 0) }
        }
    }

    private fun requireUsername(value: String) = require(USERNAME.matches(value))
    private fun hasControls(value: String, allowWhitespace: Boolean = false) = value.any {
        it.code == 127 || (it.code < 32 && !(allowWhitespace && it in "\n\t"))
    }

    data class Attachment(val id: String, val mimeType: String, val name: String, val size: Long)
    data class Envelope(
        val attachments: List<Attachment>,
        val body: String,
        val createdAt: Long,
        val id: String,
        val recipient: String,
        val sender: String,
    )
    enum class DeleteResult { DELETED, FORBIDDEN, MISSING }
    class AlreadyExists : Exception()
    class MissingAttachment : Exception()
    class ClearFailed : Exception()

    companion object {
        const val MAX_ATTACHMENTS = 12
        const val MAX_BODY_LENGTH = 16_000
        private const val MAX_ENVELOPE_BYTES = 64 * 1_024L
        private const val ROOT_NAME = "ligo-envelopes"
        private const val SUFFIX = ".envelope.json"
        private val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        private val USERNAME = Regex("^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$")
    }
}
