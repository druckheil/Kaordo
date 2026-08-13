package io.kaordo.nodo.data

import android.content.Context
import android.os.StatFs
import io.kaordo.nodo.model.NodePolicy
import java.io.File

class NodeConfiguration(private val context: Context) {
    private val preferences = context.getSharedPreferences("nodo.config.v1", Context.MODE_PRIVATE)
    val storageRoot: File get() = File(context.filesDir, "nodo-storage").apply { mkdirs() }

    fun availableBytes(): Long = StatFs(storageRoot.absolutePath).availableBytes
    fun quotaBytes(): Long = preferences.getLong(QUOTA, 0)
    fun privateQuotaBytes(): Long = preferences.getLong(PRIVATE_QUOTA, quotaBytes())
    fun publicQuotaBytes(): Long = preferences.getLong(PUBLIC_QUOTA, 0)
    fun isEnabled(): Boolean = preferences.getBoolean(ENABLED, false)
    fun nodeId(): String? = preferences.getString(NODE_ID, null)
    fun slotKey(): String = preferences.getString(SLOT_KEY, "primary") ?: "primary"

    fun enable(quotaBytes: Long) {
        require(quotaBytes > 0 && quotaBytes <= availableBytes())
        val currentPublic = publicQuotaBytes()
        val currentPrivate = privateQuotaBytes()
        val allocationsMatch = currentPublic >= 0 && currentPrivate >= 0 &&
            currentPublic + currentPrivate == quotaBytes
        preferences.edit()
            .putLong(QUOTA, quotaBytes)
            .putLong(PUBLIC_QUOTA, if (allocationsMatch) currentPublic else 0)
            .putLong(PRIVATE_QUOTA, if (allocationsMatch) currentPrivate else quotaBytes)
            .putBoolean(ENABLED, true)
            .apply()
    }

    fun disable() {
        preferences.edit().putBoolean(ENABLED, false).apply()
    }

    fun setNodeId(nodeId: String) {
        preferences.edit().putString(NODE_ID, nodeId).apply()
    }

    fun setSlotKey(slotKey: String) {
        require(Regex("^[a-z0-9][a-z0-9_-]{0,31}$").matches(slotKey))
        preferences.edit().putString(SLOT_KEY, slotKey).apply()
    }

    fun setSpaceQuotas(publicQuotaBytes: Long, privateQuotaBytes: Long) {
        require(publicQuotaBytes >= 0 && privateQuotaBytes >= 0)
        require(publicQuotaBytes + privateQuotaBytes == quotaBytes())
        preferences.edit()
            .putLong(PUBLIC_QUOTA, publicQuotaBytes)
            .putLong(PRIVATE_QUOTA, privateQuotaBytes)
            .apply()
    }

    fun policy(): NodePolicy = NodePolicy(
        allowDownloads = preferences.getBoolean(ALLOW_DOWNLOADS, true),
        allowUploads = preferences.getBoolean(ALLOW_UPLOADS, true),
        chargingOnly = preferences.getBoolean(CHARGING_ONLY, false),
        wifiOnly = preferences.getBoolean(WIFI_ONLY, false),
    )

    fun setPolicy(policy: NodePolicy) {
        preferences.edit()
            .putBoolean(ALLOW_DOWNLOADS, policy.allowDownloads)
            .putBoolean(ALLOW_UPLOADS, policy.allowUploads)
            .putBoolean(CHARGING_ONLY, policy.chargingOnly)
            .putBoolean(WIFI_ONLY, policy.wifiOnly)
            .apply()
    }

    private companion object {
        const val ALLOW_DOWNLOADS = "allow_downloads"
        const val ALLOW_UPLOADS = "allow_uploads"
        const val CHARGING_ONLY = "charging_only"
        const val ENABLED = "enabled"
        const val NODE_ID = "node_id"
        const val PRIVATE_QUOTA = "private_quota_bytes"
        const val PUBLIC_QUOTA = "public_quota_bytes"
        const val QUOTA = "quota_bytes"
        const val SLOT_KEY = "slot_key"
        const val WIFI_ONLY = "wifi_only"
    }
}
