#!/usr/bin/env python3
"""Wrap the dashboard's page files as store documents for the Claude "Data" artifact.

Each file in dashboard/ becomes build/store/files/<name>.json = {"text": ..., "edit": {...}},
which is what the artifact's store expects under files/<name>. Write them with the
ArtifactData tool (file_path = the JSON, collection "files", doc_id = the file name).
"""
import datetime
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "store" / "files"
OUT.mkdir(parents=True, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
for name in ["index.html", "app.css", "app.js"]:
    text = (ROOT / "dashboard" / name).read_text()
    assert len(text.encode()) < 250_000, f"{name} is over the 256 KB document limit"
    (OUT / f"{name}.json").write_text(json.dumps({"text": text, "edit": {"via": "claude", "at": now}}))
    print(name, len(text.encode()), "bytes")
print(now)
