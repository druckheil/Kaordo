package io.kaordo.nodo.storage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream

class TusUploadStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `upload resumes from persisted offset and completes`() {
        val store = TusUploadStore(temporary.root, quotaBytes = 32)
        val upload = store.create(11, "filename aGVsbG8udHh0")

        val first = store.append(upload.id, 0, 6, ByteArrayInputStream("hello ".toByteArray()))
        assertEquals(6, first.offset)
        assertFalse(first.complete)

        val second = store.append(upload.id, 6, 5, ByteArrayInputStream("world".toByteArray()))
        assertEquals(11, second.offset)
        assertTrue(second.complete)
        val (_, file) = store.completedFile(upload.id)!!
        assertArrayEquals("hello world".toByteArray(), file.readBytes())
    }

    @Test
    fun `quota and offset conflicts do not corrupt an upload`() {
        val store = TusUploadStore(temporary.root, quotaBytes = 8)
        val upload = store.create(8, "")

        assertThrows(TusUploadStore.QuotaExceeded::class.java) { store.create(1, "") }
        val error = assertThrows(TusUploadStore.OffsetMismatch::class.java) {
            store.append(upload.id, 2, 1, ByteArrayInputStream(byteArrayOf(1)))
        }
        assertEquals(0, error.correctOffset)
        assertEquals(0L, store.record(upload.id)?.offset)
    }

    @Test
    fun `termination releases allocated storage`() {
        val store = TusUploadStore(temporary.root, quotaBytes = 8)
        val upload = store.create(8, "")
        store.append(upload.id, 0, 4, ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)))

        assertTrue(store.delete(upload.id))
        assertEquals(0, store.usedBytes())
        assertEquals(0, store.uploadCount())
    }

    @Test
    fun `clear all removes complete and partial uploads with their reservations`() {
        val store = TusUploadStore(temporary.root, quotaBytes = 32)
        val partial = store.create(8, "")
        store.append(partial.id, 0, 3, ByteArrayInputStream(byteArrayOf(1, 2, 3)))
        val complete = store.create(4, "")
        store.append(complete.id, 0, 4, ByteArrayInputStream(byteArrayOf(4, 5, 6, 7)))

        val cleared = store.clearAll()

        assertEquals(7, cleared.deletedBytes)
        assertEquals(2, cleared.deletedUploads)
        assertEquals(0, store.usedBytes())
        assertEquals(0, store.uploadCount())
        store.create(32, "")
    }

    @Test
    fun `cleanup removes only partial and orphaned uploads idle for a day`() {
        var now = 1_700_000_000_000L
        val store = TusUploadStore(temporary.root, quotaBytes = 64, clock = { now })
        val stale = store.create(10, "")
        store.append(stale.id, 0, 3, ByteArrayInputStream(byteArrayOf(1, 2, 3)))
        val complete = store.create(4, "")
        store.append(complete.id, 0, 4, ByteArrayInputStream(byteArrayOf(4, 5, 6, 7)))
        now += 25 * 60 * 60 * 1_000L
        val recent = store.create(8, "")
        store.append(recent.id, 0, 2, ByteArrayInputStream(byteArrayOf(8, 9)))
        val orphanId = "123e4567-e89b-42d3-a456-426614174000"
        val orphan = temporary.root.resolve("files/$orphanId.data")
        orphan.writeBytes(byteArrayOf(10, 11))
        orphan.setLastModified(now - 25 * 60 * 60 * 1_000L)

        val cleaned = store.cleanupStalePartials(24 * 60 * 60 * 1_000L)

        assertEquals(5, cleaned.deletedBytes)
        assertEquals(2, cleaned.deletedUploads)
        assertEquals(null, store.record(stale.id))
        assertEquals(complete.length, store.record(complete.id)?.offset)
        assertEquals(2L, store.record(recent.id)?.offset)
        assertFalse(orphan.exists())
    }
}
