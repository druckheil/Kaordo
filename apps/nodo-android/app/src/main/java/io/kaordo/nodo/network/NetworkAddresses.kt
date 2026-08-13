package io.kaordo.nodo.network

import java.net.Inet4Address
import java.net.NetworkInterface

object NetworkAddresses {
    fun localIpv4(): List<String> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filterNot { it.isLoopbackAddress || it.isLinkLocalAddress }
            .map { it.hostAddress ?: return@map "" }
            .filter { it.isNotEmpty() }
            .distinct()
    }.getOrDefault(emptyList())
}
