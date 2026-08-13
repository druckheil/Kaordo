package io.kaordo.nodo.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.kaordo.nodo.data.NodeConfiguration
import io.kaordo.nodo.security.SecureSessionStore

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (NodeConfiguration(context).isEnabled() && SecureSessionStore(context).token() != null) {
            NodeForegroundService.start(context)
        }
    }
}
