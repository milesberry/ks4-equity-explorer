#!/usr/bin/env python3
"""Assemble the standalone website in docs/ (served by GitHub Pages).

It reuses dashboard/index.html, app.css and app.js unchanged, adds the runtime shim
and host styles from dashboard/standalone/, and copies the processed CSVs.
"""
import hashlib
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DASH = ROOT / "dashboard"
DOCS = ROOT / "docs"
D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"

FOOT = """<p class="site-foot">Contains public sector information from the Department for Education
(<a href="https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance">Key stage 4 performance</a>)
Ofsted and the Office for National Statistics (boundaries; contains OS data © Crown copyright and database right 2025),
licensed under the Open Government Licence v3.0.
Code and processed data: <a href="{repo}">{repo}</a>.</p>"""


def stamp(*paths):
    """Short fingerprint of some files' contents, used as ?v= on their URLs.

    GitHub Pages lets browsers keep a file for ten minutes, and browsers often keep
    scripts longer. A changed file gets a new address, so nobody runs an old script
    against a new page.
    """
    h = hashlib.sha1()
    for path in paths:
        h.update(pathlib.Path(path).read_bytes())
    return h.hexdigest()[:10]


def main(repo="https://github.com/milesberry/ks4-equity-explorer"):
    (DOCS / "data").mkdir(parents=True, exist_ok=True)
    body = (DASH / "index.html").read_text()
    # The dashboard runtime loads these itself; the standalone page links them in <head>.
    body = re.sub(r'<meta name="dash-one-writer">\s*|<link rel="stylesheet" href="app.css">\s*|<script src="app.js"></script>\s*', "", body)
    processed = sorted((ROOT / "data" / "processed").glob("*.*"))
    v = {
        "host.css": stamp(DASH / "standalone" / "host.css"),
        "app.css": stamp(DASH / "app.css"),
        "shim.js": stamp(DASH / "standalone" / "shim.js"),
        "app.js": stamp(DASH / "app.js"),
        "data": stamp(*processed),
    }
    page = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KS4 Equity Explorer</title>
<meta name="description" content="Attainment 8 gaps and subject offer, uptake and grades in England's secondary schools, from DfE Key Stage 4 performance data.">
<link rel="stylesheet" href="host.css?v={v["host.css"]}">
<link rel="stylesheet" href="app.css?v={v["app.css"]}">
</head>
<body>
<div id="dash-root">
{body.strip()}
{FOOT.format(repo=repo)}
</div>
<script src="{D3}"></script>
<script>window.KX_DATA_VERSION = "{v["data"]}";</script>
<script src="shim.js?v={v["shim.js"]}"></script>
<script src="app.js?v={v["app.js"]}"></script>
</body>
</html>
"""
    (DOCS / "index.html").write_text(page)
    (DOCS / ".nojekyll").write_text("")
    for name in ["app.css", "app.js"]:
        shutil.copy(DASH / name, DOCS / name)
    for name in ["shim.js", "host.css"]:
        shutil.copy(DASH / "standalone" / name, DOCS / name)
    for data in processed:
        shutil.copy(data, DOCS / "data" / data.name)
    size = sum(f.stat().st_size for f in DOCS.rglob("*") if f.is_file())
    print(f"docs/ built: {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
