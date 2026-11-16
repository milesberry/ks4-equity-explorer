#!/usr/bin/env python3
"""Download the raw DfE / Ofsted files into data/raw/.

DfE API docs: https://api.education.gov.uk/statistics/docs/
API data sets are served gzipped from /v1/data-sets/{id}/csv.
"Institution information" is not an API data set, so it comes from the
data catalogue by its data-set *file* id.
"""
import gzip
import pathlib
import shutil
import urllib.request

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
API = "https://api.education.gov.uk/statistics/v1/data-sets/{}/csv"
CATALOGUE = "https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/{}/csv"

# Publication: Key stage 4 performance (id c8756008-ed50-4632-9b96-01b5ca002a43)
SOURCES = {
    # "Key stage 4 institution level - Performance" (API: "Performance tables schools data")
    "ks4_school_performance.csv": API.format("19e39901-a96c-be76-b9c2-6af54ae076d2"),
    # "Key stage 4 institution level - Subject entries and grades (undiscounted)"
    "ks4_school_subjects.csv": API.format("1ae39901-b462-df76-b108-640a078d7944"),
    # "Key stage 4 institution level - Institution information" (not in the API)
    "ks4_school_info.csv": CATALOGUE.format("561b00c2-5263-4517-abe9-2c6f8feb1f87"),
    # National pupil-level subject entries/grades by pupil characteristic, 2018/19 on
    "ks4_national_subject_characteristics.csv": API.format("19e39901-93ff-4d76-950f-4689d6c361fe"),
    # National / regional / LA headline measures by pupil characteristic, 2018/19 on
    "ks4_national_la_characteristics.csv": API.format("b3e19901-5d2b-b676-bb4c-e60937d74725"),
    # Ofsted management information (update the URL when a newer month is published)
    "ofsted_inspections_2026-10-31.csv": (
        "https://assets.publishing.service.gov.uk/media/6af2dfeb8b63641b15a5c8ba/"
        "Management_information_-_state-funded_schools_-_latest_inspections_as_at_31_October_2026.csv"
    ),
}


def fetch(name: str, url: str) -> None:
    dest = RAW / name
    tmp = dest.with_suffix(".part")
    print(f"{name} <- {url}")
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    with open(tmp, "rb") as f:
        gz = f.read(2) == b"\x1f\x8b"
    if gz:
        with gzip.open(tmp, "rb") as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
        tmp.unlink()
    else:
        tmp.replace(dest)
    print(f"  {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        fetch(name, url)
