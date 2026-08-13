package io.kaordo.nodo.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.kaordo.nodo.model.AuthUser
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("nodo.secure.v1", Context.MODE_PRIVATE)

    fun save(token: String, user: AuthUser) {
        saveToken(token)
        preferences.edit()
            .putString(USER, JSONObject()
                .put("createdAt", user.createdAt)
                .put("id", user.id)
                .put("role", user.role)
                .put("username", user.username)
                .toString())
            .apply()
    }

    private fun saveToken(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, requireNotNull(key(KEY_ALIAS, create = true)))
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(TOKEN, encode(cipher.iv) + "." + encode(encrypted))
            .apply()
    }

    fun token(): String? = runCatching {
        val parts = preferences.getString(TOKEN, null)?.split('.', limit = 2) ?: return null
        if (parts.size != 2) return null
        decrypt(parts, KEY_ALIAS) ?: decrypt(parts, LEGACY_KEY_ALIAS)?.also { token ->
            saveToken(token)
            keyStore().runCatching { deleteEntry(LEGACY_KEY_ALIAS) }
        }
    }.getOrNull()

    fun user(): AuthUser? = runCatching {
        val value = JSONObject(preferences.getString(USER, null) ?: return null)
        AuthUser(
            createdAt = value.getLong("createdAt"),
            id = value.getString("id"),
            role = value.getString("role"),
            username = value.getString("username"),
        )
    }.getOrNull()

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun decrypt(parts: List<String>, alias: String): String? {
        val key = key(alias, create = false) ?: return null
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, decode(parts[0])))
            cipher.doFinal(decode(parts[1])).toString(Charsets.UTF_8)
        }.getOrNull()
    }

    private fun key(alias: String, create: Boolean): SecretKey? {
        val keyStore = keyStore()
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) return null
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
            generateKey()
        }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(value: String) = Base64.decode(value, Base64.NO_WRAP)

    private companion object {
        const val KEY_ALIAS = "io.kaordo.nodo.session.v1"
        const val LEGACY_KEY_ALIAS = "io." + "veri" + "dimensio.nodo.session.v1"
        const val TOKEN = "token"
        const val USER = "user"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
