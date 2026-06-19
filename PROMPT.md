# Smart Prompt — Vehicle & Machinery Job Card System

> Copy everything inside the code-fence below and give it to an AI coding agent
> (or a developer) to build the system. It is written to be self-contained and
> unambiguous. Adjust the **Tech Stack** and **Branding** sections if you have
> preferences.

---

```prompt
ROLE
You are a senior full-stack engineer. Build a production-ready web application
called the "Job Card System" for Edward and Christie (Pvt) Ltd, a company that
operates and maintains a fleet of vehicles and machinery. The system digitizes
the existing paper form "Request for Repairing and Service of Vehicle and
Machinery" (Doc No. EC40.WS.FO.1E:4:22.3) and manages the full approval +
workshop lifecycle of each job.

GOAL
Replace the manual paper process with a role-based digital workflow that:
1. Lets staff create, review, and approve job cards online.
2. Automatically routes approved jobs to the workshop and tracks their progress
   (start / ongoing / hold / end).
3. Notifies the right people at every stage (in-app + email).
4. Handles a second workflow for jobs that are outsourced to an external
   company, including automatic email to the selected vendor and a PDF copy of
   the request.

──────────────────────────────────────────────────────────────────────────────
USER ROLES & PERMISSIONS (Role-Based Access Control)
──────────────────────────────────────────────────────────────────────────────
- Transport Officer (TO)        : Prepares INTERNAL job cards.
- Transport Manager (TM)        : Reviews INTERNAL job cards.
- Assistant Mechanical Engineer : Prepares OUTSOURCED (service-requested) jobs.
- Mechanical Engineer (ME)      : Reviews OUTSOURCED jobs.
- Operational Manager (OM)      : Approves BOTH workflows (final authority).
- Workshop Technician/Mechanic  : Executes internal jobs (start/update/end).
- Administrator                 : Manages users, roles, and master data
                                  (vehicles, vendors, projects/plants).

Each user has exactly one primary role but a user may hold multiple roles.
Every state-changing action is permission-checked on the server, not just the UI.

──────────────────────────────────────────────────────────────────────────────
WORKFLOW 1 — INTERNAL WORKSHOP JOB CARD
──────────────────────────────────────────────────────────────────────────────
State machine (each transition is logged with user + timestamp + optional note):

  DRAFT ──submit──▶ PENDING_REVIEW ──review──▶ PENDING_APPROVAL ──approve──▶ APPROVED
    ▲                    │ reject              │ reject                         │
    └────────────────────┴─────────────────────┘                              │
                  (returned to preparer with comments)                         │
                                                                               ▼
  APPROVED  →  auto-routed to Workshop, a unique JOB CARD NO. is generated.
  Workshop states:  QUEUED → IN_PROGRESS → (ON_HOLD ⇄ IN_PROGRESS) → COMPLETED → CLOSED

Steps:
1. Transport Officer creates a job card (fills the form below) and submits it.
2. Transport Manager reviews → approves the review or returns it with comments.
3. Operational Manager approves → on approval the job is AUTOMATICALLY sent to
   the workshop and assigned a unique Job Card No. (e.g. JC-2026-0001).
4. A Workshop Technician picks up the job: "Start Job" (IN_PROGRESS), can put it
   "On Hold" (e.g. waiting for parts), logs work performed / parts / labour /
   meter reading, then "End Job" (COMPLETED).
5. On completion the system sends a notification (in-app + email) to the
   Transport Officer, Transport Manager, and Operational Manager to review the
   finished job. Once they acknowledge/sign off, the job becomes CLOSED.

──────────────────────────────────────────────────────────────────────────────
WORKFLOW 2 — OUTSOURCED / SERVICE-REQUESTED JOB (sent to an external company)
──────────────────────────────────────────────────────────────────────────────
Used when a job (or part of a job) cannot be done in-house and must be sent to
an external service provider/party. It can be created standalone OR spun off
from an internal job card (carry over the vehicle + description).

State machine:

  DRAFT ──submit──▶ PENDING_REVIEW ──review──▶ PENDING_APPROVAL ──approve──▶ APPROVED
    ▲                    │ reject              │ reject                         │
    └────────────────────┴─────────────────────┘                              │
                                                                               ▼
  APPROVED → AUTOMATICALLY email the selected vendor/company + generate PDF.
  Vendor states:  SENT_TO_VENDOR → IN_PROGRESS → COMPLETED → CLOSED

Steps:
1. Assistant Mechanical Engineer prepares the service request and selects the
   external company/party (vendor) it should go to.
2. Mechanical Engineer reviews → approves the review or returns it.
3. Operational Manager approves → on approval the system AUTOMATICALLY:
     a. Generates a PDF copy of the service request (laid out like the company
        form, including Doc No. and signatures of preparer/reviewer/approver).
     b. Emails that PDF to the selected vendor's email address, with a covering
        message, and sends a copy (BCC) to the internal requesters.
     c. Stores the PDF against the record and makes it downloadable in-app.
4. Track vendor progress (optional manual updates) until COMPLETED → CLOSED.

──────────────────────────────────────────────────────────────────────────────
THE JOB CARD / REQUEST FORM FIELDS  (mirror the paper form exactly)
──────────────────────────────────────────────────────────────────────────────
Header (fixed): "Edward and Christie (Pvt) Ltd — 19 km Post, Giriulla Road,
Badalgama. Tel: 031 2269966, Email: badalgama@gmail.com"
Title: "Request for Repairing and Service of Vehicle and Machinery"

Editable fields:
- Date (auto-default to today, editable)
- Project / Plant            (text or dropdown from master data)
- Company Code               (prefix "ENC/" + value)
- Vehicle Reg. No.           (select from vehicle master, or free text)
- Vehicle / Machinery Meter  (number, e.g. odometer/hours)
- Repair type                (single choice: Accident / Running / Other + note)
- Expected completion date   (date, "after completing repair")
- Name of the Driver/Operator
- Contact No.                (phone)
- ECD No.
- Availability of documents (each Yes/No):
    1. Service and Repair Details of Vehicle and Machinery Book
    2. Running Chart Book
    3. Income Revenue License, Insurance Certificate
- Required service and repair details (free text / multi-line, e.g. "Full Service")
- Workflow signature blocks, auto-filled with the acting user's name +
  designation + timestamp (digital signature/initials) for:
    Prepared By  /  Reviewed By  /  Approved By
- Job Card No. (system-generated on approval; "use only for the workshop")
- Doc. No. footer: "EC40.WS.FO.1E:4:22.3"

For Workflow 2 also capture: selected Vendor/Company (name + email + contact),
and the email-sent status + timestamp.

──────────────────────────────────────────────────────────────────────────────
DATA MODEL (suggested core entities)
──────────────────────────────────────────────────────────────────────────────
- User(id, name, email, designation, role[], passwordHash, isActive)
- Vehicle(id, regNo, type, projectId, ecdNo, currentMeter, ...)
- Project/Plant(id, name, code)
- Vendor(id, companyName, email, contactNo, address)
- JobCard(id, jobCardNo, type[INTERNAL|OUTSOURCED], all form fields,
          status, vehicleId, projectId, preparedBy, reviewedBy, approvedBy,
          assignedTechnicianId, vendorId?, expectedDate, createdAt, ...)
- WorkLog(id, jobCardId, technicianId, action[START|HOLD|RESUME|END],
          timestamp, notes, partsUsed, labourHours, meterReading)
- Notification(id, userId, jobCardId, type, message, channel[INAPP|EMAIL],
               isRead, createdAt)
- AuditTrail(id, jobCardId, userId, fromState, toState, action, note, timestamp)
- Attachment(id, jobCardId, fileUrl, kind[PDF|PHOTO|DOC])

──────────────────────────────────────────────────────────────────────────────
NOTIFICATIONS
──────────────────────────────────────────────────────────────────────────────
- In-app notification bell + list, AND email for every key transition.
- Notify the NEXT actor when an item lands in their queue (e.g. TM when a card
  is submitted for review; OM when it is ready for approval).
- Notify the preparer when an item is returned/rejected (with comments).
- On INTERNAL job COMPLETED → notify Transport Officer + Transport Manager +
  Operational Manager to review.
- On OUTSOURCED job APPROVED → email the vendor + copy internal requesters.
- (Optional) WhatsApp notifications via WhatsApp Business API / Twilio, since
  staff already use WhatsApp.

──────────────────────────────────────────────────────────────────────────────
KEY SCREENS
──────────────────────────────────────────────────────────────────────────────
- Login (role-based redirect).
- Dashboard per role: "My queue / pending my action", counts by status.
- Create / Edit Job Card form (validation, autosave draft).
- Job Card detail: form data, timeline/audit trail, work log, attachments,
  action buttons gated by role + current state.
- Workshop board: Kanban-style columns (Queued / In Progress / On Hold /
  Completed) for technicians.
- Vendor service-request list + "Resend email" + "Download PDF".
- Admin: users & roles, vehicles, projects, vendors.
- Reports: jobs by status / vehicle / date range, average turnaround time,
  export to PDF/Excel.

──────────────────────────────────────────────────────────────────────────────
NON-FUNCTIONAL REQUIREMENTS
──────────────────────────────────────────────────────────────────────────────
- Secure authentication, hashed passwords, RBAC enforced server-side.
- Full audit trail (who did what, when) — immutable.
- Responsive UI (works on phone + desktop; staff are mobile-first).
- Input validation on client and server.
- Generated Job Card numbers are unique and sequential per year.
- All emails and PDFs are stored/logged for re-download.
- Seed data: roles, a few demo users (one per role), sample vehicles & vendors.

──────────────────────────────────────────────────────────────────────────────
RECOMMENDED TECH STACK (change if you prefer)
──────────────────────────────────────────────────────────────────────────────
- Frontend: React + TypeScript (Vite) with a component library (e.g. MUI/Tailwind).
- Backend: Node.js + NestJS (or Express) REST API.
- Database: PostgreSQL with an ORM (Prisma/TypeORM).
- Auth: JWT or session-based, with RBAC middleware.
- Email: Nodemailer over SMTP (or SendGrid).
- PDF: Puppeteer (HTML→PDF) or pdf-lib, templated to match the paper form.
- Deployment: Docker Compose (app + db) for easy on-prem/cloud hosting.

DELIVERABLES
- Running app (frontend + backend + db) with the two workflows above.
- Database migrations + seed script.
- README with setup, env vars (SMTP creds, DB url), and a demo login per role.
- Clean, documented, tested code (unit tests for the state machines + RBAC).

Build it incrementally and confirm the workflow state machines and the form
match this spec before adding reports and optional features.
```

---

## How to use this prompt
1. **To build it yourself / with another AI tool:** copy the fenced block above.
2. **To have me build it here:** just tell me the tech stack (or accept the
   recommended one) and I'll scaffold the project on this branch.

## Open decisions worth confirming
- **Tech stack** — accept the recommended React + NestJS + PostgreSQL, or specify your own.
- **Email provider** — company SMTP (e.g. the `badalgama@gmail.com` mailbox) vs. a service like SendGrid.
- **WhatsApp notifications** — include now, or add later.
- **Hosting** — on a company PC/server (on-prem) vs. cloud.
