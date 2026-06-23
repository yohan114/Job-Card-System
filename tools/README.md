# Job cost import / computation

`import_job_costs.py` builds a labour-cost report by combining two source
workbooks:

| File | Used for |
|------|----------|
| `Daily_Work_Done.xlsx` (sheet `From 1st Dec2025`) | daily entries: date, vehicle, work description, mechanics, hours |
| `Daily_Work_Done.xlsx` (sheet `Labor Hour`)       | mechanic hourly rates |
| `Job_Record.xlsx` (sheets `Requested job`, `C-job`) | the jobs to cost |

## How costing works

For every job we pull each daily-work line for the **same vehicle** whose date
falls within **`[start - 2 days, end + 2 days]`**. For each matched line the
hours are split equally across the named mechanics and costed at each
mechanic's hourly rate; the sums give the job's labour cost.

### Date formats
The two files differ and are parsed accordingly:
* Daily Work Done — `MM/DD/YYYY` (slash) e.g. `12/02/2025` = 2 Dec 2025
* Job Record — `DD.MM.YYYY` (dot) e.g. `08.12.2025` = 8 Dec 2025

### Mechanic name normalisation
Typos / name-changes confirmed by the workshop are folded into a single rate
(see `RATES` / `CANON` in the script), e.g. `Vinoth → Vinod M (250)`,
`Samanpriya → Saman (425)`, `Themindu → Theminda (425)`,
`Electrical Vinod → Vinod (375)`. Foremen (`Dileepa`, `Dilip`) and `External`
carry no rate and contribute Rs.0.

## Output

Writes `data/Job_Cost_Computed.xlsx` with sheets:
* **Job Costs** — one row per job: totals, per-mechanic breakdown, matched work
* **Daily Lines** — every matched daily line with its per-mechanic cost
* **Unmatched Daily** — daily lines matched to no job (review)
* **Jobs No DailyWork** — jobs that found no daily work in their window

## Run

```bash
pip install openpyxl pandas
python3 tools/import_job_costs.py
```

> Note: the Daily Work log only covers **Dec 2025 – Jun 2026**, so C-jobs
> (2023–2024) produce no matches. Only recent Requested jobs are costed.
