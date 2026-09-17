package app.cindy.apkinstaller

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ApkValidationTest {
  @get:Rule val temporary = TemporaryFolder()
  private val installed = ApkIdentity("app.cindy.test", 1L, setOf("test-signer-a"))
  private val update = installed.copy(versionCode = 2L, signingHistory = installed.signers)

  private fun rejects(expected: String, incoming: ApkIdentity, modern: Boolean = true,
    current: ApkIdentity = installed) {
    val error = assertThrows(IllegalArgumentException::class.java) {
      validateApkIdentity(current, incoming, modern)
    }
    assertEquals(expected, error.message)
  }

  @Test fun sameSignerWorksForLegacyAndModernMetadata() {
    validateApkIdentity(installed, update, false)
    validateApkIdentity(installed, update, true)
  }

  @Test fun wrongSignerFailsForLegacyAndModernMetadata() {
    val wrong = update.copy(signers = setOf("test-signer-b"), signingHistory = setOf("test-signer-b"))
    rejects("Signing identity mismatch", wrong, false)
    rejects("Signing identity mismatch", wrong, true)
  }

  @Test fun authenticatedRotationOnlyWorksWithModernHistory() {
    val rotated = update.copy(signers = setOf("test-signer-b"),
      signingHistory = setOf("test-signer-a", "test-signer-b"))
    validateApkIdentity(installed, rotated, true)
    rejects("Signing identity mismatch", rotated, false)
    rejects("Signing identity mismatch", update, true, installed.copy(signers = setOf("test-signer-b")))
  }

  @Test fun multipleSignersRequireExactSetsRegardlessOfHistory() {
    val current = installed.copy(signers = setOf("test-signer-a", "test-signer-b"), hasMultipleSigners = true)
    val incoming = current.copy(versionCode = 2L, signers = setOf("test-signer-b", "test-signer-a"))
    for (modern in listOf(false, true)) {
      validateApkIdentity(current, incoming, modern)
      rejects("Signing identity mismatch", incoming.copy(signers = setOf("test-signer-a")), modern, current)
      rejects("Signing identity mismatch", incoming, modern)
    }
    rejects("Signing identity mismatch", update.copy(signingHistory = current.signers), true, current)
  }

  @Test fun missingInstalledSignersAndMissingHistoryFailClosed() {
    for (modern in listOf(false, true)) {
      rejects("Signing identity mismatch", update.copy(signers = emptySet()), modern,
        installed.copy(signers = emptySet()))
    }
    rejects("Signing identity mismatch", update.copy(signingHistory = emptySet()))
  }

  @Test fun wrongPackageAndNonIncreasingVersionAreRejected() {
    for (modern in listOf(false, true)) {
      rejects("Wrong application", update.copy(packageName = "other.app"), modern)
      rejects("Update must be newer", update.copy(versionCode = 1L), modern)
      rejects("Update must be newer", update.copy(versionCode = 0L), modern)
    }
    // Modern version codes must remain 64-bit, not truncate at the legacy int boundary.
    validateApkIdentity(installed.copy(versionCode = Int.MAX_VALUE.toLong()),
      update.copy(versionCode = Int.MAX_VALUE.toLong() + 1), true)
  }

  @Test fun acceptsOnlyNonemptyApkDirectlyInsideCanonicalCacheDirectory() {
    val cache = temporary.newFolder("cache")
    val apk = File(cache, "update.apk").apply { writeText("test-only-content") }
    assertEquals(apk.canonicalFile, validateApkFile(apk, cache))
    val nested = File(cache, "nested").apply { mkdir() }
    val invalid = listOf(
      File(cache, "missing.apk"),
      File(cache, "empty.apk").apply { createNewFile() },
      File(cache, "update.txt").apply { writeText("test") },
      File(nested, "update.apk").apply { writeText("test") },
      File(temporary.root, "outside.apk").apply { writeText("test") },
      File(cache, "../outside.apk"),
      File(cache, "directory.apk").apply { mkdir() },
    )
    for (file in invalid) {
      assertThrows(IllegalArgumentException::class.java) { validateApkFile(file, cache) }
    }
  }

  @Test fun canonicalizationRejectsSymlinkEscape() {
    val cache = temporary.newFolder("cache")
    val outside = temporary.newFile("outside.apk").apply { writeText("test") }
    val link = File(cache, "link.apk")
    Files.createSymbolicLink(link.toPath(), outside.toPath())
    assertThrows(IllegalArgumentException::class.java) { validateApkFile(link, cache) }
  }
}
