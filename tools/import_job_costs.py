#!/usr/bin/env python3
"""
Import requested jobs + C-jobs and compute labour cost per job.

For every job (Requested job + C-job sheets) we look at the Daily Work Done
log and pull in every daily entry for the same vehicle whose date falls within
[job.start - 2 days, job.end + 2 days]. Each daily entry lists the mechanics who
worked and the total hours; hours are split equally between the named mechanics,
costed at each mechanic's hourly rate, and summed to give the job labour cost.

Outputs an Excel workbook (Job_Cost_Computed.xlsx) with:
  * Job Costs   - one row per job with totals and the matched daily entries
  * Daily Lines - every matched daily line with its per-mechanic cost
  * Unmatched   - jobs that found no daily work, and daily entries matched to
                  no job, for review.

Run:  python3 tools/import_job_costs.py
"""

import os
import re
import sys
from datetime import timedelta

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
UP = "/root/.claude/uploads/8e475921-bb1d-59c7-b2fc-59a32e5f4a4a"
DAILY_XLSX = os.path.join(UP, "ce6d1a19-Daily_Work_Done.xlsx")
JOBS_XLSX = os.path.join(UP, "26191571-Job_Record.xlsx")
OUT_XLSX = os.path.join(HERE, "..", "data", "Job_Cost_Computed.xlsx")

WINDOW_DAYS = 2

# ---------------------------------------------------------------------------
# Mechanic hourly rates (Rs./hr). Keys are normalised (lowercased) names.
# Aliases / typos / name-changes confirmed by the workshop are folded in here.
# Names with rate None are excluded from labour cost (foremen / external work).
# ---------------------------------------------------------------------------
RATES = {
    # 425 group
    "anura": 425,
    "buddhika": 425,
    "dinesh": 425,
    "nawathilaka": 425,
    "nawathilake": 425,        # typo -> Nawathilaka
    "saman": 425,
    "samanpriya": 425,         # name change -> Saman
    "ruwan": 425,
    "theminda": 425,
    "themindu": 425,           # typo -> Theminda
    "kumara": 425,
    "tm (wijesuriya)": 425,    # same person as Kumara
    # 375
    "vinod": 375,
    "electrical vinod": 375,   # -> Vinod
    # 400
    "seethananda": 400,
    "seetha": 400,             # -> Seethananda
    # 250 group
    "chaminda": 250,
    "krishna": 250,
    "krishan": 250,            # typo -> Krishna
    "govinda": 250,
    "theshan": 250,
    "jayaweera": 250,
    "nimesh": 250,
    "vinod m": 250,
    "vinoth": 250,             # name change -> Vinod M
    "herath": 250,
    # 200
    "nimal": 200,
    # 125 group
    "viboda": 125,
    "manula": 125,
    "tharusha": 125,
    "trainee mechanic": 125,
    # No rate (excluded from cost) -- foremen / external
    "dileepa": None,
    "dilip": None,
    "external": None,
}

# Canonical display name for each normalised key (after alias folding).
CANON = {
    "nawathilake": "Nawathilaka",
    "samanpriya": "Saman",
    "themindu": "Theminda",
    "tm (wijesuriya)": "Kumara",
    "electrical vinod": "Vinod",
    "seetha": "Seethananda",
    "krishan": "Krishna",
    "vinoth": "Vinod M",
}


def norm_name(raw):
    n = str(raw).strip().lower()
    n = re.sub(r"\s+", " ", n)
    return n


def canon_name(raw):
    n = norm_name(raw)
    return CANON.get(n, str(raw).strip())


