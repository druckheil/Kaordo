package io.kaordo.nodo.data

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest
import java.util.UUID

/** Stable physical-device identity; slot keeps room for multiple hosts later. */
class NodeIdentity(private val context: Context) {
    fun deviceKey(): String {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        )?.takeIf { it.isNotBlank() } ?: fallbackId()
        val source = "${context.packageName}:$androidId"
        return MessageDigest.getInstance("SHA-256")
            .digest(source.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    private fun fallbackId(): String {
        val preferences = context.getSharedPreferences("nodo.identity.v1", Context.MODE_PRIVATE)
        return preferences.getString(FALLBACK_ID, null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString(FALLBACK_ID, it).commit()
        }
    }

    private companion object {
        const val FALLBACK_ID = "fallback_id"
    }
}
