package io.kaordo.nodo.service

import io.kaordo.nodo.model.NodeServiceStatus
import io.kaordo.nodo.server.NodeHttpServer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicReference

object NodeRuntime {
    private val mutableStatus = MutableStateFlow<NodeServiceStatus>(NodeServiceStatus.Stopped)
    val status = mutableStatus.asStateFlow()
    private val storageCleaner = AtomicReference<(() -> NodeHttpServer.StorageClearResult)?>(null)

    fun update(status: NodeServiceStatus) {
        mutableStatus.value = status
    }

    fun installStorageCleaner(cleaner: (() -> NodeHttpServer.StorageClearResult)?) {
        storageCleaner.set(cleaner)
    }

    fun clearStorage(): NodeHttpServer.StorageClearResult = storageCleaner.get()?.invoke()
        ?: throw IllegalStateException("Nodo must be running to clear its storage.")
}
