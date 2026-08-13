package io.kaordo.nodo.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RondoVoiceHubTest {
    @Test
    fun `participants exchange ordered targeted signals and leave`() {
        var now = 1_000L
        val hub = RondoVoiceHub { now }
        hub.join(SPACE_ID, ROOM_ID, FIRST_PEER, "first")
        val joined = hub.join(SPACE_ID, ROOM_ID, SECOND_PEER, "second")
        assertEquals(listOf("first", "second"), joined.participants.map { it.username })

        val sequence = hub.signal(
            SPACE_ID, ROOM_ID, FIRST_PEER, SECOND_PEER, "offer", "offer-sdp", "first",
        )
        val second = hub.sync(SPACE_ID, ROOM_ID, SECOND_PEER, 0)
        assertEquals(sequence, second.cursor)
        assertEquals("offer-sdp", second.signals.single().payload)
        assertTrue(hub.sync(SPACE_ID, ROOM_ID, FIRST_PEER, 0).signals.isEmpty())

        assertTrue(hub.leave(SPACE_ID, ROOM_ID, FIRST_PEER, "first"))
        assertEquals(listOf("second"), hub.sync(SPACE_ID, ROOM_ID, SECOND_PEER, sequence).participants.map { it.username })
    }

    @Test
    fun `stale voice participant is pruned`() {
        var now = 1_000L
        val hub = RondoVoiceHub { now }
        hub.join(SPACE_ID, ROOM_ID, FIRST_PEER, "first")
        hub.join(SPACE_ID, ROOM_ID, SECOND_PEER, "second")
        now += 26_000
        assertThrows(RondoVoiceHub.ParticipantMissing::class.java) {
            hub.sync(SPACE_ID, ROOM_ID, SECOND_PEER, 0)
        }
    }

    private companion object {
        const val SPACE_ID = "123e4567-e89b-42d3-a456-426614174100"
        const val ROOM_ID = "123e4567-e89b-42d3-a456-426614174101"
        const val FIRST_PEER = "123e4567-e89b-42d3-a456-426614174102"
        const val SECOND_PEER = "123e4567-e89b-42d3-a456-426614174103"
    }
}
