# ADR-004: Local private data, keys, recovery, and backups

**Status:** Draft for product/security review; `PRIVATE_STORE` remains unverified.
**Scope:** Saved library, visit history, absorbed knowledge and Laya vectors, captures, private browsing, local exports, and OS backup behavior. This is an implementation audit and proposed product policy, not a security certification.

## Context

The product has no account or personal-data sync. Bookmarks, visits, collections, absorbed source text, extracted metadata, and Laya vectors are local. They still need explicit decisions about at-rest protection, key loss, user exports, retention, deletion, and OS backups. “Local” does not itself define those guarantees.

The current implementation uses more than one storage mechanism. This draft records those mechanisms and marks where the product promises exceed the behavior that has evidence today.

## Proposed decisions

1. **Keep personal stores device-local and unsynchronized.** Do not add account recovery, device-to-device transfer, or cloud sync for private records without a new privacy review. This follows the current PRD's no-mandatory-account and no-personal-sync requirements.
2. **Use OS-backed key wrapping and fail closed.** When OS encryption is unavailable or the key cannot be opened, preserve existing ciphertext and report the problem. Never silently create a replacement key over existing encrypted records.
3. **Treat recovery as an explicit user-export path for now.** The app has no independent recovery secret. Losing the original OS keychain item can make the app's sealed files unreadable. A user can make a portable plaintext export; encrypted cross-device recovery is not implemented.
4. **Make backup exclusions opt-in and narrow.** Current behavior offers a macOS Time Machine exclusion for selected app-data paths. It is not an all-backup guarantee and does not erase existing backups or local snapshots.
5. **Keep implicit footprints separate from explicit saves.** Private browsing disables automatic visit/interest-footprint writes. A deliberate Pin or Absorb command is a separate user action; the UI should say clearly when such a command persists data from a private tab. This distinction is consistent with MEM-001 and ABS-001, but PRD §8.1's broad wording about private sessions and knowledge writes should be clarified before marking the gate verified.
6. **Do not describe “Delete” as secure erasure.** Filesystem unlink, Finder Trash, APFS snapshots, Time Machine history, SSD remapping, and existing exports are outside a secure-erasure guarantee.

## Current storage and key lifecycle

| Data | Current location and protection | Key / lifecycle behavior |
| --- | --- | --- |
| Bookmarks, collections, recent pages, legacy absorbed excerpts | `private-library.v1.seal` in Electron `userData`; the complete JSON payload is sealed with Electron `safeStorage`. Legacy localStorage copies are imported before removal. | macOS Keychain-backed wrapping; load preserves ciphertext on decrypt failure. When Electron requests re-encryption, load rewrites through a temporary file and atomic rename. No standalone recovery key exists. |
| Knowledge index, source metadata, paragraphs | `knowledge/index.bin` plus one `kn-….bin` per absorbed page, each AES-256-GCM sealed. | A random 32-byte key is wrapped in `knowledge/key.seal` with `safeStorage`. Each seal uses a fresh 12-byte IV and 16-byte GCM tag. The exact vocabulary/model files are separately hash-checked before worker handoff. Keychain re-encryption is propagated and rewritten atomically. If the key file is missing while knowledge or Laya vector files remain, startup now fails closed instead of minting a new key. |
| Laya vectors and chunks | Sealed per-document `.vec` files under `userData/laya/vectors`; AES-256-GCM uses the same local knowledge key. | Removing knowledge schedules vector removal; clearing all knowledge clears the vector store. Model files are optional and downloaded only when Laya is enabled. Disabling Laya can retain the model; the user can request model deletion. |
| New captures | Ordinary PNG/WebM files in `~/Pictures/Intoponet/<group>/`, readable by Finder. They are not app-encrypted; the runbook states they rely on FileVault. | Deletion moves captures to Trash. These files are not in the current `backupPaths` list used by the Time Machine switch. |
| Private browsing session | Electron partition `intoponet-private` has no `persist:` prefix, so it is an in-memory session. | Turning private browsing off closes private tabs, clears that session's storage/cache, and clears in-memory private permissions. Automatic visit/restore writes check the private view. Explicit user save operations are separate and remain available. |
| Personal field activity and privacy preferences | The personal field is held in renderer memory for the session. Footprint/privacy preferences are renderer localStorage values, not page content. | Personal activity clears when the app session ends; “Delete footprints now” clears recents and current personal activity. |

Electron documents that `safeStorage` is platform-specific: macOS uses Keychain, Windows uses DPAPI, and Linux uses an environment-dependent secret store or fallback. The app currently refuses knowledge-key creation when `isAsyncEncryptionAvailable()` is false. macOS code signing is needed for consistent Keychain identity across app updates; the unsigned preview package is not evidence of stable key continuity.

## Retention, inspect, export, and delete

