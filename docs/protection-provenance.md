# Where Intoponet's ad and tracker list came from: provenance note

Written 17 November 2026. It records what was in this repository that day, how the list the app
now uses was produced, and what has not been checked. It is a record of facts, not legal advice.

**The short version.** Intoponet's ad and tracker list and its matcher were independently written:
the list is Intoponet's own compilation and contains no third-party filter list. It is not
described as "clean-room" work, and should not be, because two third-party lists and a third-party
blocking library were in this repository for about two hours on the morning the replacement was
written. A clean room means the people and tools that wrote the replacement never had the
original; here they could have opened it. What the records support is "independently written" and
"Intoponet's own".

## What was in the repository, and when

All times are commit times on 17 November 2026, UTC−4. Commits are named by time and subject as
well as by hash. The hashes below are the ones the commits have had since 18 November 2026, when
the history was rewritten (see "The history was rewritten before the first push" below); the table
describes what each commit did when it was made.

| Time | Commit | What it did |
|---|---|---|
| 08:20:05 | `47c44a1` "EasyList and EasyPrivacy are in the repository as unmodified data files, with their source, date and checksum recorded" | Added `packages/protection-engine/lists/` (`easylist.txt`, `easyprivacy.txt`, `manifest.json`, `NOTICE.txt`) and `scripts/update-protection-lists.mjs`, which fetched the two lists as published. |
| 08:20:05 | `b13e50f` "Ads and trackers on other sites are blocked with EasyList and EasyPrivacy, in every page session" | Made the engine match requests against the two lists with the Ghostery adblocker library (`@ghostery/adblocker`, MPL-2.0), added as a dependency, and added a build step that compiled the two lists into a binary file the app read. (The removal commit names `tldts-experimental` as a dependency removed with it.) |
| 08:49:52 and 08:55:44 | `7ab634c`, `d54db80` | Changes to how blocked requests were counted and to how the library was built into the app. |
| 09:30:09 | `690acc6` "Website says what the ad and tracker blocking does and does not block; packaging requires the lists in the app" | The packaging script was made to require the list files. |
| 10:27:49 | `b2e6b42` "The ad and tracker blocker no longer uses EasyList, EasyPrivacy, the Ghostery library or tldts: Intoponet's own matcher and site table take their place" | Removed the `lists/` folder and its four files, the build step, `scripts/update-protection-lists.mjs`, and the two dependencies with everything they pulled in. Added `packages/protection-engine/src/site.ts` and rewrote the matcher. |
| 10:53:54 | `0792193` "Intoponet blocks with its own list of ad and tracker hosts: 421 services written out by hand, …" | Added `data/authored-services.json`, `data/never-block.json`, `data/blocklist.json`, the classifier and the crawler. |
| 11:46:11 | `7132e32` "The list now carries what Intoponet measured on 504 publishers' pages: …" | Added the measured and reviewed hosts. The list was frozen here for the hold-out check. |
| 12:19:03 and 12:40:49 | `e38d20a`, `2076c54` | Recorded the hold-out check; added services it showed missing, marked as added after it. |

So the two lists were in the working tree from 08:20 to 10:27, two hours and eight minutes, and
the first version of Intoponet's own list was committed 26 minutes after they were removed.

**Not pushed, not released.** On 17 November 2026 no remote branch and no tag contained the commit
that added the lists (`git branch -r --contains` and `git tag --contains` for that commit printed
nothing), and the published branch (`origin/main`, at the commit that published version 0.1.25 on
13 November 2026) is older than all of the commits above. `THIRD_PARTY_NOTICES.md` §4 says the
same: the build that used the lists "was not pushed or released". Whether a local build made in
those two hours was ever given to anyone is not something the repository can show; no record says
one was.

**The history was rewritten before the first push.** On 18 November 2026, at the owner's
instruction and before any of these commits had been pushed, the 100 commits made since version
0.1.25 were rewritten so that the folder `packages/protection-engine/lists/` (the two list files,
`manifest.json` and `NOTICE.txt`) is in none of them. Nothing else was changed: the files at the
tip of the branch were identical before and after, and every commit kept its message, author and
date. A compiled copy of the lists was never committed (it was build output). So the commit in the
first row of the table now adds only the script that fetched the lists, and its subject line
describes what it did when it was made, not what it holds now; the same goes for the row that
removes the folder. The commits' earlier hashes, in table order, were `74acae7`, `80bff91`,
`00ac8bd`, `6b0abb0`, `87ee920`, `696ff4a`, `8cba1e0`, `35eef6f`, `d7fe8a9` and `5fe68f4`. The
history as it was before the rewrite is kept by the owner outside this repository, as one backup
file made that day.

