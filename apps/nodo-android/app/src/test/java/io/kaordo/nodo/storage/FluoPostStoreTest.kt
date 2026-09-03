package io.kaordo.nodo.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream

class FluoPostStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `post metadata and media live together on the node`() {
        val uploads = TusUploadStore(temporary.root, 4_096)
        val upload = uploads.create(5, "filename aGVsbG8ucG5n")
        uploads.append(upload.id, 0, 5, ByteArrayInputStream("image".toByteArray()))
        val posts = FluoPostStore(temporary.root, uploads, "druckheil")

        val post = posts.create("druckheil", " Hello from Nodo. ", listOf(
            FluoPostStore.Attachment(
                upload.id, "image", "image/png", "hello.png", 5,
                width = 1_920, height = 1_080,
            ),
        ))

        assertEquals("Hello from Nodo.", post.body)
        assertEquals("druckheil", post.author)
        assertEquals(1_920, post.attachments.single().width)
        assertEquals(1_080, post.attachments.single().height)
        assertEquals(listOf(post), posts.list())
        assertTrue(uploads.usedBytes() > 5)
        assertEquals(FluoPostStore.DeleteResult.DELETED, posts.delete(post.id))
        assertNull(uploads.record(upload.id))
        assertEquals(0, uploads.usedBytes())
    }

    @Test
    fun `incomplete media cannot be attached`() {
        val uploads = TusUploadStore(temporary.root, 128)
        val upload = uploads.create(5, "")
        val posts = FluoPostStore(temporary.root, uploads, "owner")

        assertThrows(FluoPostStore.MissingMedia::class.java) {
            posts.create("owner", "", listOf(
                FluoPostStore.Attachment(upload.id, "image", "image/png", "pending.png", 5),
            ))
        }
    }

    @Test
    fun `text post metadata consumes used bytes and respects the node quota`() {
        val uploads = TusUploadStore(temporary.root, 4_096)
        val posts = FluoPostStore(temporary.root, uploads, "owner")

        val post = posts.create("owner", "Stored only on Nodo", emptyList())

        assertTrue(uploads.usedBytes() > post.body.toByteArray().size)
        assertEquals(FluoPostStore.DeleteResult.DELETED, posts.delete(post.id))
        assertEquals(0, uploads.usedBytes())

        val tinyUploads = TusUploadStore(temporary.newFolder("tiny"), 32)
        val tinyPosts = FluoPostStore(temporary.root.resolve("tiny"), tinyUploads, "owner")
        assertThrows(TusUploadStore.QuotaExceeded::class.java) {
            tinyPosts.create("owner", "This metadata does not fit", emptyList())
        }
    }

    @Test
    fun `post body supports up to five thousand characters`() {
        val uploads = TusUploadStore(temporary.root, 64 * 1_024)
        val posts = FluoPostStore(temporary.root, uploads, "owner")
        val maximumBody = "a".repeat(FluoPostStore.MAX_BODY_LENGTH)

        assertEquals(maximumBody, posts.create("owner", maximumBody, emptyList()).body)
        assertThrows(IllegalArgumentException::class.java) {
            posts.create("owner", "a".repeat(FluoPostStore.MAX_BODY_LENGTH + 1), emptyList())
        }
    }

    @Test
    fun `quoted post metadata survives a store restart`() {
        val root = temporary.root
        val uploads = TusUploadStore(root, 64 * 1_024)
        val posts = FluoPostStore(root, uploads, "owner")
        val originalId = "123e4567-e89b-42d3-a456-426614174000"

        val created = posts.create(
            author = "owner",
            body = "Adding context",
            attachments = emptyList(),
            quote = FluoPostStore.QuotedPost(
                attachments = emptyList(),
                author = "someone",
                body = "The original",
                createdAt = 1_720_000_000_000,
                id = originalId,
                nodeId = "node-1",
                space = "public",
            ),
        )
        assertEquals("The original", created.quote?.body)

        val reopened = FluoPostStore(root, uploads, "owner")
        assertEquals(originalId, reopened.list().single().quote?.id)
        assertEquals("public", reopened.list().single().quote?.space)
    }

    @Test
    fun `cursor pages remain stable and skip deleted posts`() {
        val uploads = TusUploadStore(temporary.root, 64 * 1_024)
        val posts = FluoPostStore(temporary.root, uploads, "owner")
        val created = (1..5).map { posts.create("owner", "Post $it", emptyList()) }

        val first = posts.page(2)
        assertEquals(2, first.posts.size)
        assertTrue(first.nextCursor != null)
        val deleted = created.first { candidate -> first.posts.none { it.id == candidate.id } }
        posts.delete(deleted.id)
        val second = posts.page(2, first.nextCursor)
        val third = posts.page(2, second.nextCursor)

        val ids = (first.posts + second.posts + third.posts).map { it.id }
        assertEquals(4, ids.distinct().size)
        assertTrue(deleted.id !in ids)
    }

    @Test
    fun `author pages filter without losing the cursor position`() {
        val uploads = TusUploadStore(temporary.root, 64 * 1_024)
        val posts = FluoPostStore(temporary.root, uploads, "owner")
        posts.create("alice", "Alice one", emptyList())
        posts.create("bob", "Bob one", emptyList())
        posts.create("alice", "Alice two", emptyList())
        posts.create("carol", "Carol one", emptyList())

        val first = posts.page(1, null, "ALICE")
        val second = posts.page(1, first.nextCursor, "alice")

        assertEquals(1, first.posts.size)
        assertEquals("alice", first.posts.single().author)
        assertEquals(1, second.posts.size)
        assertEquals("alice", second.posts.single().author)
        assertTrue(first.posts.single().id != second.posts.single().id)
    }

    @Test
    fun `public reservation can back only one post`() {
        val uploads = TusUploadStore(temporary.root, 4_096)
        val posts = FluoPostStore(temporary.root, uploads, "owner")
        val reservationId = "123e4567-e89b-42d3-a456-426614174000"

        posts.create("owner", "First", emptyList(), reservationId)

        assertThrows(FluoPostStore.PublicReservationUsed::class.java) {
            posts.create("owner", "Second", emptyList(), reservationId)
        }
    }
}