- **Footprints:** users can retain recent pages for 7, 30, 90 days, or until manually deleted. “Until I delete them” is the default. Pruning runs on app start, library restore, and hourly. The PRD describes interest signals too; the personal field currently exists in memory only.
- **Saved pages and collections:** users can inspect, edit, organize, export, and delete them. They are not age-pruned.
- **Absorbed knowledge:** users can list/open/edit/reindex/remove individual records, remove all records, and export JSON-LD including stored paragraphs and citations. It has no age-based retention setting.
- **Laya:** vectors are derived from absorbed text and are stored encrypted. Individual source removal is reflected in the vector store asynchronously; deleting all knowledge triggers a vector clear. Laya has no separate age-retention setting. The downloaded model has its own “keep or delete model when disabling” option.
- **Portable export:** the library export is a plaintext JSON file in Downloads; absorbed knowledge is a separate plaintext JSON-LD export with its source text. Embeddings and model weights are not exported. Import merges library records. There is no password-protected export format.
- **Delete library:** the UI deletes the sealed library, moves captures to Trash, removes knowledge, and clears the knowledge list. These operations span different stores and are not one atomic transaction. If a later step fails, earlier stores may already have changed; the UI now reports that deletion may be partial and asks the user to check the library and retry.
- **Key handling:** deleting all knowledge leaves `knowledge/key.seal` in place. This is not crypto-erasure: no data remains in normal records, but the wrapping key is retained for future knowledge writes. Files already in Trash, exports, backups, or snapshots are unaffected.

## Backup behavior and limits

The privacy command persists the user's exclusion request and uses unprivileged sticky exclusions (`tmutil addexclusion`) for existing members of four named targets: `private-library.v1.seal`, `userData/knowledge`, `userData/laya`, and `userData/personal`. Fixed-path exclusions (`-p`) are deliberately not used because the installed `tmutil` manual requires root and Full Disk Access for that mode. On startup and when one of the exact top-level paths is created or replaced, the app reapplies the request to paths that exist. This is best-effort: a watcher may miss an event, an atomic replacement may briefly create a new file without the old file's exclusion metadata, or `tmutil` may fail. If an enabled request cannot be verified across all four existing targets, the UI keeps the switch checked and reports partial/unavailable status rather than claiming success. Disabling removes legacy sticky exclusions for existing paths and verifies the result. The captured files under `~/Pictures/Intoponet` are not included. The control only concerns Time Machine; it does not manage other backup/cloud products.

Apple notes that items excluded from Time Machine backups can still appear in local snapshots. An exclusion therefore does not retroactively remove prior backups or guarantee that no local snapshot contains the data. The status should be described as a best-effort current path exclusion, not as “private data is not backed up.”

When backup exclusion is enabled, the UI says Time Machine will skip the four named private-store paths during future backups. When exclusion is off, these paths are included in future Time Machine backups with other Mac data. Neither state removes prior backups or guarantees absence from local snapshots. A usable restore still depends on the corresponding OS keychain material being available to the restored app/user. No restore drill is part of current evidence.

## Offline behavior

The local library and absorbed knowledge read from local files. Laya does not download a model during search; model download is an explicit enable action, and the installed model, vectors, and inference are local. Bookmarks, saved data, and locally absorbed pages remain available without a network. Remote websites, public field/news refresh, and first-time model download need connectivity. No personal-data sync is implemented.

## Evidence and remaining acceptance gaps

Existing automated tests cover `safeStorage` read/re-encryption error handling through injected adapters, AES-GCM store operations, knowledge export/remove, Laya vector/model lifecycle, retention parsing/pruning, and private-tab/footprint behavior. The 2026-10-29 integration run passed the full workspace tests, but that is not a Time Machine restore, OS keychain recovery, or backup-exclusion drill. No user library was opened for this audit.

This audit adds temporary-directory regression tests for two data-loss cases: a malformed but authenticated knowledge index must fail closed rather than being treated as empty before a later write; and a missing key must not be silently replaced while encrypted records exist. It also adds a test for safeStorage key rotation. These checks do not validate a real OS Keychain, Time Machine, filesystem snapshot, or restore.

Open product/security decisions before verification:

1. Clarify §8.1's private-tab knowledge wording against the separate explicit Absorb action. Explicit user-requested Absorb remains available; decide whether the interface needs additional persistence disclosure for saves made from a private tab.
2. Decide whether capture files belong in the backup exclusion switch. They remain outside its current four-path scope.
3. Decide whether Laya and absorbed knowledge need age-based retention in addition to source-linked/manual deletion.
4. Define whether portable exports stay intentionally plaintext or gain an optional password-encrypted format.
5. Specify a restore/Keychain-loss flow and test it with a signed packaged macOS app. Decide whether recovery means restore the same Mac account/keychain or restore a separately-held user export.
6. Make deletion feedback honest about partial completion and define whether Trash/backups/snapshots are in scope for any deletion promise.

## References

- [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage): platform key providers, asynchronous APIs, availability, and `shouldReEncrypt` behavior.
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing): macOS Keychain-backed APIs such as `safeStorage` depend on a consistent app signature.
- [Apple: Exclude files from a Time Machine backup](https://support.apple.com/en-au/guide/mac-help/-mh15622/mac): how users manage excluded items; excluded items still appear in local snapshots.
- [Apple: Time Machine settings](https://support.apple.com/en-ie/guide/mac-help/mh14037/27/mac/27): backup destinations and exclusion controls.
