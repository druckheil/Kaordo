package io.kaordo.nodo.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import io.kaordo.nodo.BuildConfig
import io.kaordo.nodo.model.DiskBenchmark
import io.kaordo.nodo.model.NodeMetrics
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.roundToInt
import kotlin.system.measureNanoTime

class NodeDiagnostics(private val context: Context, private val storageRoot: File) {
    fun snapshot(benchmark: DiskBenchmark?, coordinatorLatencyMs: Long?): NodeMetrics {
        val memory = ActivityManager.MemoryInfo().also {
            context.getSystemService(ActivityManager::class.java).getMemoryInfo(it)
        }
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
        return NodeMetrics(
            androidSdk = Build.VERSION.SDK_INT,
            appVersion = BuildConfig.VERSION_NAME,
            batteryPercent = if (level >= 0 && scale > 0) (level * 100f / scale).roundToInt() else null,
            charging = when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
                BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
                else -> null
            },
            coordinatorLatencyMs = coordinatorLatencyMs,
            diskReadBps = benchmark?.readBps,
            diskWriteBps = benchmark?.writeBps,
            memoryAvailableBytes = memory.availMem,
            memoryTotalBytes = memory.totalMem,
            networkMetered = connectivity.isActiveNetworkMetered,
            networkDownBps = capabilities?.linkDownstreamBandwidthKbps?.takeIf { it > 0 }?.times(125L),
            networkType = networkType(capabilities),
            networkUpBps = capabilities?.linkUpstreamBandwidthKbps?.takeIf { it > 0 }?.times(125L),
            storageAvailableBytes = StatFs(storageRoot.absolutePath).availableBytes,
        )
    }

    fun quickDiskTest(): DiskBenchmark {
        storageRoot.mkdirs()
        val target = File(storageRoot, ".nodo-benchmark.tmp")
        val buffer = ByteArray(256 * 1_024) { index -> (index * 31).toByte() }
        // Four MiB is large enough to avoid timer noise while keeping even
        // slow flash storage comfortably inside the five-second UI deadline.
        val totalBytes = 4L * 1_024 * 1_024
        val writeNanos = measureNanoTime {
            RandomAccessFile(target, "rw").use { file ->
                file.setLength(0)
                var written = 0L
                while (written < totalBytes) {
                    file.write(buffer)
                    written += buffer.size
                }
                file.fd.sync()
            }
        }
        var checksum = 0
        val readNanos = measureNanoTime {
            target.inputStream().buffered().use { input ->
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    checksum = checksum xor buffer[0].toInt()
                }
            }
        }
        target.delete()
        check(checksum != Int.MIN_VALUE)
        return DiskBenchmark(
            completedAt = System.currentTimeMillis() / 1_000,
            readBps = bytesPerSecond(totalBytes, readNanos),
            writeBps = bytesPerSecond(totalBytes, writeNanos),
        )
    }

    private fun networkType(capabilities: NetworkCapabilities?): String = when {
        capabilities == null -> "offline"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
    }

    private fun bytesPerSecond(bytes: Long, nanos: Long): Long =
        (bytes * 1_000_000_000L / nanos.coerceAtLeast(1)).coerceAtLeast(1)
}
