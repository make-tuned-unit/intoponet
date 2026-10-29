# Browser download destinations

Each `will-download` item gets a destination reserved with an exclusive
filesystem create (`O_CREAT | O_EXCL | O_NOFOLLOW`) under Electron's Downloads
directory. The path is reserved before `DownloadItem.setSavePath`, so concurrent
downloads with the same suggested name receive different names. Allocation
never opens an existing file or symlink.

Suggested names are normalized and constrained to one filename component:
slashes and backslashes become underscores; control and bidirectional-format
characters are removed; leading/trailing dots and spaces are stripped; UTF-8
names are limited to 180 bytes. Name collisions receive a numbered suffix, up
to 100 attempts, after which the download is cancelled and the app reports a
generic interrupted-download notice without exposing the filesystem error.

If path allocation or `setSavePath` fails, or a download is cancelled or
interrupted, cleanup removes only a zero-byte regular file whose device and
inode still match the reservation. Nonempty partial downloads are preserved.
If the exclusive create succeeds but the filesystem cannot provide an inode
identity even on a descriptor-stat retry, the implementation deliberately
preserves the unidentified zero-byte placeholder rather than risk deleting a
different file by pathname. This rare failure can leave an empty file behind.
The completion event reports the reserved actual filename and path; the
renderer notice uses the filename.

Verification:

- `apps/desktop/src/main/downloadReservation.test.ts` exercises real temporary
  directories, concurrent reservations, existing files, a dangling symlink,
  sanitizer edge cases, bounded collision exhaustion, owned-empty cleanup,
  and injected post-open `fstat`/`close` failures.
- `experiments/browser-policy/run.mjs` uses a temporary Electron profile and
  temporary downloads directory. On 2026-10-29, Electron 45 / Chromium
  156/macOS arm64 completed two simultaneous HTTP downloads with the same
  suggested filename. They were saved as `same-name.txt` and
  `same-name (1).txt`; both payloads matched. Evidence is recorded in
  `experiments/browser-policy/evidence/native-browser-2026-10-29.json`.

The native probe did not touch the user's Downloads directory and is not a
packaged-release test. This behavior has not been tested on other platforms.

Cleanup is a best-effort inode check followed by unlink, not an atomic conditional deletion. This does not defend against another local process replacing paths between operations or before Chromium writes the download. A failed close is not retried because its descriptor may already have been released and reused.
