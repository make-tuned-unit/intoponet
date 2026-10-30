# The Olds: live-headline testing — 30 October 2026

Two random samples of 20 live stories from the app's digest (`experiments/e2e/olds-sample.mjs`) were judged
by hand, failures were traced with `INTOPONET_OLDS_DEBUG`, and fixes were checked against the labelled set
(`experiments/e2e/olds-gold.json`) before and after.

## Failures found and fixed

| Headline | Was | Now | Cause |
| --- | --- | --- | --- |
| Traffic Control Errors Caused Spain’s Deadly Train Crash | Air traffic control | 2026 Toledo train collision | A current local event of the headline's kind ("collision" for "crash") failed the word-overlap check |
| 'Star Trek' star Patrick Stewart dies age 86 | Patrick Stewart on stage and screen | Patrick Stewart | People are penalised unless named at the headline's start; a full name mid-headline, or a death this year, now counts |
| Sputnik Africa interview with President Isaias | Hurricane Isaias (2026) | Isaias Afwerki | Office titles ("President Isaias") identify the holder; named storms need weather words |
| Novaya Gazeta says it will shut down | Kremlin pool | Novaya Gazeta | Newspapers were never topics; now allowed when the headline is about the paper itself |
| Ghana, Côte d’Ivoire maritime exercise | Air Côte d'Ivoire | Ivory Coast | Country names were removed only by their canonical name, not aliases ("Côte d’Ivoire") |
| Palestinian visa refusals may point to wrongful denials | 2027 Palestinian presidential election | Palestine | Event of a kind the headline never names; "Palestinian" was not recognised as a country |
| CPC Central Committee holds press conference on plenary session | Third plenary session of the 11th Central Committee (1978) | 20th Central Committee of the CCP | Old numbered editions the headline never names |

One regression introduced along the way (Mbappé's apology matched to Mao Zedong) was caught by the labelled
set and fixed: historical figures who died before this year are not treated as a headline's subject.

## Labelled set (`olds-eval.mjs`, fresh profile, Laya off, no translation models)

| | Before | After |
| --- | --- | --- |
| Original 78 stories | 66 | 68 |
| New live cases added (7) | — | 7 |

Remaining misses are mostly non-English headlines without a local translation model installed in the test
profile, plus one case that varies with live search results (Cayman Youth Olympics). Untranslated matches
are labelled as possibly off in the app.

## Update path verified

The signed 0.1.0 app, launched as a user would (LaunchServices), checked the live feed, downloaded 0.1.1
(`update-downloaded` after ~6 s), and on Restart to install ShipIt reported "Installation completed
successfully"; the bundle on disk became 0.1.1, signature valid and accepted by Gatekeeper. Earlier stalls
in testing came from launching the app as a child of a sandboxed shell and from leftover test instances
holding the bundle open, not from the app.
