package io.kaordo.nodo.data

import org.junit.Assert.assertEquals
import org.junit.Test

class PasswordProofTest {
    @Test
    fun `proof matches the desktop authentication protocol`() {
        assertEquals(
            "UPVGAoDwvj31lR6DX86rkIvuk8ow4UVe5_44yhvXSlE",
            PasswordProof.create("Desktop_User", "correct horse battery staple".toCharArray()),
        )
    }
}
