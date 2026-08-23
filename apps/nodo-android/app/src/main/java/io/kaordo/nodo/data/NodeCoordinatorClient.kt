package io.kaordo.nodo.data

import io.kaordo.nodo.BuildConfig
import io.kaordo.nodo.model.NodeMetrics
import io.kaordo.nodo.model.NodePolicy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import kotlin.system.measureNanoTime

class NodeCoordinatorClient {
    private val http = NodeHttpClients.withReadTimeout(20)

    fun measureLatency(): Long {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/health?fresh=${System.currentTimeMillis()}")
            .header("Cache-Control", "no-cache, no-store")
            .get()
            .build()
        var status = 0
        val nanos = measureNanoTime {
            NodeHttpClients.withTimeout(3).newCall(request).execute().use { response ->
                status = response.code
                response.body.close()
            }
        }
        if (status !in 200..299) throw IllegalStateException("Coordinator latency test failed.")
        return (nanos / 1_000_000).coerceAtLeast(0)
    }

    fun heartbeat(
        token: String,
        nodeId: String?,
        deviceKey: String,
        slotKey: String,
        deviceName: String,
        localAddresses: List<String>,
        port: Int,
        quotaBytes: Long,
        privateUsedBytes: Long,
        publicUsedBytes: Long,
        metrics: NodeMetrics,
        testCompletedAt: Long?,
        deletedLigoMessageIds: List<String>,
        deletedPublicPostIds: List<String>,
        releasedPublicReservationIds: List<String>,
    ): HeartbeatResult {
        val body = JSONObject()
            .put("nodeId", nodeId)
            .put("deviceKey", deviceKey)
            .put("slotKey", slotKey)
            .put("deviceName", deviceName.take(80))
            .put("localAddresses", JSONArray(localAddresses))
            .put("port", port)
            .put("protocol", "tus/1.0.0")
            .put("quotaBytes", quotaBytes)
            .put("usedBytes", privateUsedBytes + publicUsedBytes)
            .put("spaces", JSONObject()
                .put("privateUsedBytes", privateUsedBytes)
                .put("publicUsedBytes", publicUsedBytes))
            .put("metrics", JSONObject()
                .put("androidSdk", metrics.androidSdk)
                .put("appVersion", metrics.appVersion)
                .put("batteryPercent", metrics.batteryPercent)
                .put("charging", metrics.charging)
                .put("coordinatorLatencyMs", metrics.coordinatorLatencyMs)
                .put("diskReadBps", metrics.diskReadBps)
                .put("diskWriteBps", metrics.diskWriteBps)
                .put("memoryAvailableBytes", metrics.memoryAvailableBytes)
                .put("memoryTotalBytes", metrics.memoryTotalBytes)
                .put("networkMetered", metrics.networkMetered)
                .put("networkDownBps", metrics.networkDownBps)
                .put("networkType", metrics.networkType)
                .put("networkUpBps", metrics.networkUpBps)
                .put("storageAvailableBytes", metrics.storageAvailableBytes))
            .put("testCompletedAt", testCompletedAt)
            .put("deletedLigoMessageIds", JSONArray(deletedLigoMessageIds))
            .put("deletedPublicPostIds", JSONArray(deletedPublicPostIds))
            .put("releasedPublicReservationIds", JSONArray(releasedPublicReservationIds))
            .toString()
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/nodes/heartbeat")
            .header("Authorization", "Bearer $token")
            .post(body.toRequestBody(JSON))
            .build()
        return http.newCall(request).execute().use { response ->
            if (response.code == 401) throw SessionExpiredException()
            if (!response.isSuccessful) throw IllegalStateException("Coordinator rejected the heartbeat.")
            val value = JSONObject(response.body.string())
            val policy = value.getJSONObject("policy")
            val spaces = value.getJSONObject("spaces")
            HeartbeatResult(
                heartbeatAfterSeconds = value.optLong("heartbeatAfterSeconds", 120).coerceIn(30, 300),
                deviceName = value.optString("deviceName").takeIf { it.isNotBlank() },
                nodeId = value.getString("nodeId"),
                observedAddress = value.optString("observedAddress").takeIf { it.isNotBlank() },
                policy = NodePolicy(
                    allowDownloads = policy.optBoolean("allowDownloads", true),
                    allowUploads = policy.optBoolean("allowUploads", true),
                    chargingOnly = policy.optBoolean("chargingOnly", false),
                    wifiOnly = policy.optBoolean("wifiOnly", false),
                ),
                privateQuotaBytes = spaces.getJSONObject("private").getLong("quotaBytes"),
                publicQuotaBytes = spaces.getJSONObject("public").getLong("quotaBytes"),
                ligoDeleteMessages = value.optJSONArray("ligoDeleteMessages")?.let { items ->
                    List(items.length()) { index -> items.getJSONObject(index).let {
                        LigoDeletion(it.getString("id"), it.getString("storage"))
                    } }
                }.orEmpty(),
                publicDeletePostIds = value.optJSONArray("publicDeletePostIds")?.let { items ->
                    List(items.length()) { items.getString(it) }
                }.orEmpty(),
                runQuickTest = value.optBoolean("runQuickTest", false),
            )
        }
    }

    fun authSessionWatchUrl(token: String): String {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/auth/live-ticket")
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody(JSON))
            .build()
        return NodeHttpClients.withTimeout(10).newCall(request).execute().use { response ->
            if (response.code == 401) throw SessionExpiredException()
            if (!response.isSuccessful) throw IllegalStateException("Coordinator rejected the session watch.")
            JSONObject(response.body.string()).getString("url")
        }
    }

    data class HeartbeatResult(
        val heartbeatAfterSeconds: Long,
        val deviceName: String?,
        val nodeId: String,
        val observedAddress: String?,
        val policy: NodePolicy,
        val privateQuotaBytes: Long,
        val publicQuotaBytes: Long,
        val ligoDeleteMessages: List<LigoDeletion>,
        val publicDeletePostIds: List<String>,
        val runQuickTest: Boolean,
    )

    data class LigoDeletion(val id: String, val storage: String)

    class SessionExpiredException : IllegalStateException("The Nodo session has expired. Please sign in again.")

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
