package io.kaordo.nodo.storage

import java.io.File

object NodeStorageLayout {
    private val legacyDirectories = listOf("files", "records", "fluo-posts", "rondo-spaces")

    fun prepare(root: File): Spaces {
        root.mkdirs()
        val privateRoot = File(root, "private").apply { mkdirs() }
        val publicRoot = File(root, "public").apply { mkdirs() }
        migrateLegacy(root, privateRoot)
        return Spaces(privateRoot = privateRoot, publicRoot = publicRoot)
    }

    private fun migrateLegacy(root: File, privateRoot: File) {
        for (name in legacyDirectories) {
            val source = File(root, name)
            if (!source.exists()) continue
            val target = File(privateRoot, name)
            if (!target.exists() && source.renameTo(target)) continue
            moveTree(source, target)
        }
    }

    private fun moveTree(source: File, target: File) {
        if (source.isDirectory) {
            target.mkdirs()
            source.listFiles().orEmpty().forEach { moveTree(it, File(target, it.name)) }
            check(source.delete()) { "Legacy Nodo directory could not be removed." }
            return
        }
        if (!target.exists() && source.renameTo(target)) return
        if (target.exists()) {
            check(target.isFile && source.length() == target.length() && sameContents(source, target)) {
                "Conflicting legacy Nodo data could not be migrated."
            }
        } else {
            source.copyTo(target, overwrite = false)
        }
        check(source.delete()) { "Legacy Nodo data could not be removed after migration." }
    }

    private fun sameContents(first: File, second: File): Boolean =
        first.inputStream().buffered().use { left ->
            second.inputStream().buffered().use inner@{ right ->
                val leftBuffer = ByteArray(DEFAULT_BUFFER_SIZE)
                val rightBuffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val leftRead = left.read(leftBuffer)
                    val rightRead = right.read(rightBuffer)
                    if (leftRead != rightRead) return@inner false
                    if (leftRead < 0) return@inner true
                    if ((0 until leftRead).any { leftBuffer[it] != rightBuffer[it] }) return@inner false
                }
                @Suppress("UNREACHABLE_CODE") false
            }
        }

    data class Spaces(val privateRoot: File, val publicRoot: File)
}
