# The Olds: live audit, 16 November 2026 (round 5, area B)

Build audited: `73c5d0a` (0.1.25), fresh profile, Laya off. Sample taken with `sample.mjs` (this directory) from the
app's own digest: 12 World stories, 14 local English, 14 local non-English, 4 more World (44 headlines, 30 countries'
outlets, 13 languages). Full threads: `sample1.json`. Mechanical check of every dated event against its Wikipedia
source (`verify.mjs`): `verify1.json`, `verify1.log`. Wrong topics re-run with candidate scores: `wrong-scores.jsonl`.
Coverage and debate: `coverage-debate.json`. Labelled-set baseline: `gold-base.json` (74/86).

## Topic (44 headlines)

C = the headline's subject; F = says it has nothing specific ("Geographic fallback …"); A = arguable; W = confident wrong topic.

| # | Headline (outlet country, language) | Shown | Verdict |
|---|---|---|---|
| 1 | Asesinan a un periodista que denunciaba casos relacionados con el narcotráfico en Costa Rica (CR, es) | Journalists of La Nación v. Costa Rica (a 2022 court case) | W |
| 2 | Paraguay: ordenan el traslado de Santiago Peña a una cárcel militar tras crisis de Ueno Bank (PA, es) | 2026 Paraguay banking crisis | C |
| 3 | Li Qiang pledges deeper AI and trade cooperation with Asean at Manila summit (PH) | Li Qiang | C |
| 4 | Trump floats Kim meeting in China, says he'll discuss Ukraine with Xi and Putin (US) | 2026 state visit by Donald Trump to China | C |
| 5 | Haiti's former first lady Martine Moïse enters presidential race (SV) | Martine Moïse | C |
| 6 | Robert Pattinson may look the part of James Bond… (PH) | Robert Pattinson | C |
| 7 | U.S. moves to curb China's remote access to Nvidia's AI chips (BR) | United States (fallback) | F |
| 8 | United Airlines says 'widespread' system outage resolved (US) | United Airlines fleet (one event, 1965) | W |
| 9 | Falha técnica afeta serviços de grandes bancos dos Estados Unidos (BO, pt) | United States Secret Service | W |
| 10 | Italy joins UK, Australia, Canada in appeal to Israel to allow aid to get to Gaza (MU) | Gaza genocide | A |
| 11 | Lindsay Clancy to face March retrial in deaths of her 3 children (US) | Killing of the Clancy children | C |
| 12 | Informe desde Lima: multitudinaria misa de León XIV marca su despedida de Perú (BO, es) | Lima (fallback) | F |
| 13 | Frederick Ledoux appointed Acting Treasurer (AS) | American Samoa (fallback) | F |
| 14 | Australian-funded fence and landslip works handed over at Gizo prison (SB) | Crime in Australia | W |
| 15 | Central business chambers divided on SOs for their regions (TT) | SOS incident (Japan, 1989) | W |
| 16 | RUTA MAVE: No one is above the law – and no system is invincible (CK) | Above the Law (group), a hip hop group | W |
| 17 | LA28 sets tough standards (BW) | Botswana (fallback) | F |
| 18 | Prices of essential commodities in Malé rise 9.96% in October (MV) | Malé (fallback) | F |
| 19 | Appointments made to Sargasso Sea Commission (BM) | Sargasso Sea | C |
| 20 | Namport eases Ohangwena classroom deficit with N$1.38m (NA) | Namibia (fallback) | F |
| 21 | World Bank weighs suspension of budget support to Somalia (SO) | West Bank | W |
| 22 | Tenth Amendment challenge delayed, new voices invited (LS) | Lesotho (fallback) | F |
| 23 | VACANCY ANNOUNCEMENT: Human Resources and Development Manager – ECCA (DM) | Human resource management | W |
| 24 | Singapore's non-oil exports surge 79.8% in October… (SG) | Energy in Singapore | W |
| 25 | 39 public officers complete Advanced Certificate in Secretarial Studies (BZ) | Belize (fallback) | F |
| 26 | Japanese energy giant Tokyo gas joins Dodai's $16M series A as Ethiopia's EV market surges (ET) | Tokyo | W |
| 27 | На Камчатке ежегодная добыча бурых медведей… (RU, ru) | Kamchatka Peninsula ("may be off") | C |
| 28 | Conférence épiscopale Burkina-Niger : … (BF, fr) | Niger River ("may be off") | W |
| 29 | ロシア機と推定の航空機が領空侵犯 福岡 沖ノ島周辺 (JP, ja) | Japan (fallback) | F |
| 30 | 高雄前鎮SPA會館暗藏春色… (TW, zh) | Taiwan (fallback) | F |
| 31 | Sindicato entrega pré-aviso de greve … guardas prisionais (CV, pt) | Crime in Cape Verde | W |
| 32 | Kostenbefreiung für chronisch kranke Menschen nicht ersatzlos streichen (LI, de) | Menschen für Menschen, an Austrian charity ("may be off") | W |
| 33 | «Cuánta añoranza»: Cubanos recuerdan parque infantil de La Habana (CU, es) | Havana (fallback) | F |
| 34 | Abschiebezentrum geplant: Was steckt hinter den Ruanda-Plänen? (DE, de) | Germany (fallback) | F |
| 35 | Côte d'Ivoire-AIP/ Tanoh Tanoh Joël élu président des jeunes de Mélékoukro (CI, fr) | Ivory Coast (fallback) | F |
| 36 | Višja udeležba, slaba zastopanost žensk … Kaj prinaša drugi krog? (SI, sl) | Slovenia (fallback) | F |
| 37 | VIDEO/ Qori: Unë do të jem kandidati … për Bashkinë e Tiranës (AL, sq) | Mayor of Tirana ("may be off") | C |
| 38 | إيران أمام عقوبات أوروبية.. و«البنتاغون» يعزز قواته… (YE, ar) | Yemen (fallback; the story is about Iran) | F |
| 39 | Jogadores do Anadia anunciam greve aos treinos por salários em atraso (PT, pt) | Portugal (fallback) | F |
| 40 | Flash info : … l'ancien Premier ministre Nicolas Tiangaye … est décédé (CF, fr) | Prime Minister of France ("may be off") | W |
| 41 | Gérard Depardieu drops appeal against sexual assault conviction (BA) | Gérard Depardieu | C |
| 42 | Informe desde Bruselas: cinco países europeos planean crear centro de deportación en Ruanda (MX, es) | Brussels (fallback; a dateline) | F |
| 43 | Five EU countries announce migrant deportation centre in Rwanda (GH) | European Union | C |
| 44 | UEFA backs France's Diallo to stand against Infantino in FIFA election (RE) | Abdou Diallo, a footballer (it is Philippe Diallo) | W |

