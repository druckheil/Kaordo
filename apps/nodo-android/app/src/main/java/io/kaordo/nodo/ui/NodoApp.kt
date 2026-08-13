package io.kaordo.nodo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.kaordo.nodo.NodeViewModel
import io.kaordo.nodo.model.NodeServiceStatus
import io.kaordo.nodo.model.NodeUiState
import io.kaordo.nodo.model.SetupStep
import kotlin.math.roundToInt

private val Forest = Color(0xFF1C2A24)
private val Green = Color(0xFF367765)
private val Mint = Color(0xFFE7F1ED)
private val Canvas = Color(0xFFF4F7F4)
private val Muted = Color(0xFF748078)

@Composable
fun NodoApp(
    state: NodeUiState,
    onContinuePermissions: () -> Unit,
    onClearStorage: () -> Unit,
    onLogin: (String, String) -> Unit,
    onLogout: () -> Unit,
    onQuotaChange: (Int) -> Unit,
    onRequestBatteryAccess: () -> Unit,
    onRequestNotifications: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    MaterialTheme(colorScheme = lightColorScheme(
        primary = Green,
        onPrimary = Color.White,
        background = Canvas,
        surface = Color.White,
        onSurface = Forest,
    )) {
        Scaffold(containerColor = Canvas) { insets ->
            Column(
                modifier = Modifier.fillMaxSize().padding(insets).padding(horizontal = 24.dp, vertical = 20.dp),
            ) {
                Brand()
                Spacer(Modifier.weight(1f))
                when (state.step) {
                    SetupStep.CHECKING -> Loading()
                    SetupStep.LOGIN -> Login(state, onLogin)
                    SetupStep.PERMISSIONS -> Permissions(
                        state,
                        onContinuePermissions,
                        onRequestBatteryAccess,
                        onRequestNotifications,
                    )
                    SetupStep.STORAGE -> Storage(state, onQuotaChange, onStart, onLogout)
                    SetupStep.RUNNING -> Running(state, onClearStorage, onStop, onLogout)
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "REST + tus 1.0 · Personal node",
                    color = Muted,
                    fontSize = 12.sp,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}

@Composable
private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(34.dp).background(Green, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text("N", color = Color.White, fontWeight = FontWeight.Bold)
        }
        Column {
            Text("Kaordo", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text("Nodo for Android", color = Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun Loading() {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
        Spacer(Modifier.height(14.dp))
        Text("Checking secure session…", color = Muted)
    }
}

@Composable
private fun Login(state: NodeUiState, onLogin: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Heading("Host your Nodo", "Sign in with your Kaordo account.")
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            enabled = !state.isBusy,
            label = { Text("Username") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            enabled = !state.isBusy,
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onLogin(username, password) }),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(state.error)
        PrimaryButton(
            text = if (state.isBusy) "Signing in…" else "Continue",
            enabled = !state.isBusy && username.isNotBlank() && password.length >= 12,
            onClick = { onLogin(username, password) },
        )
    }
}

@Composable
private fun Permissions(
    state: NodeUiState,
    onContinue: () -> Unit,
    onBattery: () -> Unit,
    onNotifications: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Heading("Keep Nodo available", "Two system settings make hosting reliable in the background.")
        PermissionCard(
            title = "Status notification",
            detail = if (state.notificationGranted) "Allowed" else "Required to show working status",
            granted = state.notificationGranted,
            action = onNotifications,
        )
        PermissionCard(
            title = "Battery usage",
            detail = if (state.isBatteryOptimized) "Unrestricted is recommended" else "Unrestricted",
            granted = !state.isBatteryOptimized,
            action = onBattery,
        )
        ErrorText(state.error)
        PrimaryButton("Choose storage", state.notificationGranted, onContinue)
    }
}

@Composable
private fun PermissionCard(title: String, detail: String, granted: Boolean, action: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(10.dp).background(if (granted) Green else Color(0xFFD39B52), CircleShape))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(detail, color = Muted, fontSize = 12.sp)
            }
            if (!granted) OutlinedButton(onClick = action) { Text("Allow") }
        }
    }
}