## Who and what could see the lists

Anyone and any tool working in the repository between 08:20 and 10:27 could open the two list files
and the library's code in `node_modules`. Every commit in the table has the same author and names
an AI coding assistant as co-author in its trailer, both the commits that added the lists and the
commits that wrote the replacement. The repository does not record which person or which assistant
session wrote which file, or what any of them had read. That is the reason for the wording at the
top: access existed, so the claim made is independent writing, not a clean room.

## How the replacement was produced

This section repeats what `docs/protection-measurement.md`, the files' own headers and the commit
messages record. It adds nothing to them.

- **The matcher** (`packages/protection-engine/src/engine.ts`): "Written for Intoponet. Rules by
  host in a map; a request is looked up by its host and each domain above it"
  (`docs/protection-measurement.md`). The commit that introduced it says rules can be narrowed by
  path or request type and can have exceptions.
- **"Same site"** (`src/site.ts`): its header says the table "is Intoponet's own, written by hand
  from general knowledge of how country registries and hosting services hand out names. It is NOT
  the Public Suffix List and is not derived from it."
- **Authored services** (`data/authored-services.json`): its header says: "Written out by
  hand from general knowledge of the industry for this project, on 2026-11-17. It was not copied or
  derived from any filter list, hosts file or tracker database, and none was consulted while
  writing it."
- **The never-block list** (`data/never-block.json`): "written by hand for this project
  (2026-11-17) from general knowledge of what sites need to work, and checked against Intoponet's
  own measurement."
- **Measured hosts**: `scripts/protection-crawl.mjs` visited the home page and newest article of
  520 news outlets taken from the repository's own feed directory, with blocking off; 504
  publishers gave a usable page. `scripts/protection-classify.mjs` proposed hosts by the rules
  written out in `docs/protection-measurement.md`, and nothing proposed was listed until a person
  had looked at what the host did and written a decision in `data/reviewed.json`, whose header
  says "Nothing here was taken from a filter list or tracker database."
- **The list the app uses** (`data/blocklist.json`) is generated from those files. Every entry
  says which source it has and, when measured, at how many publishers it was seen and with which
  signals. Its header says it "is not copied or derived from any filter list, hosts file or tracker
  database."
- **A test keeps the removed material out.** `packages/protection-engine/src/blocklist.test.ts`
  fails if a reference to the removed lists, the library or its dependencies comes back in the
  source of the app, the packages or the build scripts, or in the dependency lock.

The raw records of the measurement are not in git (about 20 MB, per
`docs/protection-measurement.md`). The crawler, the rules, `reviewed.json`, and the evidence
carried by each list entry are.

## What has not been done

- **No overlap comparison has been made** between Intoponet's list and the two removed lists. The
  owner's instruction is that the removed files are not to be opened, so that nobody who works on
  the list reads them; this note was written under that instruction, from commit times, commit
  messages and file names only, and its author did not open them. Whether anyone else has opened
  them since their removal is not recorded. How much the two overlap has not been counted, and
  nothing is claimed here about what the removed lists contain. If a count is ever wanted, it
  should be made by someone who does not go on to edit the list, and from a copy of the original
  history kept outside the working repository.
- **The matcher has not been compared with the removed library** by anyone writing this note. The
  statements above are the project's own description of it.
- **No copy of the original history has been recorded here.** If the commits that held the lists
  are rewritten before the first push, keep a full copy of the repository as it was (for example
  `git bundle create <file> --all`), and add its location and SHA-256 to this note. The dated
  sequence above is evidence of when the lists left and when the replacement was written.
- **The raw measurement records** should be kept with that copy; this note does not record where
  they are.
- **No lawyer has reviewed** the wording used to describe the list, the question of overlap, or
  whether database rights in the removed lists matter. Those are open.

## Wording to use

Say: "independently written", "Intoponet's own list", "written by hand and checked against
Intoponet's own measurement", "no third-party filter list is included or used".

Do not say: "clean-room", or anything else that means the authors never had the earlier lists in
front of them.

As of this note, no file in the repository uses "clean-room" for the list (a search of the whole
tree found none).