Totals: C 11, F 17, A 1, W 15. Right subject, or says it has nothing: 28 of 44 (64 %). Confidently wrong: 15 of 44 (34 %).

## Dates, order, links, quotes (325 dated events in the 44 threads)

- Order: 44 of 44 threads in time order.
- Dates: 2 plainly wrong (#35 "13 March – France returns a talking drum looted in 1916…" shown at 1916, it is
  13 March 2026; #43 "In 1920 John Maynard Keynes proposed … who would later found in June 1947 …" shown at June 1947).
  17 more cards carried later-dated list items under the first item's date (year pages: #29 x2, #30 x3, #34 x4,
  #35 x3, #36 x2, #38, #39 x2), five of them lists of deaths shown as events (plus one single death, #34).
  7 imprecise but not wrong: a span shown at its first year (#14 x6), a report's date for the thing reported (#3).
  Right date as the source states it: 306 of 325 (94 %), counting the bundled cards as wrong.
- Quotes: 321 of 325 found word for word in the source. 4 mangled: #27 ×2 "a shallow depth of occurred" ({{convert}}
  dropped), #44 ×2 cut at "S.V." and "1." Two more are in the source but are not sentences: #10 "October 2023 to
  July 2024] are consistent with the characteristics of genocide."" and #40 with a file caption run in.
- Source links: 325 of 325 open the article; 295 of 297 section anchors exist (2 broken, #43:
  "#…Paris_Treaty_(19481957)", the heading uses an en-dash template).
- "Recent": the 7 Current-events entries are all within 45 days and carry their day page's date; the fallback
  "latest from 2026 in X" lists are from this year.

## Competing views (12 articles asked; 3 returned views; 17 cards)

