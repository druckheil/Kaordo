package io.kaordo.nodo.storage

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Durable outbox for coordinator cleanup acknowledgements. */
class PublicReconciliationStore(root: File) {
    private val file = File(root, "public-reconciliation.json")
    private val ligoMessageIds = linkedSetOf<String>()
    private val postIds = linkedSetOf<String>()
    private val reservationIds = linkedSetOf<String>()

    init {
        runCatching {
            if (!file.isFile) return@runCatching
            val value = JSONObject(file.readText())
            readIds(value.optJSONArray("ligoMessageIds"), ligoMessageIds)
            readIds(value.optJSONArray("postIds"), postIds)
            readIds(value.optJSONArray("reservationIds"), reservationIds)
        }
    }

    @Synchronized
    fun recordPostDeletion(id: String) {
        if (ID.matches(id)) persistChange { postIds.add(id) }
    }

    @Synchronized
    fun recordLigoMessageDeletion(id: String) {
        if (ID.matches(id)) persistChange { ligoMessageIds.add(id) }
    }

    @Synchronized
    fun recordReservationRelease(id: String) {
        if (ID.matches(id)) persistChange { reservationIds.add(id) }
    }

    @Synchronized
    fun pending(limit: Int = MAX_BATCH): Pending = Pending(
        ligoMessageIds.take(limit),
        postIds.take(limit),
        reservationIds.take(limit),
    )

    @Synchronized
    fun acknowledge(pending: Pending) {
        persistChange {
            ligoMessageIds.removeAll(pending.ligoMessageIds.toSet()) or
                postIds.removeAll(pending.postIds.toSet()) or
                reservationIds.removeAll(pending.reservationIds.toSet())
        }
    }

    private fun persistChange(change: () -> Boolean) {
        val previousLigoMessageIds = ligoMessageIds.toList()
        val previousPostIds = postIds.toList()
        val previousReservationIds = reservationIds.toList()
        if (!change()) return
        try {
            persist()
        } catch (error: Throwable) {
            ligoMessageIds.clear()
            ligoMessageIds.addAll(previousLigoMessageIds)
            postIds.clear()
            postIds.addAll(previousPostIds)
            reservationIds.clear()
            reservationIds.addAll(previousReservationIds)
            throw error
        }
    }

    private fun persist() {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, ".${file.name}.tmp")
        temporary.writeText(JSONObject()
            .put("ligoMessageIds", JSONArray(ligoMessageIds.toList()))
            .put("postIds", JSONArray(postIds.toList()))
            .put("reservationIds", JSONArray(reservationIds.toList()))
            .toString())
        moveTemporaryFile(temporary, file)
    }

    private fun readIds(values: JSONArray?, target: MutableSet<String>) {
        if (values == null) return
        repeat(minOf(values.length(), MAX_STORED)) { index ->
            values.optString(index).takeIf(ID::matches)?.let(target::add)
        }
    }

    data class Pending(
        val ligoMessageIds: List<String>,
        val postIds: List<String>,
        val reservationIds: List<String>,
    )

    private companion object {
        const val MAX_BATCH = 64
        const val MAX_STORED = 4_096
        val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }
}
