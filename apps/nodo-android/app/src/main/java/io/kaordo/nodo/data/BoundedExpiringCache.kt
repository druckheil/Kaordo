package io.kaordo.nodo.data

internal class BoundedExpiringCache<K, V>(
    private val maxSize: Int,
    private val isValid: (V, Long) -> Boolean,
    private val clock: () -> Long,
) {
    private val values = LinkedHashMap<K, V>(maxSize, 0.75f, true)

    init {
        require(maxSize > 0)
    }

    @Synchronized
    operator fun get(key: K): V? {
        val value = values[key] ?: return null
        if (isValid(value, clock())) return value
        values.remove(key)
        return null
    }

    @Synchronized
    operator fun set(key: K, value: V) {
        val now = clock()
        values.entries.removeAll { !isValid(it.value, now) }
        values[key] = value
        while (values.size > maxSize) {
            values.remove(values.entries.first().key)
        }
    }
}
