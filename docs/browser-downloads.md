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

## Downloads manager (`src/main/downloadManager.ts`, `browsingData.ts`)

Every `will-download` on the normal and private page sessions is tracked: filename, origin (only
the origin reaches the shell), state, received/total bytes, smoothed speed, start/end time. Progress
reaches the shell at most four times a second (`intoponet:downloads-event`). The toolbar shows a
Downloads button once there is anything to list (with a progress ring while files are coming in);
its list offers pause/resume/cancel, open, Show in Finder, retry for failed downloads, remove from
list and clear finished. Path reservation above is unchanged.

Finished downloads from normal tabs are remembered in `userData/personal/downloads.v1.json`
(atomic writes, at most 200; `personal/` is covered by the Time Machine exclusion setting).
Private-tab downloads are listed only until private browsing ends or the app quits.

Safety:

- **Quarantine.** Electron does not run Chromium's quarantine step, so when a download completes the
  app checks `com.apple.quarantine` and, if it is missing, sets
  `0083;<hex seconds>;Intoponet;<UUID>` with `/usr/bin/xattr` (`src/main/quarantine.ts`). The
  `DOWNLOADS_HISTORY` feature check asserts the flag on a real download.
- **Dangerous types** (`.command .terminal .tool .app .pkg .mpkg .webloc .inetloc .fileloc .scpt
  .scptd .applescript .workflow .action .sh .bash .zsh .csh .ksh .jar`) are paused as soon as they
  start and the list opens asking "This type of file can harm your Mac" — Discard (the default,
  first button) or Keep. If the file finishes before the answer, Discard deletes it. Disk images
  (`.dmg`) only get a caution line. Zipped apps are not flagged.
- **Automatic downloads.** A page may start three downloads within ten seconds on its own; further
  ones are held and the list asks "This site wants to download multiple files" — Block or Allow
  (remembered for that tab until it closes). A download within five seconds of a click or key press
  in the page uses up that gesture and is not counted.

Set `INTOPONET_DOWNLOADS_DIR` to save downloads somewhere other than `~/Downloads` (the feature
checks point it at their temporary profile).