@Composable
private fun Storage(
    state: NodeUiState,
    onQuotaChange: (Int) -> Unit,
    onStart: () -> Unit,
    onLogout: () -> Unit,
) {
    val availableGiB = (state.availableBytes / NodeViewModel.GIB).coerceAtLeast(1).toInt()
    val selectedGiB = (state.quotaBytes / NodeViewModel.GIB).coerceIn(1, availableGiB.toLong()).toInt()
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Heading("Allocate storage", "Nodo never writes beyond the limit you choose.")
        Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(18.dp)) {
                Text("$selectedGiB GB", color = Green, fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text("of $availableGiB GB currently available", color = Muted, fontSize = 13.sp)
                Spacer(Modifier.height(14.dp))
                Slider(
                    value = selectedGiB.toFloat(),
                    onValueChange = { onQuotaChange(it.roundToInt()) },
                    valueRange = 1f..availableGiB.toFloat(),
                    steps = (availableGiB - 2).coerceAtLeast(0),
                )
            }
        }
        ErrorText(state.error)
        PrimaryButton("Start Nodo", true, onStart)
        SecondaryButton("Sign out", onClick = onLogout)
    }
}

@Composable
private fun Running(
    state: NodeUiState,
    onClearStorage: () -> Unit,
    onStop: () -> Unit,
    onLogout: () -> Unit,
) {
    val status = state.service
    val online = status is NodeServiceStatus.Online
    var confirmingClear by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Heading("Nodo is ${if (online) "online" else "starting"}", "This device stays available while the status notification is visible.")
        Card(colors = CardDefaults.cardColors(containerColor = if (online) Mint else Color.White), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Box(Modifier.size(9.dp).background(if (online) Green else Color(0xFFD39B52), CircleShape))
                    Text(if (online) "Working" else "Starting service", fontWeight = FontWeight.Bold)
                }
                if (status is NodeServiceStatus.Online) {
                    Text(status.addresses.firstOrNull()?.let { "$it:${status.port}" } ?: "Waiting for network", color = Muted)
                    Text("${formatStorage(status.usedBytes)} used · ${formatGiB(status.quotaBytes)} allocated", color = Muted, fontSize = 13.sp)
                    Text("Automatic cleanup · partial uploads idle for 24 hours", color = Muted, fontSize = 12.sp)
                }
                if (status is NodeServiceStatus.Failed) Text(status.message, color = MaterialTheme.colorScheme.error)
            }
        }
        ErrorText(state.error)
        if (state.notice != null) Text(state.notice, color = Green, fontSize = 13.sp)
        OutlinedButton(
            onClick = { confirmingClear = true },
            enabled = online && !state.isBusy,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF9A4E45)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(46.dp),
        ) { Text(if (state.isBusy) "Deleting…" else "Delete all content") }
        SecondaryButton("Stop Nodo", !state.isBusy, onStop)
        SecondaryButton("Sign out", !state.isBusy, onLogout)
    }
    if (confirmingClear) {
        AlertDialog(
            onDismissRequest = { if (!state.isBusy) confirmingClear = false },
            title = { Text("Delete everything on this Nodo?") },
            text = { Text("All posts, media and partial uploads will be permanently deleted. The Nodo itself and your login stay active.") },
            confirmButton = {
                TextButton(
                    enabled = !state.isBusy,
                    onClick = {
                        confirmingClear = false
                        onClearStorage()
                    },
                ) { Text("Delete everything", color = Color(0xFF9A4E45)) }
            },
            dismissButton = {
                TextButton(enabled = !state.isBusy, onClick = { confirmingClear = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun Heading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = Forest, fontSize = 29.sp, fontWeight = FontWeight.Bold)
        Text(subtitle, color = Muted, fontSize = 14.sp)
    }
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = Green),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().height(50.dp),
    ) { Text(text, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun SecondaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(46.dp)) {
        Text(text)
    }
}

@Composable
private fun ErrorText(error: String?) {
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
}

private fun formatGiB(bytes: Long) = "%.1f GB".format(bytes.toDouble() / NodeViewModel.GIB)

private fun formatStorage(bytes: Long): String = when {
    bytes < 1_024 -> "$bytes B"
    bytes < 1_048_576 -> "%.1f KB".format(bytes / 1_024.0)
    bytes < NodeViewModel.GIB -> "%.1f MB".format(bytes / 1_048_576.0)
    else -> formatGiB(bytes)
}
