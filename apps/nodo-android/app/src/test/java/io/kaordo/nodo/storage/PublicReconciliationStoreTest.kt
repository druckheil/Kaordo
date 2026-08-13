package io.kaordo.nodo.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PublicReconciliationStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `cleanup acknowledgements survive restart until coordinator accepts them`() {
        val postId = "123e4567-e89b-42d3-a456-426614174001"
        val reservationId = "123e4567-e89b-42d3-a456-426614174002"
        PublicReconciliationStore(temporary.root).apply {
            recordPostDeletion(postId)
            recordReservationRelease(reservationId)
        }

        val restored = PublicReconciliationStore(temporary.root)
        val pending = restored.pending()
        assertEquals(listOf(postId), pending.postIds)
        assertEquals(listOf(reservationId), pending.reservationIds)

        restored.acknowledge(pending)
        assertTrue(PublicReconciliationStore(temporary.root).pending().postIds.isEmpty())
        assertTrue(PublicReconciliationStore(temporary.root).pending().reservationIds.isEmpty())
    }
}
