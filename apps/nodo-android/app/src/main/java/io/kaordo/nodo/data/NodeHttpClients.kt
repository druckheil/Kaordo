package io.kaordo.nodo.data

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Shares connection and worker pools across the coordinator clients. */
internal object NodeHttpClients {
    private val base = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    fun withReadTimeout(seconds: Long): OkHttpClient = base.newBuilder()
        .readTimeout(seconds, TimeUnit.SECONDS)
        .build()

    fun withTimeout(seconds: Long): OkHttpClient = base.newBuilder()
        .connectTimeout(seconds, TimeUnit.SECONDS)
        .readTimeout(seconds, TimeUnit.SECONDS)
        .callTimeout(seconds, TimeUnit.SECONDS)
        .build()

    fun webSocket(): OkHttpClient = base.newBuilder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
}
