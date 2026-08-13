package io.kaordo.nodo.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RondoMessageStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `messages page newest first with a durable cursor`() {
        val root = temporary.newFolder("rondo-page")
        val store = RondoMessageStore(root, TusUploadStore(root, 1_024 * 1_024))
        repeat(55) { index ->
            store.create(SPACE_ID, ROOM_ID, "druckheil", "Message $index", 1_024 * 1_024)
        }

        val first = store.page(SPACE_ID, ROOM_ID, 40, null)
        val second = store.page(SPACE_ID, ROOM_ID, 40, first.nextCursor)

        assertEquals(40, first.messages.size)
        assertEquals("Message 54", first.messages.first().body)
        assertEquals(15, second.messages.size)
        assertEquals("Message 14", second.messages.first().body)
        assertNull(second.nextCursor)
        assertEquals(55, (first.messages + second.messages).map { it.id }.distinct().size)
    }

    @Test
    fun `author may delete own message and space owner may moderate`() {
        val root = temporary.newFolder("rondo-delete")
        val store = RondoMessageStore(root, TusUploadStore(root, 1_024 * 1_024))
        val message = store.create(SPACE_ID, ROOM_ID, "visitor", "Hello", 1_024 * 1_024)

        assertEquals(
            RondoMessageStore.DeleteResult.FORBIDDEN,
            store.delete(SPACE_ID, ROOM_ID, message.id, "someone", false),
        )
        assertEquals(
            RondoMessageStore.DeleteResult.DELETED,
            store.delete(SPACE_ID, ROOM_ID, message.id, "druckheil", true),
        )
        assertTrue(store.page(SPACE_ID, ROOM_ID, 10, null).messages.isEmpty())
    }

    @Test
    fun `space quota rejects additional messages`() {
        val root = temporary.newFolder("rondo-quota")
        val store = RondoMessageStore(root, TusUploadStore(root, 1_024 * 1_024))
        assertThrows(RondoMessageStore.QuotaExceeded::class.java) {
            store.create(SPACE_ID, ROOM_ID, "druckheil", "Hello", 1)
        }
    }

    private companion object {
        const val SPACE_ID = "123e4567-e89b-42d3-a456-426614174000"
        const val ROOM_ID = "123e4567-e89b-42d3-a456-426614174001"
    }
}