def norm_vehicle(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return re.sub(r"\s+", "", str(v)).strip().upper()


def parse_date(v):
    """Parse a date cell. The two source files use different conventions:

      * Daily Work Done -> MM/DD/YYYY (US, slash separated) e.g. 12/02/2025
      * Job Record      -> DD.MM.YYYY (dot separated)        e.g. 08.12.2025

    We pick day-first vs month-first from the separator so 12/02/2025 reads as
    2 Dec (daily) while 12.12.2023 stays unambiguous.
    """
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return pd.NaT
    if hasattr(v, "year"):  # already a datetime/Timestamp
        return pd.Timestamp(v)
    s = str(v).strip().rstrip(".")  # strip stray trailing dot e.g. "11.03.23."
    if not s:
        return pd.NaT
    # Slash -> month-first (daily file); dot -> day-first (job record).
    primary = "/" not in s  # True => dayfirst
    for dayfirst in (primary, not primary):
        d = pd.to_datetime(s, errors="coerce", dayfirst=dayfirst)
        if pd.notna(d):
            return d
    return pd.NaT


# ---------------------------------------------------------------------------
# Load daily work
# ---------------------------------------------------------------------------
def load_daily():
    df = pd.read_excel(DAILY_XLSX, sheet_name="From 1st Dec2025", header=None).iloc[1:, :7]
    df.columns = ["date", "vehicle", "desc", "mechanic", "hrs", "outside", "remarks"]
    df = df[df["date"].notna()].copy()
    df["date"] = df["date"].apply(parse_date)
    df["veh"] = df["vehicle"].apply(norm_vehicle)
    df["hrs"] = pd.to_numeric(df["hrs"], errors="coerce").fillna(0)
    df["outside"] = pd.to_numeric(df["outside"], errors="coerce").fillna(0)
    df = df.reset_index(drop=True)
    df["line_id"] = df.index
    return df


def split_mechanics(raw):
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return []
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def line_cost(row):
    """Return (per_mechanic list, total_labour) for a daily line.

    Hours are split equally between named mechanics, then costed per rate.
    Unrated names (foreman/external) take a share of hours but Rs.0 cost.
    """
    mechs = split_mechanics(row["mechanic"])
    hrs = float(row["hrs"]) or 0.0
    if not mechs:
        return [], 0.0
    share = hrs / len(mechs)
    out = []
    total = 0.0
    for m in mechs:
        rate = RATES.get(norm_name(m))
        cost = round(share * rate, 2) if rate else 0.0
        out.append({
            "mechanic": canon_name(m),
            "rate": rate if rate is not None else "",
            "hours": round(share, 2),
            "cost": cost,
        })
        total += cost
    return out, round(total, 2)


# ---------------------------------------------------------------------------
# Load jobs
# ---------------------------------------------------------------------------
def load_jobs():
    jobs = []

    # Requested job sheet
    req = pd.read_excel(JOBS_XLSX, sheet_name="Requested job", header=None).iloc[1:]
    for _, r in req.iterrows():
        if pd.isna(r[0]):
            continue
        jobs.append({
            "source": "Requested",
            "job_no": str(r[0]).strip(),
            "vehicle": r[1],
            "description": "" if pd.isna(r[2]) else str(r[2]).strip(),
            "start": parse_date(r[3]),
            "end": parse_date(r[4]),
            "site": "" if pd.isna(r[5]) else str(r[5]).strip(),
        })

    # C-job sheet (has its own recorded Hrs/Cost we keep for comparison)
    cj = pd.read_excel(JOBS_XLSX, sheet_name="C-job", header=None).dropna(axis=1, how="all")
    cj = cj.iloc[1:]  # skip header row
    for _, r in cj.iterrows():
        vals = r.tolist()
        if pd.isna(vals[0]):
            continue
        jobs.append({
            "source": "C-job",
            "job_no": str(vals[0]).strip(),
            "vehicle": vals[2],
            "description": "" if pd.isna(vals[3]) else str(vals[3]).strip(),
            "start": parse_date(vals[4]),
            "end": parse_date(vals[5]),
            "site": "" if len(vals) < 9 or pd.isna(vals[8]) else str(vals[8]).strip(),
            "rec_hrs": vals[6] if len(vals) > 6 else None,
            "rec_cost": vals[7] if len(vals) > 7 else None,
        })

    for j in jobs:
        j["veh"] = norm_vehicle(j["vehicle"])
        # A job may list several vehicles e.g. "LB-26 / ZB-4605"
        j["veh_set"] = set(
            norm_vehicle(p) for p in re.split(r"[/,]", str(j["vehicle"])) if norm_vehicle(p)
        ) or {j["veh"]}
    return jobs


# ---------------------------------------------------------------------------
# Match + cost
# ---------------------------------------------------------------------------
def main():
    daily = load_daily()
    jobs = load_jobs()

    print(f"Loaded {len(jobs)} jobs and {len(daily)} daily work lines.")

    matched_line_ids = set()
    job_rows = []
    line_rows = []

    for j in jobs:
        start = j["start"]
        end = j["end"] if pd.notna(j["end"]) else j["start"]
        if pd.isna(start) and pd.notna(end):
            start = end
        if pd.isna(start):
            j["match_count"] = 0
            j["total_hours"] = 0
            j["labour_cost"] = 0
            j["no_date"] = True
            job_rows.append(_job_row(j, [], 0, 0))
            continue

        lo = start - timedelta(days=WINDOW_DAYS)
        hi = end + timedelta(days=WINDOW_DAYS)

        cand = daily[(daily["veh"].isin(j["veh_set"])) &
                     (daily["date"] >= lo) & (daily["date"] <= hi)]

        total_hours = 0.0
        total_cost = 0.0
        total_outside = 0.0
        breakdown = {}  # mechanic -> {hours, cost}
        descs = []
        for _, line in cand.iterrows():
            matched_line_ids.add(line["line_id"])
            per, lcost = line_cost(line)
            total_hours += float(line["hrs"] or 0)
            total_cost += lcost
            total_outside += float(line["outside"] or 0)
            d = str(line["desc"]).strip()
            if d and d != "nan":
                descs.append(f"{line['date'].date()}: {d}")
            for pm in per:
                b = breakdown.setdefault(pm["mechanic"], {"hours": 0.0, "cost": 0.0, "rate": pm["rate"]})
                b["hours"] += pm["hours"]
                b["cost"] += pm["cost"]
                line_rows.append({
                    "job_no": j["job_no"],
                    "source": j["source"],
                    "date": line["date"].date(),
                    "vehicle": line["vehicle"],
                    "description": line["desc"],
                    "mechanic": pm["mechanic"],
                    "rate": pm["rate"],
                    "hours": pm["hours"],
                    "cost": pm["cost"],
                })

        bd_str = "; ".join(
            f"{m}: {round(v['hours'],1)}h @{v['rate']} = Rs.{round(v['cost'],2)}"
            for m, v in sorted(breakdown.items())
        )
        j["match_count"] = len(cand)
        j["total_hours"] = round(total_hours, 2)
        j["labour_cost"] = round(total_cost, 2)
        job_rows.append(_job_row(j, descs, bd_str, total_outside))

    # Unmatched daily lines
    unmatched_daily = daily[~daily["line_id"].isin(matched_line_ids)]

    # ---- Write workbook ----
    os.makedirs(os.path.dirname(OUT_XLSX), exist_ok=True)
    with pd.ExcelWriter(OUT_XLSX, engine="openpyxl") as xw:
        pd.DataFrame(job_rows).to_excel(xw, sheet_name="Job Costs", index=False)
        pd.DataFrame(line_rows).to_excel(xw, sheet_name="Daily Lines", index=False)

        no_match = [r for r in job_rows if r["Matched Daily Lines"] == 0]
        un = pd.DataFrame({
            "date": unmatched_daily["date"].dt.date,
            "vehicle": unmatched_daily["vehicle"],
            "description": unmatched_daily["desc"],
            "mechanic": unmatched_daily["mechanic"],
            "hours": unmatched_daily["hrs"],
        })
        un.to_excel(xw, sheet_name="Unmatched Daily", index=False)
        pd.DataFrame(no_match).to_excel(xw, sheet_name="Jobs No DailyWork", index=False)

    # ---- Console summary ----
    total_jobs = len(job_rows)
    matched_jobs = sum(1 for r in job_rows if r["Matched Daily Lines"] > 0)
    grand_cost = sum(r["Labour Cost (Rs.)"] for r in job_rows)
    print(f"Jobs with >=1 matched daily line: {matched_jobs}/{total_jobs}")
    print(f"Daily lines matched to a job: {len(matched_line_ids)}/{len(daily)}")
    print(f"Unmatched daily lines: {len(unmatched_daily)}")
    print(f"Total computed labour cost across all jobs: Rs. {grand_cost:,.2f}")
    print(f"Workbook written: {os.path.abspath(OUT_XLSX)}")


def _job_row(j, descs, bd_str, outside):
    return {
        "Source": j["source"],
        "Job No": j["job_no"],
        "Vehicle": j["vehicle"],
        "Start": j["start"].date() if pd.notna(j["start"]) else "",
        "End": j["end"].date() if pd.notna(j["end"]) else "",
        "Site": j.get("site", ""),
        "Matched Daily Lines": j.get("match_count", 0),
        "Total Hours": j.get("total_hours", 0),
        "Labour Cost (Rs.)": j.get("labour_cost", 0),
        "Outside Value (Rs.)": round(outside, 2),
        "Recorded Hrs (C-job)": j.get("rec_hrs", ""),
        "Recorded Cost (C-job)": j.get("rec_cost", ""),
        "Mechanic Breakdown": bd_str,
        "Matched Work": " | ".join(descs)[:32000],
    }


if __name__ == "__main__":
    main()
