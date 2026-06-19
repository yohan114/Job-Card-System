# Job Card System

A web application that digitizes the **"Request for Repairing and Service of
Vehicle and Machinery"** process for **Edward and Christie (Pvt) Ltd**
(Doc. No. EC40.WS.FO.1E:4:22.3). It manages the full approval + workshop
lifecycle of each job, plus a second workflow for jobs outsourced to external
companies.

Built as a **zero-dependency Node.js app** (only Node's built-in modules) so it
runs anywhere Node is installed — no `npm install`, no database to set up.

---

## Features

### Workflow 1 — Internal workshop job card
`Transport Officer → Transport Manager → Operational Manager → Workshop`

1. **Transport Officer** prepares the job card and submits it.
2. **Transport Manager** reviews (or returns it with comments).
3. **Operational Manager** approves → the job is **automatically routed to the
   workshop** and assigned a unique number (e.g. `JC-2026-0001`).
4. **Workshop Technician** runs it: *Start → (On Hold) → End*, logging work done,
   parts, labour hours and the final meter reading.
5. On completion, the **Transport Officer, Transport Manager and Operational
   Manager are notified** to review and close the job.

### Workflow 2 — Outsourced / service-requested job
`Asst. Mechanical Engineer → Mechanical Engineer → Operational Manager → Vendor`

1. **Assistant Mechanical Engineer** prepares the request and selects the
   external company/vendor.
2. **Mechanical Engineer** reviews (or returns it).
3. **Operational Manager** approves → the system **automatically emails the
   selected vendor** the request (with the PDF copy attached) and copies the
   internal requesters. A number like `SR-2026-0001` is assigned.
4. Progress is tracked until the request is completed and closed.

### Throughout
- **Role-based access control** — every action is checked on the server.
- **Immutable audit trail / timeline** on every job card.
- **In-app notifications** (bell + list) at each step.
- **Printable form / PDF copy** laid out like the original paper form
  (open *Print / PDF* → *Save as PDF*).
- **Email Outbox** showing every vendor email the system has "sent".
- **Dashboards** ("pending my action"), **workshop Kanban board**, **reports**,
  and an **admin** area for users, vehicles, vendors and projects.

---

## Running it

```bash
node src/server.js
# then open http://localhost:3000   (set PORT=... to change the port)
```

That's it — no install step. A demo database is seeded automatically on first
run into `data/db.json`.

### Demo accounts (password: `password`)

| Username   | Role                          |
|------------|-------------------------------|
| `tofficer` | Transport Officer             |
| `tmanager` | Transport Manager             |
| `ame`      | Assistant Mechanical Engineer |
| `me`       | Mechanical Engineer           |
| `omanager` | Operational Manager           |
| `tech`     | Workshop Technician           |
| `admin`    | Administrator                 |

### Try the internal flow
Log in as `tofficer` → **New Internal Job** → fill & create → open it → **Submit
for Review**. Log in as `tmanager` → **Approve Review**. Log in as `omanager` →
**Approve & Send to Workshop** (a `JC-` number is assigned). Log in as `tech` →
open the job → **Start Job**, then **End / Complete Job**. The managers now get a
notification to review.

### Try the outsourced flow
Log in as `ame` → **New Service Request** → pick a vendor → create → **Submit**.
Log in as `me` → **Approve Review**. Log in as `omanager` → **Approve & Email
Vendor**. Check **Email Outbox** to see the generated vendor email and open the
attached printable PDF.

---

## Sending real email through Gmail

By default the system runs in **simulated** mode — vendor emails are recorded in
the **Email Outbox** but not actually sent. To send them for real through your
company Gmail (`badalgama@gmail.com`):

1. **Turn on 2-Step Verification** for the Gmail account:
   [myaccount.google.com](https://myaccount.google.com) → **Security** →
   **2-Step Verification** → enable it. (Required — Gmail won't allow app sign-in
   without it.)
2. **Create an App Password:** same Security page → **App passwords** → pick
   *Mail* / *Other (Job Card System)*. Google shows a **16-character password** —
   copy it (ignore the spaces).
3. In the project folder, copy `mail.config.example.json` to **`mail.config.json`**
   and fill it in:
   ```json
   {
     "host": "smtp.gmail.com",
     "port": 465,
     "user": "badalgama@gmail.com",
     "pass": "your16charapppassword",
     "from": "Edward and Christie (Pvt) Ltd <badalgama@gmail.com>"
   }
   ```
4. Restart the app (`node src/server.js`). The Email Outbox now shows
   **“Live email is ON”**, and approving an outsourced service request will email
   the chosen vendor — with the request attached as a printable file — and Cc the
   internal requesters.

**Good to know**
- A normal Gmail password will **not** work; you must use an **App Password**
  (which requires 2-Step Verification).
- `mail.config.json` holds a secret, so it is git-ignored — never commit it.
  (Prefer env vars? Set `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_FROM` instead.)
- Port **465 (SSL)** is the default; **587 (STARTTLS)** also works.
- If a send fails (e.g. wrong password), the Outbox marks that email **failed**
  and shows the error — nothing is lost.
- Free Gmail has a ~500 recipients/day limit; for more, use Google Workspace or a
  provider like SendGrid/Mailgun (just change `host`/`port`/`user`/`pass`).

---

## Project structure

```
src/
  server.js          HTTP server + router + request/ctx plumbing
  controllers.js     Request handlers
  views.js           Server-rendered HTML (incl. printable PDF form)
  jobcards.js        Job-card service + workflow transition engine
  domain.js          Roles, statuses, and the two workflow state machines
  notifications.js   In-app notifications
  mailer.js          Vendor email (writes to the in-app Outbox)
  auth.js            Password hashing, sessions, cookies
  db.js              Tiny JSON datastore (data/db.json)
  seed.js            Demo data
public/styles.css    Styling
PROMPT.md            The original product specification / build prompt
```

---

## Configuration & production notes

This is a working **v1 / demo**. It is intentionally simple so it runs with zero
setup. To take it to production:

- **Real email:** supported out of the box via a built-in SMTP client — see
  *"Sending real email through Gmail"* above. With no config it stays in
  simulated (Outbox-only) mode.
- **Database:** data is stored in a single JSON file via the thin repository
  layer in `src/db.js`. Swap that layer for PostgreSQL/MySQL without touching the
  services. (The companion `PROMPT.md` describes a fuller React + NestJS +
  PostgreSQL target if you prefer to rebuild on that stack.)
- **Sessions** are in-memory (reset on restart) — move to a shared store to run
  multiple instances.
- **Security to add before real use:** CSRF tokens on forms, HTTPS, password
  reset, rate-limiting, and per-user file-upload/attachment handling.
- **Real PDF generation:** the print page is browser "Save as PDF". For
  server-side PDFs, render the same template with a library (e.g. Puppeteer).

To reset the demo data, stop the app and delete `data/db.json`.
