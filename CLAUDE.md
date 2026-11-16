# KS4 Equity Explorer

Dashboard of DfE Key Stage 4 performance data: Attainment 8 gaps between pupil groups
(sex, disadvantage/pupil premium, EAL, SEND) and, per subject (Computer Science first),
offer / uptake / attainment. Published at https://claude.ai/artifact/QB3ro7cJfrFREACgzpdHcw

## Where to pick up

First version published 2026-11-16 and confirmed working by the user. Not yet built, in
rough order of the user's interest:

1. Location views: local authority and parliamentary constituency (LA rows are already
   in `area_groups.csv`; postcode and constituency are in `schools.csv`).
2. The notebook's models: logit for offer, OLS for uptake and average grade against
   % disadvantaged, % EAL, % SEN and % girls (no KS2 score this year).
3. School-level trends across 2023/24 to 2025/26 (performance file only).
4. Refresh when DfE publishes revised data (provisional now; revised usually early in
   the new year): rerun fetch and build, then follow "Publishing" below.

The user's first message was cut off at "We're interested", so ask what else they want.
Their original hand-built analysis is `~/Documents/Notebooks/2025-26/computing 25.ipynb`.

## Layout

- `scripts/fetch_data.py` downloads raw files to `data/raw/` (large, ~800 MB unzipped).
- `scripts/build_data.py` turns them into four tables in `data/processed/`.
- `dashboard/index.html`, `app.css`, `app.js` are the page. `scripts/pack_dashboard.py`
  wraps them as JSON documents in `build/store/files/` for publishing.
- `dashboard/dev/harness.html` is a local stand-in for the dashboard runtime. Start the
  `dashboard-dev` server (.claude/launch.json, port 8765) and open
  `http://localhost:8765/dashboard/dev/harness.html`. A hash-only URL change does not
  reload the page; reload explicitly.
- Run Python with `python3 -P` (plain `-I` hides pandas' dependencies on this machine).

## Publishing (Claude "Data" dashboard artifact type)

The artifact is a typed dashboard: content lives in its store, not in published files.
Read the type's own instructions first (`Artifact` read of the URL) before changing it.

1. Page change: edit `dashboard/*`, test in the harness, run `scripts/pack_dashboard.py`,
   then `ArtifactData` `set` each of `files/index.html`, `files/app.css`, `files/app.js`
   from `build/store/files/<name>.json` (needs `if_version` from a prior read).
2. Data change: rerun the build, upload each changed CSV with `Artifact` (`asset: true`,
   `url`, `file_path`), then `update` the matching `datasets/<id>` document's `source.url`
   and `updated.at`. Dataset ids: `schools`, `subject_entries`, `area_groups`,
   `national_subjects`.
3. Afterwards read `data/users/me` docs `check` and `runs` to see whether the page ran.

Page rules that bite: scripts get only `d3` v7 and `dash` (no other libraries, no
network); static words stay in the HTML and scripts only fill `data-draw` elements;
all CSS is scoped under `.kx`; colours come from host tokens and `dash.colors`; each
store document is capped at 256 KB. Filters are `dash/params` values that no query
uses (`cmp`, `stype`, `subject`, `band`, `sx`, `sy`), so changing one just redraws.

## Publishing to GitHub Pages

Public repo https://github.com/milesberry/ks4-equity-explorer, live at
https://milesberry.github.io/ks4-equity-explorer/ (Pages serves `docs/` on `main`).
`scripts/build_site.py` assembles `docs/` from the same `dashboard/` files plus
`dashboard/standalone/shim.js` (a stand-in for `dash`) and `host.css` (the host's
tokens). After any page or data change run it, commit and push. `docs/` is generated:
edit `dashboard/`, never `docs/`. Keep the Claude artifact and the Pages site in step.
Anything `app.js` newly uses from `dash` must also be added to the shim.

## Data facts (2025/26 release, published October 2026)

- DfE API base `https://api.education.gov.uk/statistics/v1`; publication id
  `c8756008-ed50-4632-9b96-01b5ca002a43`. `/data-sets/{id}/csv` returns gzip.
  "Institution information" is not in the API; it comes from the data catalogue.
- Files are long format with `breakdown_topic` / `breakdown` rows per school, not the
  old wide `england_ks4*.xlsx` columns (PTFSM6CLA1A, KS2ASS etc. no longer exist).
- Suppression: `z` not applicable, `c` suppressed, `x`/`u` unavailable. All become blank.
- School-level breakdowns available: Total, Boys, Girls, Disadvantaged, Not known to be
  disadvantaged, EAL ("other than English"), Non mobile. There is no English-first-
  language row (derived as total minus EAL) and **no SEND attainment at school level**
  (only the school's % SEN from institution information). SEND gaps are
  national/regional/LA only.
- No Progress 8 and no KS2 prior attainment for this cohort (all `z`): their KS2 tests
  were cancelled in 2020.
- School-level subject file has entries by grade but no pupil characteristics, so
  subject x characteristic at school level means grouping schools by their context.
  Pupil-level subject x characteristic exists nationally only.
- Subject file covers one year (2025/26); performance and info cover 2023/24 on;
  national files go back to 2018/19 (2019/20 and 2020/21 were CAG/TAG years).
- Average grade = sum(grade x n) / graded entries, U = 0, X (no result) excluded.
  Combined Science double award uses the mean of its two grades. Vocational awards have
  no 9-1 grade: `n4` = level 2 pass or better, `n7` = level 2 distinction or better.
- Uptake = undiscounted entries / end-of-KS4 pupils. Offer = at least one entry.
- School type: "State mainstream" (3,298 schools), "Special", "Independent",
  "FE college". Independent schools' Attainment 8 is not comparable (IGCSEs don't count).
- Region comes from LA code via the national file; IDACI quintile (1 = least deprived)
  and last OEIF Ofsted grade come from Ofsted MI, state schools only. Postcode and
  parliamentary constituency are kept in `schools.csv` for later location work.