12 of 17 attributed to someone who holds the view. 5 wrong, all for the Russian Revolution: "Marxist",
"Totalitarian", "Revisionist", "Russian Civil War", "Soviet Union" (see `coverage-debate.json`). Nine articles with
well-known debates returned none (French Revolution, Great Depression, Cold War …): nothing wrong shown, nothing shown.

## An outlet's earlier coverage (10 live headlines, 6 outlets, 14 pages, 103 items)

- The outlet's own: 103 of 103. Newest first: 14 of 14 pages. Wayback Machine credited: every page; every item's
  archive link well formed.
- The story itself listed as its own earlier coverage: 1 (DW, slug spelled two ways).
- On that story: 31 of 103 flagged "this story"; of the 71 I read, about 41 are on the story or its direct thread and
  30 are only on the wider topic page (China, Austria, United States, States of Guernsey, DRC): for example
  "Eurovision to bar countries at war from hosting" under an EU deportation-centre story (Al Jazeera's Austria page).
  The panel says which topic pages it reads; with fewer than four "this story" items it shows all of them.

## After the fixes (same headlines, fixed build)

See `wrong-queries2.log`, `sample2.json`, `gold-fixed.json` and the report.

## Topics behind the story (28 related topics on 14 of the 44 threads; 51 quoted figure sentences)

- Quoted figures: 51 of 51 sentences are in the article they are attributed to (`verify-figures.mjs`).
- On the story's subject: 11 of 28 by my reading. Off: Opioid epidemic (#1, drug trafficking), Taxation in the
  Philippines (#3), Judiciary of Italy and Law of Italy (#10, an "appeal" for aid), Mass media in Peru (#12, "Informe"),
  Punishment in Australia (#14, a prison in Solomon Islands), Healthcare in Singapore (#24, pharmaceutical exports),
  Belize Police Department (#25, "public officers"), Mining in Ethiopia (#26), Economy and Taxation of Portugal (#39,
  footballers' unpaid wages), three Bosnia and Herzegovina topics (#41, Depardieu, taken from the outlet's country),
  Politics, Elections and Government of France (#44, a FIFA election).

## Not checked

The path back ("part of", "follows"), the chapter a story is placed in, and the dates on Wikidata nodes in the
Timeline and List views were not checked item by item; only the dated events ("How we got here") were.

## After the fixes

- The 15 wrong topics, same headlines on the final build (`wrong-queries3.log`): 9 now show the right place or say they
  have nothing (#1, #14, #15, #16, #21, #24, #28, #40, #44 → FIFA). Still wrong: #8 United Airlines fleet, #23 Human
  resource management, #26 Tokyo, #31 Crime in Cape Verde, #32 Menschen für Menschen; #9 varies with whether the
  Portuguese model is installed (2026 Microsoft outage untranslated; a sports-leagues article in one translated run).
- Labelled set (`gold-base.json`, `gold-fixed.json`, `gold-only.json`): 74 of the original 86 before, 75 after, 76 with the
  Pezeshkian flip fixed and re-run; 9 or 10 of the 10 added cases pass depending on #9.
- Second live sample on the fixed build (`sample2.json`, 40 headlines, 337 events, `verify2.json`): topic right or
  honest fallback 34 of 40, arguable 2, wrong 4 (2018 DRC general election for the Francophonie vote; United Airlines
  fleet; Republican Party efforts to disrupt the 2024 election for an Nvidia story; Allied-occupied Germany for a
  Catalan "ocupació"). Order 40 of 40. Dates: 1 wrong ("In 2000 Mules, Dinesh D'Souza accused…" at 2000: a film title),
  no bundled list items, no cut sentences. Quotes 335 of 337 found (2 not settled). Anchors 315 of 317 (one
  fifth-level heading, since fixed; one not settled). 2 of 40 threads marked incomplete.
- "Try again" seen in the running app once, with the screen locked (`retry-probe.log`, `evidence/`): with name
  lookups failing in the main process the thread came back marked incomplete with the button; pressing it from the
  keyboard showed the spinner and then the same thread without the note. The topic in both was wrong (Population
  ageing, for "North Atlantic right whale population declines as U.S. weakens protections"), so it is one more wrong
  topic, not an effect of the failure. The red error state with its button was not seen live.
