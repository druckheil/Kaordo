package io.kaordo.nodo.server

class RondoVoiceHub(private val clock: () -> Long = System::currentTimeMillis) {
    private val rooms = mutableMapOf<RoomKey, Room>()

    @Synchronized
    fun join(spaceId: String, roomId: String, peerId: String, username: String): Snapshot {
        validateId(spaceId)
        validateId(roomId)
        validateId(peerId)
        require(username.length in 1..32)
        val now = clock()
        val room = room(spaceId, roomId)
        prune(room, now)
        val existing = room.participants[peerId]
        if (existing != null && existing.username != username) {
            room.signals.removeAll { it.fromPeerId == peerId || it.toPeerId == peerId }
        }
        room.participants[peerId] = existing?.takeIf { it.username == username }
            ?.copy(lastSeenAt = now)
            ?: Participant(peerId, username, now, now)
        return snapshot(room, peerId, 0)
    }

    @Synchronized
    fun sync(spaceId: String, roomId: String, peerId: String, after: Long): Snapshot {
        validateId(peerId)
        require(after >= 0)
        val key = roomKey(spaceId, roomId)
        val room = rooms[key] ?: throw ParticipantMissing()
        val now = clock()
        prune(room, now)
        if (room.participants.isEmpty()) rooms.remove(key)
        val participant = room.participants[peerId] ?: throw ParticipantMissing()
        room.participants[peerId] = participant.copy(lastSeenAt = now)
        return snapshot(room, peerId, after)
    }

    @Synchronized
    fun peek(spaceId: String, roomId: String): Snapshot {
        validateId(spaceId)
        validateId(roomId)
        val key = roomKey(spaceId, roomId)
        val room = rooms[key] ?: return Snapshot(0, emptyList(), emptyList())
        prune(room, clock())
        if (room.participants.isEmpty()) {
            rooms.remove(key)
            return Snapshot(room.sequence, emptyList(), emptyList())
        }
        return snapshot(room, "", room.sequence)
    }

    @Synchronized
    fun signal(
        spaceId: String,
        roomId: String,
        fromPeerId: String,
        toPeerId: String,
        type: String,
        payload: String,
        username: String,
    ): Long {
        validateId(fromPeerId)
        validateId(toPeerId)
        require(type in SIGNAL_TYPES)
        require(payload.toByteArray().size in 1..MAX_SIGNAL_BYTES)
        val key = roomKey(spaceId, roomId)
        val room = rooms[key] ?: throw ParticipantMissing()
        val now = clock()
        prune(room, now)
        if (room.participants.isEmpty()) rooms.remove(key)
        val sender = room.participants[fromPeerId] ?: throw ParticipantMissing()
        if (sender.username != username || toPeerId !in room.participants) throw ParticipantMissing()
        room.sequence += 1
        room.signals.add(Signal(room.sequence, fromPeerId, toPeerId, type, payload, now))
        if (room.signals.size > MAX_SIGNALS_PER_ROOM) {
            room.signals.subList(0, room.signals.size - MAX_SIGNALS_PER_ROOM).clear()
        }
        return room.sequence
    }

    @Synchronized
    fun leave(spaceId: String, roomId: String, peerId: String, username: String): Boolean {
        val key = RoomKey(spaceId, roomId)
        val room = rooms[key] ?: return false
        val participant = room.participants[peerId] ?: return false
        if (participant.username != username) return false
        room.participants.remove(peerId)
        room.signals.removeAll { it.fromPeerId == peerId || it.toPeerId == peerId }
        if (room.participants.isEmpty()) rooms.remove(key)
        return true
    }

    private fun room(spaceId: String, roomId: String): Room {
        return rooms.getOrPut(roomKey(spaceId, roomId)) { Room() }
    }

    private fun roomKey(spaceId: String, roomId: String): RoomKey {
        validateId(spaceId)
        validateId(roomId)
        return RoomKey(spaceId, roomId)
    }

    private fun snapshot(room: Room, peerId: String, after: Long) = Snapshot(
        cursor = room.sequence,
        participants = room.participants.values.sortedWith(
            compareBy<Participant> { it.joinedAt }.thenBy { it.peerId },
        ),
        signals = room.signals.filter { it.toPeerId == peerId && it.sequence > after },
    )

    private fun prune(room: Room, now: Long) {
        val stale = room.participants.values
            .filter { now - it.lastSeenAt > PARTICIPANT_TIMEOUT_MS }
            .map { it.peerId }
            .toSet()
        if (stale.isNotEmpty()) {
            stale.forEach(room.participants::remove)
            room.signals.removeAll { it.fromPeerId in stale || it.toPeerId in stale }
        }
        room.signals.removeAll { now - it.createdAt > SIGNAL_TIMEOUT_MS }
    }

    private fun validateId(value: String) = require(ID.matches(value))

    private data class RoomKey(val spaceId: String, val roomId: String)
    private data class Room(
        val participants: MutableMap<String, Participant> = linkedMapOf(),
        val signals: MutableList<Signal> = mutableListOf(),
        var sequence: Long = 0,
    )

    data class Participant(
        val peerId: String,
        val username: String,
        val joinedAt: Long,
        val lastSeenAt: Long,
    )

    data class Signal(
        val sequence: Long,
        val fromPeerId: String,
        val toPeerId: String,
        val type: String,
        val payload: String,
        val createdAt: Long,
    )

    data class Snapshot(
        val cursor: Long,
        val participants: List<Participant>,
        val signals: List<Signal>,
    )

    class ParticipantMissing : Exception()

    companion object {
        private const val MAX_SIGNAL_BYTES = 32 * 1_024
        private const val MAX_SIGNALS_PER_ROOM = 512
        private const val PARTICIPANT_TIMEOUT_MS = 25_000L
        private const val SIGNAL_TIMEOUT_MS = 60_000L
        private val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        private val SIGNAL_TYPES = setOf("answer", "ice", "offer")
    }
}
