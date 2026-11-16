#!/usr/bin/env python3
"""Turn the raw DfE / Ofsted files (data/raw) into the four compact tables the
dashboard reads (data/processed).

  schools.csv            one row per school with a KS4 cohort, latest year
  subject_entries.csv    one row per school x subject (entries and grades)
  area_groups.csv        Attainment 8 by pupil group: national, regional, LA, all years
  national_subjects.csv  national pupil-level subject entries/grades by pupil group, all years

Suppression markers in DfE files: z = not applicable, c = suppressed (small
numbers), x / u = unavailable / unreliable. All become blank here.
"""
import json
import pathlib
import re

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
YEAR = "202526"  # latest academic year in the files
OFSTED = "ofsted_inspections_2026-10-31.csv"
BOUNDARIES = "la_boundaries_ctyua_dec2025_buc.geojson"
MIN_DERIVED = 6  # smallest derived group (e.g. non-EAL) we keep


def num(s):
    return pd.to_numeric(s, errors="coerce")


def year_label(tp):
    return f"{tp[:4]}/{tp[4:]}"


# ---------------------------------------------------------------- areas
def build_area_groups():
    cols = ["time_period", "geographic_level", "region_name", "la_name", "new_la_code",
            "breakdown_topic", "sex", "sen_provision", "disadvantage_status",
            "first_language", "pupil_count", "attainment8_sum", "attainment8_average"]
    n = pd.read_csv(RAW / "ks4_national_la_characteristics.csv", dtype=str, usecols=cols)
    topics = {
        "Total": ("All", lambda r: "All pupils"),
        "Sex": ("Sex", lambda r: r.sex),
        "Disadvantage status": ("Disadvantage", lambda r: {
            "Disadvantaged": "Disadvantaged",
            "Not known to be disadvantaged": "Not disadvantaged"}[r.disadvantage_status]),
        "First language": ("First language", lambda r: {
            "Known or believed to be English": "English first language",
            "Known or believed to be other than English": "EAL"}.get(r.first_language)),
        "SEN provision": ("SEND", lambda r: {
            "All SEN provision": "SEND",
            "No SEN provision": "No SEND",
            "Education, health and care plan": "EHC plan",
            "SEN support / SEN without an EHC plan": "SEN support"}.get(r.sen_provision)),
    }
    n = n[n.breakdown_topic.isin(topics)].copy()
    n["topic"] = n.breakdown_topic.map(lambda t: topics[t][0])
    n["group"] = [topics[r.breakdown_topic][1](r) for r in n.itertuples()]
    n = n[n.group.notna()]
    n = n[~n.region_name.isin(["Inner London", "Outer London"]) | (n.geographic_level == "Local authority")]
    n["region"] = n.region_name.replace({"Inner London": "London", "Outer London": "London",
                                         "Yorkshire and The Humber": "Yorkshire and the Humber"})
    n["area"] = np.where(n.geographic_level == "National", "England",
                         np.where(n.geographic_level == "Regional", n.region, n.la_name))
    n["level"] = n.geographic_level.replace({"Regional": "Region"})
    out = pd.DataFrame({
        "year": n.time_period.map(year_label), "level": n.level, "area": n.area,
        "region": n.region.fillna(""), "la_code": n.new_la_code.fillna(""),
        "topic": n.topic, "group": n.group,
        "pupils": num(n.pupil_count), "a8": num(n.attainment8_average),
    }).dropna(subset=["pupils", "a8"])
    out["pupils"] = out.pupils.astype(int)
    out = out.sort_values(["year", "level", "area", "topic", "group"])
    la_region = (n[(n.geographic_level == "Local authority")]
                 .drop_duplicates("new_la_code").set_index("new_la_code").region.to_dict())
    return out, la_region


# ---------------------------------------------------------------- schools
TYPE = {
    "Independent schools": "Independent",
    "Independent special schools": "Special",
    "Non-maintained special schools": "Special",
    "Further education 14-16 colleges": "FE college",
}
ADMISSION = {
    "Selective schools": "Selective",
    "Non-selective schools in other areas": "Non-selective",
    "Non-selective schools in highly selective areas": "Non-selective (selective area)",
}
OEIF = {"1": "Outstanding", "2": "Good", "3": "Requires improvement", "4": "Inadequate"}


def school_type(estab):
    if estab in TYPE:
        return TYPE[estab]
    return "Special" if "special" in estab.lower() else "State mainstream"


