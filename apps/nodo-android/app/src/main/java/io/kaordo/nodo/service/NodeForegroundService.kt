package io.kaordo.nodo.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.kaordo.nodo.MainActivity
import io.kaordo.nodo.R
import io.kaordo.nodo.data.NodeConfiguration
import io.kaordo.nodo.data.NodeCoordinatorClient
import io.kaordo.nodo.data.NodeAccessClient
import io.kaordo.nodo.data.NodeIdentity
import io.kaordo.nodo.diagnostics.NodeDiagnostics
import io.kaordo.nodo.model.DiskBenchmark
import io.kaordo.nodo.model.NodeMetrics
import io.kaordo.nodo.model.NodePolicy
import io.kaordo.nodo.model.NodeServiceStatus
import io.kaordo.nodo.network.NetworkAddresses
import io.kaordo.nodo.security.SecureSessionStore
import io.kaordo.nodo.server.NodeHttpServer
import io.kaordo.nodo.storage.TusUploadStore
import io.kaordo.nodo.storage.FluoPostStore
import io.kaordo.nodo.storage.RondoMessageStore
import io.kaordo.nodo.storage.LigoEnvelopeStore
import io.kaordo.nodo.storage.PublicReconciliationStore
import io.kaordo.nodo.storage.NodeStorageLayout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class NodeForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val destroyed = AtomicBoolean(false)
    private var heartbeatJob: Job? = null
    private var cleanupJob: Job? = null
    private var startJob: Job? = null
    private var server: NodeHttpServer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val activePolicy = AtomicReference(NodePolicy())
    private val latestMetrics = AtomicReference<NodeMetrics?>(null)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            NodeConfiguration(this).disable()
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundStatus("Starting personal node…")
        if (startJob?.isActive != true && server == null) {
            startJob = scope.launch { startNode() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        destroyed.set(true)
        startJob?.cancel()
        startJob = null
        stopNodeResources()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startNode() {
        if (destroyed.get() || server != null) return
        val configuration = NodeConfiguration(this)
        val session = SecureSessionStore(this)
        val token = session.token()
        val owner = session.user()
        val quota = configuration.quotaBytes()
        if (!configuration.isEnabled() || token == null || owner == null || quota <= 0) {
            fail("Node configuration or session is missing.")
            return
        }

        try {
            acquireWakeLock()
            val layout = NodeStorageLayout.prepare(configuration.storageRoot)
            val privateStore = TusUploadStore(layout.privateRoot, configuration.privateQuotaBytes())
            val publicStore = TusUploadStore(layout.publicRoot, configuration.publicQuotaBytes())
            val privatePosts = FluoPostStore(layout.privateRoot, privateStore, owner.username)
            val publicPosts = FluoPostStore(layout.publicRoot, publicStore, owner.username)
            val privateMessages = RondoMessageStore(layout.privateRoot, privateStore)
            val publicMessages = RondoMessageStore(layout.publicRoot, publicStore)
            val privateEnvelopes = LigoEnvelopeStore(layout.privateRoot, privateStore)
            val publicEnvelopes = LigoEnvelopeStore(layout.publicRoot, publicStore)
            val access = NodeAccessClient()
            val spaces = mapOf(
                NodeHttpServer.NodeSpace.PRIVATE to NodeHttpServer.SpaceStorage(
                    privateStore,
                    privatePosts,
                    privateMessages,
                    privateEnvelopes,
                ),
                NodeHttpServer.NodeSpace.PUBLIC to NodeHttpServer.SpaceStorage(
                    publicStore,
                    publicPosts,
                    publicMessages,
                    publicEnvelopes,
                ),
            )
            val diagnostics = NodeDiagnostics(this, configuration.storageRoot)
            val benchmark = AtomicReference<DiskBenchmark?>(null)
            val heartbeatSignal = Channel<Unit>(Channel.CONFLATED)
            val reconciliation = PublicReconciliationStore(configuration.storageRoot)
            val identity = NodeIdentity(this)
            var coordinatorLatencyMs: Long? = null
            activePolicy.set(configuration.policy())
            latestMetrics.set(diagnostics.snapshot(benchmark.get(), coordinatorLatencyMs))
            val httpServer = NodeHttpServer(
                port = NodeHttpServer.DEFAULT_PORT,
                spaces = spaces,
                authorize = { candidate, reservationId ->
                    access.verify(candidate, configuration.nodeId(), reservationId)
                },
                authorizeRondo = { candidate, rondoSpaceId, rondoRoomId ->
                    access.verify(
                        candidate, configuration.nodeId(), null, rondoSpaceId, rondoRoomId,
                    )
                },
                policy = activePolicy::get,
                available = ::transfersAvailable,
                quickTest = {
                    val result = synchronized(diagnostics) { diagnostics.quickDiskTest() }
                    benchmark.set(result)
                    latestMetrics.set(diagnostics.snapshot(result, coordinatorLatencyMs))
                    heartbeatSignal.trySend(Unit)
                    result
                },
                onPublicPostDeleted = { postId ->
                    reconciliation.recordPostDeletion(postId)
                    heartbeatSignal.trySend(Unit)
                },
                onPublicReservationReleased = { reservationId ->
                    reconciliation.recordReservationRelease(reservationId)
                    heartbeatSignal.trySend(Unit)
                },
                onPublicStorageChanged = { heartbeatSignal.trySend(Unit) },
            ).also { it.start() }
            server = httpServer
            NodeRuntime.installStorageCleaner {
                val result = httpServer.clearStorage()
                publishOnline(privateStore, publicStore, quota)
                heartbeatSignal.trySend(Unit)
                result
            }
            registerNetworkCallback {
                scope.launch { publishOnline(privateStore, publicStore, quota) }
            }
            publishOnline(privateStore, publicStore, quota)
            cleanupJob = scope.launch {
                while (isActive) {
                    runCatching {
                        listOf(privateStore, publicStore).map {
                            it.cleanupStalePartials(PARTIAL_UPLOAD_MAX_IDLE_MS)
                        }
                    }
                        .onSuccess { result ->
                            result.getOrNull(1)?.publicReservationIds.orEmpty().forEach(
                                reconciliation::recordReservationRelease,
                            )
                            if (result.sumOf { it.deletedUploads } > 0) {
                                publishOnline(privateStore, publicStore, quota)
                                heartbeatSignal.trySend(Unit)
                            }
                        }
                    delay(PARTIAL_UPLOAD_CLEANUP_INTERVAL_MS)
                }
            }
            heartbeatJob = scope.launch {
                val coordinator = NodeCoordinatorClient()
                var waitSeconds = 10L
                while (isActive) {
                    val addresses = NetworkAddresses.localIpv4()
                    val metrics = diagnostics.snapshot(benchmark.get(), coordinatorLatencyMs)
                    latestMetrics.set(metrics)
                    val startedAt = System.nanoTime()
                    val pendingReconciliation = reconciliation.pending()
                    runCatching {
                        coordinator.heartbeat(
                            token = token,
                            nodeId = configuration.nodeId(),
                            deviceKey = identity.deviceKey(),
                            slotKey = configuration.slotKey(),
                            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}",
                            localAddresses = addresses,
                            port = NodeHttpServer.DEFAULT_PORT,
                            quotaBytes = quota,
                            privateUsedBytes = privateStore.usedBytes(),
                            publicUsedBytes = publicStore.usedBytes(),
                            metrics = metrics,
                            testCompletedAt = benchmark.get()?.completedAt,
                            deletedPublicPostIds = pendingReconciliation.postIds,
                            releasedPublicReservationIds = pendingReconciliation.reservationIds,
                        )
                    }.onSuccess {
                        reconciliation.acknowledge(pendingReconciliation)
                        coordinatorLatencyMs = ((System.nanoTime() - startedAt) / 1_000_000).coerceAtLeast(0)
                        configuration.setNodeId(it.nodeId)
                        configuration.setPolicy(it.policy)
                        if (runCatching {
                            httpServer.applySpaceQuotas(it.publicQuotaBytes, it.privateQuotaBytes)
                        }.isFailure) {
                            waitSeconds = 1
                            return@onSuccess
                        }
                        configuration.setSpaceQuotas(it.publicQuotaBytes, it.privateQuotaBytes)
                        activePolicy.set(it.policy)
                        var reconciledPosts = false
                        it.publicDeletePostIds.forEach { postId ->
                            when (publicPosts.delete(postId, owner.username, true)) {
                                FluoPostStore.DeleteResult.DELETED,
                                FluoPostStore.DeleteResult.MISSING -> {
                                    reconciliation.recordPostDeletion(postId)
                                    reconciledPosts = true
                                }
                                FluoPostStore.DeleteResult.FORBIDDEN -> Unit
                            }
                        }
                        if (reconciledPosts) heartbeatSignal.trySend(Unit)
                        if (it.runQuickTest) {
                            benchmark.set(synchronized(diagnostics) { diagnostics.quickDiskTest() })
                            waitSeconds = 1
                        } else {
                            waitSeconds = it.heartbeatAfterSeconds
                        }
                    }.onFailure {
                        waitSeconds = (waitSeconds * 2).coerceAtMost(300)
                    }
                    publishOnline(privateStore, publicStore, quota)
                    withTimeoutOrNull(waitSeconds * 1_000) { heartbeatSignal.receive() }
                }
            }
            if (destroyed.get()) stopNodeResources()
        } catch (error: Throwable) {
            if (!destroyed.get()) fail(error.message ?: "Node could not start.")
        }
    }

    @Synchronized
    private fun stopNodeResources() {
        cleanupJob?.cancel()
        cleanupJob = null
        heartbeatJob?.cancel()
        heartbeatJob = null
        server?.stop()
        server = null
        unregisterNetworkCallback()
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        NodeRuntime.installStorageCleaner(null)
        NodeRuntime.update(NodeServiceStatus.Stopped)
    }

    private fun transfersAvailable(): Boolean {
        val policy = activePolicy.get()
        val metrics = latestMetrics.get() ?: return !policy.wifiOnly && !policy.chargingOnly
        return (!policy.wifiOnly || metrics.networkType == "wifi") &&
            (!policy.chargingOnly || metrics.charging == true)
    }

    private fun publishOnline(privateStore: TusUploadStore, publicStore: TusUploadStore, quota: Long) {
        val addresses = NetworkAddresses.localIpv4()
        val usedBytes = privateStore.usedBytes() + publicStore.usedBytes()
        NodeRuntime.update(NodeServiceStatus.Online(
            addresses = addresses,
            port = NodeHttpServer.DEFAULT_PORT,
            quotaBytes = quota,
            usedBytes = usedBytes,
        ))
        val address = addresses.firstOrNull()?.let { "$it:${NodeHttpServer.DEFAULT_PORT}" } ?: "Waiting for network"
        updateNotification("Online · $address · ${formatBytes(usedBytes)} used")
    }

    private fun fail(message: String) {
        NodeRuntime.update(NodeServiceStatus.Failed(message))
        updateNotification("Stopped · $message")
        stopSelf()
    }

    private fun acquireWakeLock() {
        val power = getSystemService(PowerManager::class.java)
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:nodo-host")
            .apply { acquire() }
    }

    private fun registerNetworkCallback(onChanged: () -> Unit) {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = onChanged()
            override fun onLost(network: Network) = onChanged()
        }
        connectivity.registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(callback) }
        networkCallback = null
    }

    private fun startForegroundStatus(text: String) {
        NodeRuntime.update(NodeServiceStatus.Starting)
        val type = if (Build.VERSION.SDK_INT >= 34) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(text), type)
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    private fun notification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_nodo)
        .setContentTitle("Kaordo Nodo is working")
        .setContentText(text)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        .addAction(
            0,
            "Stop",
            PendingIntent.getService(
                this,
                1,
                Intent(this, NodeForegroundService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        .build()

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Nodo status",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Persistent status while this device hosts a Kaordo node."
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun formatBytes(bytes: Long): String = "%.1f GB".format(bytes.toDouble() / GIB)

    companion object {
        private const val ACTION_START = "io.kaordo.nodo.START"
        private const val ACTION_STOP = "io.kaordo.nodo.STOP"
        private const val CHANNEL_ID = "nodo-status-v1"
        private const val NOTIFICATION_ID = 7_310
        private const val GIB = 1_073_741_824.0
        private const val PARTIAL_UPLOAD_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000L
        private const val PARTIAL_UPLOAD_MAX_IDLE_MS = 24 * 60 * 60 * 1_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, NodeForegroundService::class.java).setAction(ACTION_START),
            )
        }

        fun stop(context: Context) {
            context.startService(Intent(context, NodeForegroundService::class.java).setAction(ACTION_STOP))
        }
    }
}
