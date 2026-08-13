package io.kaordo.nodo

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.kaordo.nodo.data.NodeConfiguration
import io.kaordo.nodo.data.KaordoAuthClient
import io.kaordo.nodo.model.NodeServiceStatus
import io.kaordo.nodo.model.NodeUiState
import io.kaordo.nodo.model.SetupStep
import io.kaordo.nodo.security.SecureSessionStore
import io.kaordo.nodo.service.NodeForegroundService
import io.kaordo.nodo.service.NodeRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class NodeViewModel(application: Application) : AndroidViewModel(application) {
    private val auth = KaordoAuthClient()
    private val configuration = NodeConfiguration(application)
    private val session = SecureSessionStore(application)
    private val mutableState = MutableStateFlow(NodeUiState())
    val state = mutableState.asStateFlow()

    init {
        viewModelScope.launch {
            NodeRuntime.status.collect { status ->
                mutableState.update { current ->
                    val step = if (status is NodeServiceStatus.Online || status is NodeServiceStatus.Starting) {
                        SetupStep.RUNNING
                    } else current.step
                    current.copy(service = status, step = step)
                }
            }
        }
        restoreSession()
    }

    fun login(username: String, password: String) {
        if (mutableState.value.isBusy) return
        mutableState.update { it.copy(error = null, isBusy = true) }
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) { auth.login(username, password.toCharArray()) }
            }
            result.onSuccess {
                session.save(it.token, it.user)
                mutableState.update { current -> current.copy(
                    error = null,
                    isBusy = false,
                    step = SetupStep.PERMISSIONS,
                    user = it.user,
                ) }
                refreshPermissions()
            }.onFailure { error ->
                mutableState.update { it.copy(
                    error = error.message ?: "Login failed.",
                    isBusy = false,
                ) }
            }
        }
    }

    fun refreshPermissions() {
        val context = getApplication<Application>()
        val notificationGranted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val power = context.getSystemService(PowerManager::class.java)
        mutableState.update { it.copy(
            availableBytes = configuration.availableBytes(),
            isBatteryOptimized = !power.isIgnoringBatteryOptimizations(context.packageName),
            notificationGranted = notificationGranted,
        ) }
    }

    fun continueToStorage() {
        refreshPermissions()
        if (!mutableState.value.notificationGranted) {
            mutableState.update { it.copy(error = "Allow notifications to keep the node status visible.") }
            return
        }
        val available = configuration.availableBytes()
        val stored = configuration.quotaBytes().takeIf { it in GIB..available }
            ?: minOf(5 * GIB, (available / GIB).coerceAtLeast(1) * GIB)
        mutableState.update { it.copy(
            availableBytes = available,
            error = null,
            quotaBytes = stored,
            step = SetupStep.STORAGE,
        ) }
    }

    fun setQuotaGiB(gib: Int) {
        mutableState.update { it.copy(quotaBytes = gib.coerceAtLeast(1) * GIB) }
    }

    fun startNode() {
        val quota = mutableState.value.quotaBytes
        val available = configuration.availableBytes()
        if (quota <= 0 || quota > available) {
            mutableState.update { it.copy(error = "The selected storage is no longer available.") }
            return
        }
        runCatching {
            configuration.enable(quota)
            NodeForegroundService.start(getApplication())
        }.onSuccess {
            mutableState.update { it.copy(error = null, step = SetupStep.RUNNING) }
        }.onFailure { error ->
            mutableState.update { it.copy(error = error.message ?: "Node could not start.") }
        }
    }

    fun stopNode() {
        configuration.disable()
        NodeForegroundService.stop(getApplication())
        mutableState.update { it.copy(step = SetupStep.STORAGE) }
    }

    fun clearStorage() {
        if (mutableState.value.isBusy) return
        mutableState.update { it.copy(error = null, isBusy = true, notice = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { NodeRuntime.clearStorage() } }
            result.onSuccess { cleared ->
                mutableState.update { it.copy(
                    error = null,
                    isBusy = false,
                    notice = "Deleted ${formatBytes(cleared.deletedBytes)}, ${cleared.deletedPosts} posts and ${cleared.deletedUploads} uploads.",
                ) }
            }.onFailure { error ->
                mutableState.update { it.copy(
                    error = error.message ?: "Nodo storage could not be cleared.",
                    isBusy = false,
                ) }
            }
        }
    }

    fun logout() {
        val token = session.token()
        configuration.disable()
        NodeForegroundService.stop(getApplication())
        session.clear()
        mutableState.value = NodeUiState(step = SetupStep.LOGIN)
        if (token != null) viewModelScope.launch(Dispatchers.IO) { auth.logout(token) }
    }

    private fun restoreSession() {
        val token = session.token()
        val cachedUser = session.user()
        if (token == null || cachedUser == null) {
            mutableState.value = NodeUiState(step = SetupStep.LOGIN)
            return
        }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { auth.me(token) } }
            if (result.isSuccess && result.getOrNull() == null) {
                session.clear()
                configuration.disable()
                mutableState.value = NodeUiState(step = SetupStep.LOGIN)
                return@launch
            }
            // A configured node must still recover after a reboot without Internet.
            // Direct requests remain protected because their bearer token is verified online.
            val user = result.getOrNull() ?: cachedUser
            refreshPermissions()
            val service = NodeRuntime.status.value
            mutableState.update { it.copy(
                quotaBytes = configuration.quotaBytes(),
                service = service,
                step = if (configuration.isEnabled()) SetupStep.RUNNING else SetupStep.PERMISSIONS,
                user = user,
            ) }
            if (configuration.isEnabled() && service is NodeServiceStatus.Stopped) {
                runCatching { NodeForegroundService.start(getApplication()) }
            }
        }
    }

    companion object {
        const val GIB = 1_073_741_824L
    }

    private fun formatBytes(bytes: Long): String = if (bytes < 1_048_576) {
        "%.1f KB".format(bytes / 1_024.0)
    } else {
        "%.1f MB".format(bytes / 1_048_576.0)
    }
}
