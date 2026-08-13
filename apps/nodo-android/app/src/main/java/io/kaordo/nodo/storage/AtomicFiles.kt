package io.kaordo.nodo.storage

import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal fun moveTemporaryFile(temporary: File, target: File, replace: Boolean = true) {
    val fallbackOptions = if (replace) {
        arrayOf(StandardCopyOption.REPLACE_EXISTING)
    } else {
        emptyArray()
    }
    val atomicOptions = if (replace) {
        arrayOf(StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } else {
        arrayOf(StandardCopyOption.ATOMIC_MOVE)
    }
    try {
        try {
            Files.move(temporary.toPath(), target.toPath(), *atomicOptions)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(temporary.toPath(), target.toPath(), *fallbackOptions)
        }
    } finally {
        if (temporary.exists()) temporary.delete()
    }
}