def build_schools(la_region):
    info = pd.read_csv(RAW / "ks4_school_info.csv", dtype=str)
    info = info[info.time_period == YEAR].set_index("school_urn")
    perf = pd.read_csv(RAW / "ks4_school_performance.csv", dtype=str, low_memory=False)
    perf = perf[perf.time_period == YEAR]
    wide = {}
    for label, key in [("Total", "all"), ("Boys", "boys"), ("Girls", "girls"),
                       ("Disadvantaged", "dis"), ("Not known to be disadvantaged", "nondis"),
                       ("Known or believed to be other than English", "eal")]:
        b = perf[perf.breakdown == label].set_index("school_urn")
        wide[f"n_{key}"] = num(b.pupil_count)
        wide[f"sum_{key}"] = num(b.attainment8_sum)
        wide[f"a8_{key}"] = num(b.attainment8_average)
        wide[f"pct_{key}"] = num(b.pupil_percent)
    w = pd.DataFrame(wide)
    # The file has no "English first language" row, so derive it from total minus EAL.
    n_non = w.n_all - w.n_eal
    ok = (n_non >= MIN_DERIVED) & w.sum_all.notna() & w.sum_eal.notna()
    w["n_noneal"] = n_non.where(ok)
    w["a8_noneal"] = ((w.sum_all - w.sum_eal) / n_non).where(ok).round(1)

    of = pd.read_csv(RAW / OFSTED, dtype=str, encoding="utf-8-sig", low_memory=False).set_index("URN")
    s = pd.DataFrame(index=info.index)
    s["name"] = info.school_name
    s["la"] = info.la_name
    s["la_code"] = info.new_la_code
    s["region"] = info.new_la_code.map(la_region)
    s["region"] = s.region.fillna(of.Region.reindex(s.index)).fillna("")
    s["constituency"] = info.pcon_name
    s["postcode"] = info.address.str.extract(r"([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$")[0]
    s["estab"] = info.establishment_type_group
    s["type"] = info.establishment_type_group.map(school_type)
    s["admission"] = info.school_admission_type.map(ADMISSION).fillna("")
    s["sex_policy"] = info.sex_policy.replace({"Gender unclassified": ""})
    s["cohort"] = num(info.endks4_pupil_count)
    s["pct_girls"] = w.pct_girls
    # single-sex schools have the other sex marked z
    s.loc[s.sex_policy.eq("Boys") & s.pct_girls.isna(), "pct_girls"] = 0
    s.loc[s.sex_policy.eq("Girls") & s.pct_girls.isna(), "pct_girls"] = 100
    s["pct_dis"] = w.pct_dis
    s["pct_eal"] = w.pct_eal
    s["pct_sen"] = num(info.sen_pupil_percent)
    s["pct_ehcp"] = num(info.sen_with_ehcp_pupil_percent)
    s["a8"] = w.a8_all
    for k in ["boys", "girls", "dis", "nondis", "eal", "noneal"]:
        s[f"a8_{k}"] = w[f"a8_{k}"]
        s[f"n_{k}"] = w[f"n_{k}"]
    s["idaci"] = of["The income deprivation affecting children index (IDACI) quintile"].reindex(s.index)
    s["ofsted"] = of["Latest OEIF overall effectiveness"].reindex(s.index).map(OEIF)
    s = s[s.cohort > 0].copy()
    for c in s.columns:
        if c.startswith("n_") or c == "cohort":
            s[c] = s[c].astype("Int64")
    return s.rename_axis("urn").reset_index().sort_values("name")


# ---------------------------------------------------------------- subjects
def build_subject_entries(school_urns):
    s = pd.read_csv(RAW / "ks4_school_subjects.csv", dtype=str)
    s = s[s.school_urn.isin(school_urns)]
    s["n"] = num(s.number_achieving).fillna(0)
    frames = []

    # GCSE 9-1 full course: average grade counts U as 0 and leaves out X (no result).
    g = s[s.qualification_detailed == "GCSE (9-1) Full Course"].copy()
    g["pts"] = num(g.grade)
    g["qual"] = "GCSE"
    g["label"] = g.subject
    frames.append(g)

    # Combined Science double award: 99, 98 ... 11; points = mean of the two grades.
    d = s[s.qualification_detailed == "GCSE (9-1) Full Course (Double Award)"].copy()
    two = d.grade.str.fullmatch(r"\d\d")
    d["pts"] = np.where(two, (num(d.grade.str[0]) + num(d.grade.str[1])) / 2, np.nan)
    d["qual"] = "GCSE"
    d["label"] = d.subject + " (double award)"
    frames.append(d)

    # Vocational (Technical Awards etc.): no 9-1 grade, so "n4" = level 2 pass or better,
    # "n7" = level 2 distinction or better, and there is no average grade.
    v = s[s.qualification_type == "Vocational"].copy()
    v["pts"] = np.nan
    v["qual"] = "Vocational"
    v["label"] = v.subject + " (vocational)"
    frames.append(v)

    a = pd.concat(frames)
    is_total = a.grade == "Total exam entries"
    is_graded = ~is_total & (a.grade != "X")
    voc = a.qual == "Vocational"
    l2 = a.grade.str.startswith("Level 2")
    l2d = a.grade.isin(["Level 2 distinction", "Level 2 distinction star"])
    a["entries"] = a.n.where(is_total, 0)
    a["graded"] = a.n.where(is_graded, 0)
    a["points"] = (a.n * a.pts.fillna(0)).where(is_graded & ~voc, 0)
    a["n4"] = a.n.where(np.where(voc, l2, a.pts >= 4) & is_graded, 0)
    a["n7"] = a.n.where(np.where(voc, l2d, a.pts >= 7) & is_graded, 0)
    out = (a.groupby(["school_urn", "label", "qual"], as_index=False)
           [["entries", "graded", "points", "n4", "n7"]].sum())
    out = out[out.entries > 0]
    out.loc[out.qual == "Vocational", "points"] = np.nan
    for c in ["entries", "graded", "n4", "n7"]:
        out[c] = out[c].astype(int)
    return out.rename(columns={"school_urn": "urn", "label": "subject"})


