# KS4 Equity Explorer

An interactive view of the Department for Education's Key Stage 4 performance data for
England, summer 2026 (provisional).

**Live site: https://milesberry.net/ks4-equity-explorer/**

- **Attainment 8 gaps** between girls and boys, disadvantaged and other pupils, EAL and
  English-first-language pupils, and pupils with and without SEND: nationally, over
  time, by region and school by school.
- **Subjects** (Computer Science by default, any GCSE or vocational subject): which
  schools offer it, what share of pupils take it and the grades they get, by pupil group
  nationally and by school characteristics.
- **Find a school** by name, local authority or postcode.

## Rebuilding

```bash
python3 scripts/fetch_data.py   # downloads ~800 MB of raw files to data/raw/ (not in the repo)
python3 scripts/build_data.py   # writes the four tables in data/processed/
python3 scripts/build_site.py   # assembles the website in docs/
```

Needs Python 3 with pandas and numpy. Commit and push `docs/` to update the live site.

## Sources

- DfE, [Key stage 4 performance](https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance),
  via the [explore education statistics API](https://api.education.gov.uk/statistics/docs/).
- Ofsted, state-funded schools inspections and outcomes: management information.

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Definitions and caveats are listed at the foot of the site and in `CLAUDE.md`.
