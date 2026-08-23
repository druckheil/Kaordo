package io.kaordo.nodo.data

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Receives session revocation events without adding another heartbeat/polling
 * request. Heartbeat remains the fallback when a network or proxy drops this
 * long-lived connection.
 */
class NodeSessionWatcher(
    private val url: String,
    private val onSessionRevoked: () -> Unit,
) {
    private val closed = AtomicBoolean(false)
    private val client = NodeHttpClients.webSocket()
    private var socket: WebSocket? = null

    fun start() {
        if (closed.get()) return
        socket = client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (runCatching { JSONObject(text).optString("type") }.getOrNull() == "session-revoked") {
                        onSessionRevoked()
                        close()
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    // The regular heartbeat detects revocation if this channel
                    // is unavailable, so a failed watcher is intentionally quiet.
                }
            },
        )
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        socket?.close(1000, "Session watcher stopped.")
        socket = null
    }
}
