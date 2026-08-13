package io.kaordo.nodo.data

import io.kaordo.nodo.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

class NodeAccessClient {
    private val http = NodeHttpClients.withReadTimeout(15)
    private val cache = BoundedExpiringCache<String, AccessGrant>(
        maxSize = MAX_CACHE_ENTRIES,
        isValid = { value, now -> value.expiresAt > now },
        clock = { System.currentTimeMillis() / 1_000 },
    )

    fun verify(
        ticket: String,
        nodeId: String?,
        reservationId: String? = null,
        rondoSpaceId: String? = null,
        rondoRoomId: String? = null,
    ): AccessGrant? {
        if (nodeId == null || ticket.length != 43) return null
        val key = "$nodeId:${hash(ticket)}:${reservationId.orEmpty()}:${rondoSpaceId.orEmpty()}:${rondoRoomId.orEmpty()}"
        val now = System.currentTimeMillis() / 1_000
        cache[key]?.let { return it }
        val body = JSONObject()
            .put("nodeId", nodeId)
            .put("ticket", ticket)
            .apply {
                reservationId?.let { put("reservationId", it) }
                rondoSpaceId?.let { put("rondoSpaceId", it) }
                rondoRoomId?.let { put("rondoRoomId", it) }
            }
            .toString()
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/nodes/tickets/verify")
            .post(body.toRequestBody(JSON))
            .build()
        return runCatching {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val value = JSONObject(response.body.string())
                val expiresAt = value.optLong("expiresAt", 0)
                val username = value.optString("username")
                if (!value.optBoolean("authorized") || expiresAt <= now || username.isBlank()) {
                    return@use null
                }
                AccessGrant(
                    expiresAt = expiresAt,
                    isOwner = value.optBoolean("isOwner", false),
                    publicReservation = value.optJSONObject("publicReservation")?.let {
                        PublicReservation(it.getString("id"), it.getLong("bytes"))
                    },
                    rondo = value.optJSONObject("rondo")?.let {
                        RondoGrant(
                            limitBytes = it.getLong("limitBytes"),
                            owner = it.optBoolean("owner", false),
                            roomId = it.getString("roomId"),
                            spaceId = it.getString("spaceId"),
                            storage = it.getString("storage"),
                        )
                    },
                    username = username,
                ).also { grant ->
                    // Base tickets are safe to cache. A reservation must be
                    // rechecked so a committed/expired grant stops immediately.
                    if (reservationId == null) cache[key] = grant
                }
            }
        }.getOrNull()
    }

    private fun hash(value: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()),
    )

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val MAX_CACHE_ENTRIES = 512
    }

    data class AccessGrant(
        val expiresAt: Long,
        val isOwner: Boolean,
        val publicReservation: PublicReservation?,
        val username: String,
        val rondo: RondoGrant? = null,
    )

    data class PublicReservation(val id: String, val bytes: Long)
    data class RondoGrant(
        val limitBytes: Long,
        val owner: Boolean,
        val roomId: String,
        val spaceId: String,
        val storage: String,
    )
}
