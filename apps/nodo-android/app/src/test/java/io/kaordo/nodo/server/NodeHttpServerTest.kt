package io.kaordo.nodo.server

import io.kaordo.nodo.model.NodePolicy
import io.kaordo.nodo.model.DiskBenchmark
import io.kaordo.nodo.storage.FluoPostStore
import io.kaordo.nodo.storage.TusUploadStore
import io.kaordo.nodo.storage.RondoMessageStore
import io.kaordo.nodo.storage.LigoEnvelopeStore
import io.kaordo.nodo.data.NodeAccessClient.AccessGrant
import io.kaordo.nodo.data.NodeAccessClient.PublicReservation
import io.kaordo.nodo.data.NodeAccessClient.RondoGrant
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.io.ByteArrayInputStream

class NodeHttpServerTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `authorized owner creates lists and deletes a node-backed Fluo post`() {
        val port = ServerSocket(0).use { it.localPort }
        val privateRoot = temporary.newFolder("private")
        val publicRoot = temporary.newFolder("public")
        val uploads = TusUploadStore(privateRoot, 1_024 * 1_024)
        val posts = FluoPostStore(privateRoot, uploads, "druckheil")
        val publicUploads = TusUploadStore(publicRoot, 1_024 * 1_024)
        val publicPosts = FluoPostStore(publicRoot, publicUploads, "druckheil")
        val streamed = uploads.create(10, "filename Y2xpcC5tcDQ=", "druckheil")
        uploads.append(streamed.id, 0, 10, ByteArrayInputStream("0123456789".toByteArray()))
        val server = NodeHttpServer(
            port = port,
            spaces = mapOf(
                NodeHttpServer.NodeSpace.PRIVATE to NodeHttpServer.SpaceStorage(
                    uploads, posts, null, LigoEnvelopeStore(privateRoot, uploads),
                ),
                NodeHttpServer.NodeSpace.PUBLIC to NodeHttpServer.SpaceStorage(
                    publicUploads, publicPosts, null, LigoEnvelopeStore(publicRoot, publicUploads),
                ),
            ),
            authorize = { ticket, _ ->
                when (ticket) {
                    OWNER_TICKET -> AccessGrant(Long.MAX_VALUE, true, null, "druckheil")
                    VISITOR_TICKET -> AccessGrant(Long.MAX_VALUE, false, null, "visitor")
                    else -> null
                }
            },
            policy = { NodePolicy() },
            available = { true },
            quickTest = { DiskBenchmark(1_720_000_000, 120_000_000, 80_000_000) },
        )
        server.start()
        try {
            val unauthorized = request(port, "GET", "/v1/fluo/posts", null, null)
            assertEquals(401, unauthorized.first)

            val range = request(
                port,
                "GET",
                "/v1/files/${streamed.id}?access_token=$OWNER_TICKET",
                null,
                null,
                range = "bytes=2-5",
            )
            assertEquals(206, range.first)
            assertEquals("2345", range.second)

            val tested = request(port, "POST", "/v1/diagnostics/quick-test", OWNER_TICKET, null)
            assertEquals(200, tested.first)
            assertEquals(120_000_000, JSONObject(tested.second).getLong("diskReadBps"))

            val created = request(port, "POST", "/v1/fluo/posts", OWNER_TICKET, """
                {"body":"Hello from Android 12","attachments":[]}
            """.trimIndent())
            assertEquals(201, created.first)
            val post = JSONObject(created.second).getJSONObject("post")
            assertEquals("druckheil", post.getString("author"))

            val stateAfterCreate = JSONObject(request(
                port, "GET", "/v1/fluo/state", VISITOR_TICKET, null,
            ).second)
            assertEquals(1, stateAfterCreate.getJSONObject("spaces")
                .getJSONObject("private").getInt("postCount"))
            val stateHashAfterCreate = stateAfterCreate.getJSONObject("spaces")
                .getJSONObject("private").getString("stateHash")
            assertTrue(stateHashAfterCreate.isNotBlank())

            val listed = request(port, "GET", "/v1/fluo/posts", VISITOR_TICKET, null)
            assertEquals(200, listed.first)
            assertEquals("Hello from Android 12", JSONObject(listed.second)
                .getJSONArray("posts").getJSONObject(0).getString("body"))

            val deleted = request(port, "DELETE", "/v1/fluo/posts/${post.getString("id")}", OWNER_TICKET, null)
            assertEquals(200, deleted.first)
            assertTrue(posts.list().isEmpty())
            val stateAfterDelete = JSONObject(request(
                port, "GET", "/v1/fluo/state", VISITOR_TICKET, null,
            ).second)
            assertEquals(0, stateAfterDelete.getJSONObject("spaces")
                .getJSONObject("private").getInt("postCount"))
            assertNotEquals(stateHashAfterCreate, stateAfterDelete.getJSONObject("spaces")
                .getJSONObject("private").getString("stateHash"))

            request(port, "POST", "/v1/fluo/posts", OWNER_TICKET, """
                {"body":"Delete me","attachments":[]}
            """.trimIndent())
            val cleared = request(port, "DELETE", "/v1/storage", OWNER_TICKET, null)
            assertEquals(200, cleared.first)
            assertEquals(1, JSONObject(cleared.second).getInt("deletedPosts"))
            assertTrue(JSONObject(cleared.second).getLong("deletedBytes") > 0)
            assertTrue(posts.list().isEmpty())
        } finally {
            server.stop()
        }
    }

    @Test
    fun `public accepts authenticated writers while private only accepts owner writes`() {
        val port = ServerSocket(0).use { it.localPort }
        val privateRoot = temporary.newFolder("private-access")
        val publicRoot = temporary.newFolder("public-access")
        val privateUploads = TusUploadStore(privateRoot, 0)
        val publicUploads = TusUploadStore(publicRoot, 1_024 * 1_024)
        val deletedPublicPosts = mutableListOf<String>()
        val server = NodeHttpServer(
            port = port,
            spaces = mapOf(
                NodeHttpServer.NodeSpace.PRIVATE to NodeHttpServer.SpaceStorage(
                    privateUploads, FluoPostStore(privateRoot, privateUploads, "druckheil"), null,
                    LigoEnvelopeStore(privateRoot, privateUploads),
                ),
                NodeHttpServer.NodeSpace.PUBLIC to NodeHttpServer.SpaceStorage(
                    publicUploads, FluoPostStore(publicRoot, publicUploads, "druckheil"), null,
                    LigoEnvelopeStore(publicRoot, publicUploads),
                ),
            ),
            authorize = { ticket, reservationId ->
                val reservation = when (reservationId) {
                    PUBLIC_RESERVATION -> PublicReservation(PUBLIC_RESERVATION, 1_024)
                    PUBLIC_RESERVATION_2 -> PublicReservation(PUBLIC_RESERVATION_2, 1_024)
                    PUBLIC_RESERVATION_3 -> PublicReservation(PUBLIC_RESERVATION_3, 1_024)
                    else -> null
                }
                when (ticket) {
                    OWNER_TICKET -> AccessGrant(Long.MAX_VALUE, true, reservation, "druckheil")
                    VISITOR_TICKET -> AccessGrant(Long.MAX_VALUE, false, reservation, "visitor")
                    else -> null
                }
            },
            policy = { NodePolicy() },
            available = { true },
            quickTest = { DiskBenchmark(1, 1, 1) },
            onPublicPostDeleted = deletedPublicPosts::add,
        )
        server.start()
        try {
            val privateWrite = request(port, "POST", "/v1/spaces/private/fluo/posts", VISITOR_TICKET,
                """{"body":"No","attachments":[]}""")
            assertEquals(403, privateWrite.first)

            val unreservedPublicWrite = request(
                port, "POST", "/v1/spaces/public/fluo/posts", VISITOR_TICKET,
                """{"body":"No reservation","attachments":[]}""",
            )
            assertEquals(403, unreservedPublicWrite.first)

            val publicWrite = request(port, "POST", "/v1/spaces/public/fluo/posts", VISITOR_TICKET,
                """{"body":"Public","attachments":[]}""", PUBLIC_RESERVATION)
            assertEquals(201, publicWrite.first)
            val firstPublicId = JSONObject(publicWrite.second).getJSONObject("post").getString("id")

            val publicRead = request(port, "GET", "/v1/spaces/public/fluo/posts", OWNER_TICKET, null)
            assertEquals("visitor", JSONObject(publicRead.second).getJSONArray("posts")
                .getJSONObject(0).getString("author"))

            val ownerOnlyClear = request(port, "DELETE", "/v1/storage", VISITOR_TICKET, null)
            assertEquals(403, ownerOnlyClear.first)

            assertThrows(IllegalArgumentException::class.java) {
                server.applySpaceQuotas(publicQuotaBytes = 0, privateQuotaBytes = 1_024 * 1_024)
            }
            val firstDeleted = request(
                port, "DELETE", "/v1/spaces/public/fluo/posts/$firstPublicId", VISITOR_TICKET, null,
            )
            assertEquals(200, firstDeleted.first)
            server.applySpaceQuotas(publicQuotaBytes = 0, privateQuotaBytes = 1_024 * 1_024)

            server.applySpaceQuotas(publicQuotaBytes = 512 * 1_024, privateQuotaBytes = 512 * 1_024)
            val secondPublic = request(port, "POST", "/v1/spaces/public/fluo/posts", VISITOR_TICKET,
                """{"body":"Keep public","attachments":[]}""", PUBLIC_RESERVATION_2)
            assertEquals(201, secondPublic.first)
            val secondPublicId = JSONObject(secondPublic.second).getJSONObject("post").getString("id")
            val privateCleared = request(
                port, "DELETE", "/v1/spaces/private/storage", OWNER_TICKET, null,
            )
            assertEquals(200, privateCleared.first)
            assertEquals(0, JSONObject(privateCleared.second).getInt("deletedPosts"))
            val privateAfterClear = request(port, "GET", "/v1/spaces/private/fluo/posts", VISITOR_TICKET, null)
            val publicAfterClear = request(port, "GET", "/v1/spaces/public/fluo/posts", VISITOR_TICKET, null)
            assertEquals(0, JSONObject(privateAfterClear.second).getJSONArray("posts").length())
            assertEquals(1, JSONObject(publicAfterClear.second).getJSONArray("posts").length())
            val deletedPublic = request(
                port,
                "DELETE",
                "/v1/spaces/public/fluo/posts/$secondPublicId",
                VISITOR_TICKET,
                null,
            )
            assertEquals(200, deletedPublic.first)
            assertEquals(listOf(firstPublicId, secondPublicId), deletedPublicPosts)

            val clearedPublic = request(port, "POST", "/v1/spaces/public/fluo/posts", VISITOR_TICKET,
                """{"body":"Clear public","attachments":[]}""", PUBLIC_RESERVATION_3)
            val clearedPublicId = JSONObject(clearedPublic.second).getJSONObject("post").getString("id")
            val clearedAll = request(port, "DELETE", "/v1/storage", OWNER_TICKET, null)
            assertEquals(200, clearedAll.first)
            assertEquals(listOf(firstPublicId, secondPublicId, clearedPublicId), deletedPublicPosts)
        } finally {
            server.stop()
        }
    }

    @Test
    fun `Rondo scope stores and pages room messages without exposing another room`() {
        val port = ServerSocket(0).use { it.localPort }
        val privateRoot = temporary.newFolder("rondo-http")
        val uploads = TusUploadStore(privateRoot, 1_024 * 1_024)
        val posts = FluoPostStore(privateRoot, uploads, "druckheil")
        val messages = RondoMessageStore(privateRoot, uploads)
        val publicRoot = temporary.newFolder("rondo-public")
        val publicUploads = TusUploadStore(publicRoot, 0)
        val server = NodeHttpServer(
            port = port,
            spaces = mapOf(
                NodeHttpServer.NodeSpace.PRIVATE to NodeHttpServer.SpaceStorage(
                    uploads, posts, messages, LigoEnvelopeStore(privateRoot, uploads),
                ),
                NodeHttpServer.NodeSpace.PUBLIC to NodeHttpServer.SpaceStorage(
                    publicUploads, posts, null, LigoEnvelopeStore(publicRoot, publicUploads),
                ),
            ),
            authorize = { ticket, _ ->
                if (ticket == OWNER_TICKET) AccessGrant(Long.MAX_VALUE, true, null, "druckheil") else null
            },
            authorizeRondo = { ticket, spaceId, roomId ->
                if (spaceId != SPACE_ID || roomId != ROOM_ID) null else when (ticket) {
                    VISITOR_TICKET -> AccessGrant(
                        Long.MAX_VALUE, false, null, "visitor",
                        RondoGrant(1_024 * 1_024, false, ROOM_ID, SPACE_ID, "private"),
                    )
                    OWNER_TICKET -> AccessGrant(
                        Long.MAX_VALUE, true, null, "druckheil",
                        RondoGrant(1_024 * 1_024, true, ROOM_ID, SPACE_ID, "private"),
                    )
                    else -> null
                }
            },
            policy = { NodePolicy() },
            available = { true },
            quickTest = { DiskBenchmark(1, 1, 1) },
        )
        server.start()
        try {
            val path = "/v1/rondo/spaces/$SPACE_ID/rooms/$ROOM_ID/messages"
            val created = request(
                port, "POST", path, VISITOR_TICKET, """{"body":"Hello Rondo"}""",
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            )
            assertEquals(201, created.first)
            val listed = request(
                port, "GET", "$path?limit=20", VISITOR_TICKET, null,
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            )
            assertEquals(200, listed.first)
            assertEquals("Hello Rondo", JSONObject(listed.second).getJSONArray("messages")
                .getJSONObject(0).getString("body"))

            val wrongRoom = request(
                port, "GET", path, VISITOR_TICKET, null,
                rondoSpaceId = SPACE_ID, rondoRoomId = OTHER_ROOM_ID,
            )
            assertEquals(401, wrongRoom.first)

            val voiceBase = "/v1/rondo/spaces/$SPACE_ID/rooms/$ROOM_ID/voice"
            assertEquals(200, request(
                port, "POST", "$voiceBase/join", VISITOR_TICKET,
                """{"peerId":"$VOICE_PEER_1"}""",
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            ).first)
            assertEquals(200, request(
                port, "POST", "$voiceBase/join", OWNER_TICKET,
                """{"peerId":"$VOICE_PEER_2"}""",
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            ).first)
            val signaled = request(
                port, "POST", "$voiceBase/signals", VISITOR_TICKET,
                """{"peerId":"$VOICE_PEER_1","toPeerId":"$VOICE_PEER_2","type":"offer","payload":"sdp"}""",
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            )
            assertEquals(202, signaled.first)
            val synced = request(
                port, "GET", "$voiceBase/sync?peerId=$VOICE_PEER_2&after=0", OWNER_TICKET, null,
                rondoSpaceId = SPACE_ID, rondoRoomId = ROOM_ID,
            )
            assertEquals("sdp", JSONObject(synced.second).getJSONArray("signals")
                .getJSONObject(0).getString("payload"))
        } finally {
            server.stop()
        }
    }

    private fun request(
        port: Int,
        method: String,
        path: String,
        ticket: String?,
        body: String?,
        reservationId: String? = null,
        range: String? = null,
        rondoSpaceId: String? = null,
        rondoRoomId: String? = null,
    ): Pair<Int, String> {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 2_000
        connection.readTimeout = 2_000
        ticket?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        reservationId?.let {
            connection.setRequestProperty("X-Kaordo-Public-Reservation", it)
        }
        range?.let { connection.setRequestProperty("Range", it) }
        rondoSpaceId?.let { connection.setRequestProperty("X-Kaordo-Rondo-Space", it) }
        rondoRoomId?.let { connection.setRequestProperty("X-Kaordo-Rondo-Room", it) }
        body?.let {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { output -> output.write(it.toByteArray()) }
        }
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        return status to (stream?.bufferedReader()?.use { it.readText() } ?: "")
    }

    private companion object {
        val OWNER_TICKET = "A".repeat(43)
        val VISITOR_TICKET = "B".repeat(43)
        const val PUBLIC_RESERVATION = "123e4567-e89b-42d3-a456-426614174090"
        const val PUBLIC_RESERVATION_2 = "123e4567-e89b-42d3-a456-426614174091"
        const val PUBLIC_RESERVATION_3 = "123e4567-e89b-42d3-a456-426614174092"
        const val SPACE_ID = "123e4567-e89b-42d3-a456-426614174093"
        const val ROOM_ID = "123e4567-e89b-42d3-a456-426614174094"
        const val OTHER_ROOM_ID = "123e4567-e89b-42d3-a456-426614174095"
        const val VOICE_PEER_1 = "123e4567-e89b-42d3-a456-426614174096"
        const val VOICE_PEER_2 = "123e4567-e89b-42d3-a456-426614174097"
    }
}
