package io.kaordo.nodo.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class NodeStorageLayoutTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `legacy node data migrates into private without touching public`() {
        val root = temporary.newFolder("nodo-storage")
        val legacyFile = root.resolve("files/example.data")
        legacyFile.parentFile?.mkdirs()
        legacyFile.writeText("existing")

        val spaces = NodeStorageLayout.prepare(root)

        assertFalse(legacyFile.exists())
        assertEquals("existing", spaces.privateRoot.resolve("files/example.data").readText())
        assertTrue(spaces.publicRoot.isDirectory)
        assertTrue(spaces.publicRoot.listFiles().orEmpty().isEmpty())
    }
}
