#!/usr/bin/env python3
"""
Seed data/db.json with MRN / receipt / item-catalog data from the Tracker backup.

For each MRN record in the Tracker JSON we:
  1. Upsert the item into the `items` catalog (deduplicated by name+category).
  2. Insert the MRN into `mrns`, linking to the item.
  3. Insert every receipt/GRN line into `receipts`.
  4. Attempt to match the MRN to a Job Record job:
       vehicle match + reqDate in [job.start - 3 days, job.end + 3 days].

Run:  python3 tools/seed_tracker.py
Re-running is safe: existing T-prefixed records are skipped (idempotent).
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
UP = "/root/.claude/uploads/8e475921-bb1d-59c7-b2fc-59a32e5f4a4a"

TRACKER_JSON = os.path.join(UP, "1186dc1a-tracker_backup_20260623.json")
JOBS_XLSX = os.path.join(UP, "26191571-Job_Record.xlsx")
DB_FILE = os.path.join(ROOT, "data", "db.json")

WINDOW = 3  # days ± around job start/end


# ---------------------------------------------------------------------------
def norm_vehicle(v):
    if not v or (isinstance(v, float) and v != v):
        return ""
    return re.sub(r"\s+", "", str(v)).strip().upper()


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d")
    except ValueError:
        return None


def slugify(text):
    """Deterministic short ID from a string (for item dedup)."""
    import hashlib
    return "I-" + hashlib.md5(text.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
def load_jobs():
    """Return list of {veh_set, start, end, job_no} for Requested jobs."""
    xl = pd.ExcelFile(JOBS_XLSX)
    df = pd.read_excel(xl, sheet_name="Requested job", header=None).iloc[1:]
    jobs = []
    for _, r in df.iterrows():
        if pd.isna(r[0]):
            continue
        raw_start = str(r[3]).strip().rstrip(".")
        raw_end = str(r[4]).strip().rstrip(".")
        s = pd.to_datetime(raw_start, errors="coerce", dayfirst=True)
        e = pd.to_datetime(raw_end, errors="coerce", dayfirst=True)
        vehicle_raw = str(r[1]) if pd.notna(r[1]) else ""
        veh_set = set(norm_vehicle(p) for p in re.split(r"[/,]", vehicle_raw) if norm_vehicle(p))
        if not veh_set or pd.isna(s):
            continue
        jobs.append({
            "job_no": str(r[0]).strip(),
            "veh_set": veh_set,
            "start": s.to_pydatetime(),
            "end": e.to_pydatetime() if pd.notna(e) else s.to_pydatetime(),
        })
    return jobs


def build_job_index(jobs):
    """vehicle -> sorted list of (start-window, end+window, job_no)."""
    idx = {}
    for j in jobs:
        lo = j["start"] - timedelta(days=WINDOW)
        hi = j["end"] + timedelta(days=WINDOW)
        for v in j["veh_set"]:
            idx.setdefault(v, []).append((lo, hi, j["job_no"]))
    return idx


def find_job(veh_set, req_date, job_index):
    if not req_date:
        return None
    for v in veh_set:
        for (lo, hi, job_no) in job_index.get(v, []):
            if lo <= req_date <= hi:
                return job_no
    return None


# ---------------------------------------------------------------------------
def mrn_status(rec):
    req_qty = rec.get("reqQty") or 0
    rec_qty = rec.get("recQty") or 0
    if rec_qty <= 0:
        return "pending"
    # check for any return in receipts
    has_return = any(rx.get("transactionType") == "Return" for rx in rec.get("receipts", []))
    if has_return:
        return "returned"
    if rec_qty >= req_qty:
        return "received"
    return "partial"


def main():
    # --- load tracker ----------------------------------------------------------
    with open(TRACKER_JSON, encoding="utf-8") as f:
        tracker = json.load(f)
    print(f"Loaded {len(tracker)} tracker MRN records.")

    # --- load job index --------------------------------------------------------
    print("Loading job records for matching …")
    jobs = load_jobs()
    job_index = build_job_index(jobs)
    print(f"  {len(jobs)} jobs indexed.")

    # --- load existing db.json -------------------------------------------------
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    if os.path.exists(DB_FILE):
        with open(DB_FILE, encoding="utf-8") as f:
            db = json.load(f)
    else:
        db = {}

    # Ensure collections exist
    for col in ("items", "mrns", "receipts", "users", "projects", "vehicles",
                "vendors", "jobcards", "audits", "notifications", "outbox"):
        db.setdefault(col, [])
    db.setdefault("meta", {"counters": {"JC": 0, "SR": 0}})

    # --- build existing id sets for idempotency --------------------------------
    existing_mrn_ids = {m["id"] for m in db["mrns"]}
    existing_receipt_ids = {r["id"] for r in db["receipts"]}
    existing_item_ids = {i["id"] for i in db["items"]}

    # --- item catalog ----------------------------------------------------------
    item_map = {}  # (name_lower, category_lower) -> id
    for it in db["items"]:
        key = (it["name"].lower(), it.get("category", "").lower())
        item_map[key] = it["id"]

    items_added = 0
    for rec in tracker:
        name = (rec.get("itemName") or rec.get("name") or "").strip()
        cat = (rec.get("category") or "General Items").strip()
        if not name:
            continue
        key = (name.lower(), cat.lower())
        if key not in item_map:
            item_id = slugify(name + "|" + cat)
            if item_id not in existing_item_ids:
                db["items"].append({
                    "id": item_id,
                    "name": name,
                    "category": cat,
                    "unit": "Nos",
                })
                existing_item_ids.add(item_id)
                items_added += 1
            item_map[key] = item_id

    print(f"  Items in catalog: {len(db['items'])} (+{items_added} new)")

    # --- MRNs + receipts -------------------------------------------------------
    mrns_added = receipts_added = matched = 0

    for rec in tracker:
        mrn_id = f"T-{rec['id']}"
        if mrn_id in existing_mrn_ids:
            continue  # already seeded

        name = (rec.get("itemName") or rec.get("name") or "").strip()
        cat = (rec.get("category") or "General Items").strip()
        item_id = item_map.get((name.lower(), cat.lower()))

        vehicle_raw = rec.get("vehicleMachinery") or ""
        veh_set = set(norm_vehicle(p) for p in re.split(r"[/,]", vehicle_raw) if norm_vehicle(p))

        # Use reqDateISO (always clean ISO) as primary; fall back to createdAt
        req_date_str = rec.get("reqDateISO") or (rec.get("createdAt") or "")[:10]
        req_date = parse_iso(req_date_str)

        job_no = find_job(veh_set, req_date, job_index)
        if job_no:
            matched += 1

        db["mrns"].append({
            "id": mrn_id,
            "mrnNum": str(rec.get("mrnNum") or ""),
            "jobNo": job_no,
            "jobCardId": None,  # will be resolved later if job is imported into jobcards collection
            "vehicleMachinery": vehicle_raw.strip(),
            "reqDate": req_date_str,
            "itemId": item_id,
            "itemName": name,
            "category": cat,
            "reqQty": rec.get("reqQty") or 0,
            "recQty": rec.get("recQty") or 0,
            "hasUnpriced": bool(rec.get("hasUnpriced")),
            "purchaseSource": rec.get("purchaseSource") or "",
            "status": mrn_status(rec),
            "createdAt": rec.get("createdAt") or req_date_str,
            "createdBy": "seed",
        })
        existing_mrn_ids.add(mrn_id)
        mrns_added += 1

        # receipts
        for rx in rec.get("receipts", []):
            rx_id = f"T-R-{rx['id']}"
            if rx_id in existing_receipt_ids:
                continue
            db["receipts"].append({
                "id": rx_id,
                "mrnId": mrn_id,
                "transactionType": rx.get("transactionType") or "Receive",
                "qty": rx.get("qty") or 0,
                "deliveryDate": rx.get("deliveryDateISO") or rx.get("deliveryDate") or "",
                "grnNumber": str(rx.get("grnNumber") or ""),
                "invoiceNumber": str(rx.get("invoiceNumber") or ""),
                "invoiceDate": str(rx.get("invoiceDate") or ""),
                "supplierName": str(rx.get("supplierName") or ""),
                "purchaseSource": str(rx.get("purchaseSource") or ""),
                "unitPrice": rx.get("unitPrice"),  # may be null
                "createdAt": rec.get("createdAt") or "",
                "createdBy": "seed",
            })
            existing_receipt_ids.add(rx_id)
            receipts_added += 1

    # --- persist ---------------------------------------------------------------
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)

    # --- summary ---------------------------------------------------------------
    print(f"\nSeed complete:")
    print(f"  MRNs inserted  : {mrns_added}")
    print(f"  Receipts        : {receipts_added}")
    print(f"  MRNs matched to a job: {matched} / {mrns_added}")
    print(f"  MRNs unmatched  : {mrns_added - matched}")
    print(f"  db.json written : {DB_FILE}")


if __name__ == "__main__":
    main()
