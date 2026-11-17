# Hardening round 5 (16–17 November 2026)

Base `73c5d0a` (0.1.25). Seven agents, one area each, merged on main. Not released.

## State of the evidence

- Typecheck, unit tests (desktop 1,575 passed; every workspace green) and the production build pass on merged main.
- **The full end-to-end suite has not run on merged main.** The Mac's screen locked at about 22:58 on 16 November, which hides every page view; agents' end-to-end results were taken that way. `docs/FEATURE_VERIFICATION.md` is therefore still the 8 November run.
- With the screen still locked, 25 checks that work with hidden pages were run on merged main: 24 passed and TOUR failed once (its check set a cookie before the tour's page had loaded), then passed three times, the last with the check waiting for the page.
- Never passed anywhere yet: the F6 step in PERMISSIONS, the new COPY_ADDRESS steps.

## Measured on merged main

- **News digest** (the app's own, generated 05:41 UTC 17 Nov, 2,963 of 3,252 feeds answering): World's 20 stories read by hand: none listed twice, no story made only of a country's or a phrase's name; 3 mix in headlines from another story (an Iran story with a student-visa ruling; a Pedro Sánchez cluster; two men named Miguel Ángel). Peaks' top 40: about 4 are not real stories (`{trump, united-states}`, `{america, latina}`, `{dolly, parton}`, an East Potomac golf story under "Middle East") and the US bank outage and the Grammy nominations each stand twice. Same news cycle as the agent's captures, a few hours later: not a different day.
- **The Olds, labelled set** (`experiments/e2e/olds-eval.mjs`, Laya off): 83 of 96 topics acceptable. Before the round: 74 of the original 86.
- **GLOBE_LIVE:** main process busy 3% of the time while news arrived (bound 12%); **COMMAND_MENU:** ⌘K in 13 ms at p95, timed in the app.

## Audits by the agents (their numbers)

- **The Olds on 0.1.25, 44 live headlines:** topic right or honestly empty 28; dates right 306 of 325; quotes word for word 321 of 325; all 325 source links open their article. Full verdicts: `olds-audit-2026-11-16.md`.
- **News on 0.1.25, two captures:** 8–9 of World's 20 stories were false merges; 2 after the fixes on a rebuild of the same capture.
- **Privacy:** 10,579 requests recorded across launch, World, The Olds, typing, ⌘K, translation, Absorb, Laya, Tidy, a private tab and the tour; no planted marker reached any host; nothing from a private tab on disk. Not recorded: browser import, the quick window, link previews, capture, a live update check.
- **Startup, main thread, 75 s after launch (median):** CPU 9.9 s → 2.9 s cold and 10.4 s → 1.1 s warm; longest stall on a warm launch 866 ms → 136 ms. Window-side frame times were measured with the screen locked and are not evidence.
- **Upgrades:** profiles from 0.1.23 and 0.1.24 opened in this build and went back unchanged (no saved password, archived tab, collection or pin in the test state).

## Known not true as worded

- "Ads and trackers are blocked on every page": the engine blocks 32 hard-coded hosts; 13 of 20 well-known ad and tracker endpoints were allowed. The PROTECTION check asserts only a blocked count above zero.