def build_national_subjects(area_groups):
    c = pd.read_csv(RAW / "ks4_national_subject_characteristics.csv", dtype=str)
    c = c[c.qualification_type.isin(["GCSE", "Vocational"])]
    c = c[~c.subject.str.contains(r"^Any | and |^English, ")
          | c.subject.isin(["Art and Design", "Design and Technology", "Food Preparation and Nutrition",
                            "Information and Communication Technology", "Hospitality and Catering",
                            "Speech and Drama", "Travel and Tourism",
                            "Construction and the Built Environment", "Hair and Beauty Studies"])]
    spec = {
        "Total": ("All", None, {}),
        "Sex": ("Sex", "sex", {"Boys": "Boys", "Girls": "Girls"}),
        "Disadvantage status": ("Disadvantage", "disadvantage_status",
                                {"Disadvantaged": "Disadvantaged",
                                 "Not known to be disadvantaged": "Not disadvantaged"}),
        "First language": ("First language", "first_language",
                           {"Known or believed to be English": "English first language",
                            "Known or believed to be other than English": "EAL"}),
        "SEN status": ("SEND", "sen_status",
                       {"Any special educational need": "SEND",
                        "No identified special educational need": "No SEND"}),
    }
    c = c[c.breakdown_topic.isin(spec)].copy()
    c["topic"] = c.breakdown_topic.map(lambda t: spec[t][0])
    c["group"] = "All pupils"
    for t, (_, col, mp) in spec.items():
        if col:
            m = c.breakdown_topic == t
            c.loc[m, "group"] = c.loc[m, col].map(mp)
    c = c[c.group.notna()]
    measure = {"Total pupil entries": "entries", "9 to 4": "n4", "9 to 7": "n7",
               "Achieving level 2 pass": "n4"}
    c = c[c.grade.isin(measure)].copy()
    c["measure"] = c.grade.map(measure)
    c["n"] = num(c.number_achieving)
    c["subject"] = np.where(c.qualification_type == "Vocational", c.subject + " (vocational)",
                            np.where(c.subject == "Combined Science", "Combined Science (double award)", c.subject))
    c["year"] = c.time_period.map(year_label)
    out = (c.pivot_table(index=["year", "subject", "qualification_type", "topic", "group"],
                         columns="measure", values="n", aggfunc="sum").reset_index()
           .rename(columns={"qualification_type": "qual"}))
    cohort = (area_groups[area_groups.level == "National"]
              .set_index(["year", "topic", "group"]).pupils)
    out["cohort"] = [cohort.get((r.year, r.topic, r.group), np.nan) for r in out.itertuples()]
    out = out.dropna(subset=["entries"])
    for col in ["entries", "n4", "n7", "cohort"]:
        if col not in out:
            out[col] = np.nan
        out[col] = out[col].astype("Int64")
    return out[["year", "subject", "qual", "topic", "group", "cohort", "entries", "n4", "n7"]]


def build_boundaries(la_region):
    """Upper-tier local authority outlines for the map.

    Coordinates stay in British National Grid metres (rounded to 10 m), so the page can
    draw them as a flat plane with d3.geoIdentity and needs no map projection.
    """
    src = json.loads((RAW / BOUNDARIES).read_text())

    def ring(points):
        out = []
        for x, y in points:
            pt = [round(x, -1) // 1, round(y, -1) // 1]
            pt = [int(pt[0]), int(pt[1])]
            if not out or out[-1] != pt:
                out.append(pt)
        return out

    features = []
    for f in src["features"]:
        code = f["properties"]["CTYUA25CD"]
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        polys = [[r for r in (ring(r) for r in poly) if len(r) >= 4] for poly in polys]
        polys = [poly for poly in polys if poly]
        features.append({
            "type": "Feature",
            "properties": {"code": code, "name": f["properties"]["CTYUA25NM"], "region": la_region.get(code, "")},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })
    return {"type": "FeatureCollection", "features": features}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    areas, la_region = build_area_groups()
    schools = build_schools(la_region)
    entries = build_subject_entries(set(schools.urn))
    national = build_national_subjects(areas)
    for name, df in [("area_groups", areas), ("schools", schools),
                     ("subject_entries", entries), ("national_subjects", national)]:
        path = OUT / f"{name}.csv"
        df.to_csv(path, index=False)
        print(f"{name}: {len(df):,} rows, {path.stat().st_size / 1e6:.2f} MB")
    path = OUT / "la_boundaries.json"
    path.write_text(json.dumps(build_boundaries(la_region), separators=(",", ":")))
    print(f"la_boundaries: {path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
