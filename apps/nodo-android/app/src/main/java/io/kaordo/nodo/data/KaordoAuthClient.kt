package io.kaordo.nodo.data

import android.os.Build
import io.kaordo.nodo.BuildConfig
import io.kaordo.nodo.model.AuthUser
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class KaordoAuthClient {
    private val http = NodeHttpClients.withReadTimeout(30)
    private val verificationCache = BoundedExpiringCache<String, CachedUser>(
        maxSize = MAX_CACHE_ENTRIES,
        isValid = { value, now -> value.expiresAt > now },
        clock = System::currentTimeMillis,
    )

    fun login(username: String, password: CharArray): AuthResult {
        val proof = try {
            PasswordProof.create(username, password)
        } finally {
            password.fill('\u0000')
        }
        val body = JSONObject()
            .put("username", username.trim())
            .put("passwordProof", proof)
            .put("deviceName", "Nodo on ${Build.MANUFACTURER} ${Build.MODEL}".take(80))
            .toString()
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/auth/desktop/login")
            .post(body.toRequestBody(JSON))
            .build()
        return http.newCall(request).execute().use { response ->
            val value = JSONObject(response.body.string())
            if (!response.isSuccessful) throw AuthException(value.optString("error", "Login failed."))
            AuthResult(value.getString("sessionToken"), parseUser(value.getJSONObject("user")))
        }
    }

    fun me(token: String): AuthUser? {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/auth/me")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        return http.newCall(request).execute().use { response ->
            if (response.code == 401) return null
            if (!response.isSuccessful) throw AuthException("Authentication service is unavailable.")
            parseUser(JSONObject(response.body.string()).getJSONObject("user"))
        }
    }

    fun logout(token: String) {
        val request = Request.Builder()
            .url("${BuildConfig.API_ORIGIN}/api/auth/logout")
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        runCatching { http.newCall(request).execute().close() }
    }

    fun tokenBelongsTo(token: String, ownerId: String): Boolean {
        val key = sha256(token)
        verificationCache[key]?.let {
            return it.userId == ownerId
        }
        val user = runCatching { me(token) }.getOrNull() ?: return false
        verificationCache[key] = CachedUser(user.id, System.currentTimeMillis() + CACHE_MILLIS)
        return user.id == ownerId
    }

    private fun parseUser(value: JSONObject) = AuthUser(
        createdAt = value.getLong("createdAt"),
        id = value.getString("id"),
        role = value.getString("role"),
        username = value.getString("username"),
    )

    private fun sha256(value: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()),
    )

    data class AuthResult(val token: String, val user: AuthUser)
    private data class CachedUser(val userId: String, val expiresAt: Long)
    class AuthException(message: String) : Exception(message)

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val CACHE_MILLIS = 5 * 60 * 1_000L
        const val MAX_CACHE_ENTRIES = 256
    }
}

internal object PasswordProof {
    fun create(username: String, password: CharArray): String {
        require(password.size in 6..128) { "Password must be 6–128 characters." }
        val namespace = "veri" + "dimensio:password:v1:"
        val salt = "$namespace${username.trim().lowercase()}".toByteArray()
        val spec = PBEKeySpec(password, salt, 600_000, 256)
        return try {
            Base64.getUrlEncoder().withoutPadding().encodeToString(
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded,
            )
        } finally {
            spec.clearPassword()
            salt.fill(0)
        }
    }
}
