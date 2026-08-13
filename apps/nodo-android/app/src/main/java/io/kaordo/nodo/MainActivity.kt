package io.kaordo.nodo

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.kaordo.nodo.ui.NodoApp

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<NodeViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            val notificationPermission = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission(),
            ) { viewModel.refreshPermissions() }
            NodoApp(
                state = state,
                onClearStorage = viewModel::clearStorage,
                onContinuePermissions = viewModel::continueToStorage,
                onLogin = viewModel::login,
                onLogout = viewModel::logout,
                onQuotaChange = viewModel::setQuotaGiB,
                onRequestBatteryAccess = ::requestBatteryAccess,
                onRequestNotifications = {
                    if (Build.VERSION.SDK_INT >= 33) {
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else viewModel.refreshPermissions()
                },
                onStart = viewModel::startNode,
                onStop = viewModel::stopNode,
            )
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshPermissions()
    }

    private fun requestBatteryAccess() {
        val direct = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName"),
        )
        runCatching { startActivity(direct) }.onFailure {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
