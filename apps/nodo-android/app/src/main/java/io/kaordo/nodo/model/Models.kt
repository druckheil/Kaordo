package io.kaordo.nodo.model

data class AuthUser(
    val createdAt: Long,
    val id: String,
    val role: String,
    val username: String,
)

enum class SetupStep { CHECKING, LOGIN, PERMISSIONS, STORAGE, RUNNING }

data class NodeUiState(
    val availableBytes: Long = 0,
    val nodeName: String? = null,
    val error: String? = null,
    val isBatteryOptimized: Boolean = true,
    val isBusy: Boolean = false,
    val notificationGranted: Boolean = false,
    val notice: String? = null,
    val quotaBytes: Long = 0,
    val service: NodeServiceStatus = NodeServiceStatus.Stopped,
    val step: SetupStep = SetupStep.CHECKING,
    val user: AuthUser? = null,
)

sealed interface NodeServiceStatus {
    data object Stopped : NodeServiceStatus
    data object Starting : NodeServiceStatus
    data class Online(
        val addresses: List<String>,
        val deviceName: String?,
        val port: Int,
        val quotaBytes: Long,
        val usedBytes: Long,
    ) : NodeServiceStatus
    data class Failed(val message: String) : NodeServiceStatus
}

data class NodePolicy(
    val allowDownloads: Boolean = true,
    val allowUploads: Boolean = true,
    val chargingOnly: Boolean = false,
    val wifiOnly: Boolean = false,
)

data class NodeMetrics(
    val androidSdk: Int,
    val appVersion: String,
    val batteryPercent: Int?,
    val charging: Boolean?,
    val coordinatorLatencyMs: Long?,
    val diskReadBps: Long?,
    val diskWriteBps: Long?,
    val memoryAvailableBytes: Long,
    val memoryTotalBytes: Long,
    val networkMetered: Boolean,
    val networkDownBps: Long?,
    val networkType: String,
    val networkUpBps: Long?,
    val storageAvailableBytes: Long,
)

data class DiskBenchmark(
    val completedAt: Long,
    val readBps: Long,
    val writeBps: Long,
)
