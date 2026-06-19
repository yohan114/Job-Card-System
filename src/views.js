'use strict';

/** Server-rendered HTML views (template literals, no build step). */

const domain = require('./domain');
const { STATUS_LABELS, STATUS_TONE, TYPE_LABELS, ROLE_LABELS } = domain;

const COMPANY = {
  name: 'Edward and Christie (Pvt) Ltd',
  address: '19 km Post, Giriulla Road, Badalgama.',
  tel: '031 2269966',
  email: 'badalgama@gmail.com',
  docNo: 'EC40.WS.FO.1E:4:22.3',
};

// --- small helpers ---------------------------------------------------------
function e(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(v) {
  return e(v).replace(/\n/g, '<br>');
}

function fmtDate(v) {
  if (!v) return '';
  return String(v).slice(0, 10).replace(/-/g, '/');
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return e(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function badge(status) {
  return `<span class="badge tone-${STATUS_TONE[status] || 'gray'}">${e(STATUS_LABELS[status] || status)}</span>`;
}

function typeChip(type) {
  const cls = type === 'INTERNAL' ? 'chip-internal' : 'chip-outsourced';
  return `<span class="chip ${cls}">${e(TYPE_LABELS[type] || type)}</span>`;
}

function sig(s) {
  if (!s) return '<span class="muted">—</span>';
  return `${e(s.name)}<br><span class="muted small">${e(s.designation)} · ${fmtDateTime(s.at)}</span>`;
}

// --- layout ----------------------------------------------------------------
function navLinks(user) {
  const links = [['/', 'Dashboard'], ['/jobcards', 'All Jobs']];
  if (domain.canCreate(user, 'INTERNAL')) links.push(['/jobcards/new?type=internal', 'New Internal Job']);
  if (domain.canCreate(user, 'OUTSOURCED')) links.push(['/jobcards/new?type=outsourced', 'New Service Request']);
  if (domain.hasAnyRole(user, ['TECHNICIAN', 'TRANSPORT_MANAGER', 'OPERATIONAL_MANAGER', 'ADMIN'])) links.push(['/workshop', 'Workshop']);
  links.push(['/outbox', 'Email Outbox']);
  if (domain.hasAnyRole(user, ['TRANSPORT_MANAGER', 'MECH_ENGINEER', 'OPERATIONAL_MANAGER', 'ADMIN'])) links.push(['/reports', 'Reports']);
  if (domain.hasRole(user, 'ADMIN')) links.push(['/admin', 'Admin']);
  return links.map(([href, label]) => `<a href="${href}">${e(label)}</a>`).join('');
}

function layout({ title, user, body, flash, unread = 0 }) {
  const roleNames = user ? user.roles.map((r) => ROLE_LABELS[r] || r).join(', ') : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(title)} · Job Card System</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  ${user ? `<header class="topbar">
    <div class="brand"><a href="/">🛠️ Job Card System</a><span class="brand-sub">${e(COMPANY.name)}</span></div>
    <nav class="mainnav">${navLinks(user)}</nav>
    <div class="usermenu">
      <a class="bell" href="/notifications" title="Notifications">🔔${unread ? `<span class="bell-count">${unread}</span>` : ''}</a>
      <span class="who">${e(user.name)}<br><span class="muted small">${e(roleNames)}</span></span>
      <form method="post" action="/logout"><button class="btn btn-ghost btn-sm">Logout</button></form>
    </div>
  </header>` : ''}
  <main class="container">
    ${flash ? `<div class="flash flash-${e(flash.type)}">${e(flash.message)}</div>` : ''}
    ${body}
  </main>
  <footer class="foot muted small">Doc. No.: ${e(COMPANY.docNo)} · ${e(COMPANY.name)}</footer>
</body>
</html>`;
}

// --- login -----------------------------------------------------------------
function loginPage({ error } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login · Job Card System</title><link rel="stylesheet" href="/styles.css"></head>
<body class="login-body">
  <div class="login-card">
    <h1>Job Card System</h1>
    <p class="muted">${e(COMPANY.name)}</p>
    ${error ? `<div class="flash flash-error">${e(error)}</div>` : ''}
    <form method="post" action="/login">
      <label>Username<input name="username" autofocus required></label>
      <label>Password<input name="password" type="password" required></label>
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
    <details class="demo"><summary>Demo accounts (password: <code>password</code>)</summary>
      <ul>
        <li><code>tofficer</code> — Transport Officer</li>
        <li><code>tmanager</code> — Transport Manager</li>
        <li><code>ame</code> — Assistant Mechanical Engineer</li>
        <li><code>me</code> — Mechanical Engineer</li>
        <li><code>omanager</code> — Operational Manager</li>
        <li><code>tech</code> — Workshop Technician</li>
        <li><code>admin</code> — Administrator</li>
      </ul>
    </details>
  </div>
</body></html>`;
}

// --- dashboard -------------------------------------------------------------
function statCard(label, value, href) {
  return `<a class="stat" href="${href || '#'}"><span class="stat-value">${value}</span><span class="stat-label">${e(label)}</span></a>`;
}

function jobRow(card) {
  return `<tr>
    <td><a href="/jobcards/${card.id}">${e(card.no || '(draft)')}</a></td>
    <td>${typeChip(card.type)}</td>
    <td>${e(card.vehicleRegNo || '—')}</td>
    <td>${e(card.details ? card.details.slice(0, 40) : '')}</td>
    <td>${badge(card.status)}</td>
    <td class="muted small">${fmtDate(card.createdAt)}</td>
  </tr>`;
}

function jobTable(cards, emptyMsg) {
  if (!cards.length) return `<p class="muted">${e(emptyMsg || 'Nothing here yet.')}</p>`;
  return `<table class="table">
    <thead><tr><th>No.</th><th>Type</th><th>Vehicle</th><th>Details</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>${cards.map(jobRow).join('')}</tbody></table>`;
}

function dashboard({ user, queue, recent, stats }) {
  return `<div class="page-head"><h1>Dashboard</h1><p class="muted">Welcome, ${e(user.name)}.</p></div>
  <div class="stats">
    ${statCard('Pending my action', queue.length, '#queue')}
    ${statCard('Open jobs', stats.open, '/jobcards')}
    ${statCard('In workshop', stats.workshop, '/workshop')}
    ${statCard('Completed', stats.completed, '/jobcards?status=COMPLETED')}
  </div>
  <section id="queue" class="panel">
    <h2>Pending your action</h2>
    ${jobTable(queue, 'You have no jobs waiting on you. ✅')}
  </section>
  <section class="panel">
    <h2>Recent jobs</h2>
    ${jobTable(recent, 'No jobs created yet.')}
  </section>`;
}

// --- job list --------------------------------------------------------------
function jobList({ cards, filter }) {
  const opt = (val, label, cur) => `<option value="${val}" ${cur === val ? 'selected' : ''}>${e(label)}</option>`;
  const statusOpts = Object.keys(STATUS_LABELS).map((s) => opt(s, STATUS_LABELS[s], filter.status)).join('');
  return `<div class="page-head"><h1>All Jobs</h1></div>
  <form class="filters" method="get" action="/jobcards">
    <select name="type">${opt('', 'All types', filter.type)}${opt('INTERNAL', 'Internal', filter.type)}${opt('OUTSOURCED', 'Outsourced', filter.type)}</select>
    <select name="status">${opt('', 'All statuses', filter.status)}${statusOpts}</select>
    <button class="btn btn-secondary btn-sm" type="submit">Filter</button>
    <a class="btn btn-ghost btn-sm" href="/jobcards">Clear</a>
  </form>
  ${jobTable(cards, 'No jobs match this filter.')}`;
}

// --- job form --------------------------------------------------------------
function field(label, name, value, opts = {}) {
  const type = opts.type || 'text';
  const req = opts.required ? 'required' : '';
  return `<label class="fld">${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${req}></label>`;
}

function jobForm({ mode, type, card = {}, projects, vehicles, vendors, error }) {
  const isOut = type === 'OUTSOURCED';
  const action = mode === 'edit' ? `/jobcards/${card.id}/update` : '/jobcards';
  const sel = (cur) => (v) => `<option value="${v.id}" ${cur === v.id ? 'selected' : ''}>`;
  const projOpts = projects.map((p) => `<option value="${p.id}" ${card.projectId === p.id ? 'selected' : ''}>${e(p.name)}</option>`).join('');
  const vehOpts = vehicles.map((v) => `<option value="${v.id}" ${card.vehicleId === v.id ? 'selected' : ''}>${e(v.regNo)} — ${e(v.type)}</option>`).join('');
  const venOpts = vendors.map((v) => `<option value="${v.id}" ${card.vendorId === v.id ? 'selected' : ''}>${e(v.companyName)}</option>`).join('');
  const repairOpt = (v) => `<option value="${v}" ${card.repairType === v ? 'selected' : ''}>${v}</option>`;
  const chk = (val) => (val ? 'checked' : '');

  return `<div class="page-head"><h1>${mode === 'edit' ? 'Edit' : 'New'} ${e(TYPE_LABELS[type])}</h1>
    <p class="muted">Request for Repairing and Service of Vehicle and Machinery</p></div>
  ${error ? `<div class="flash flash-error">${e(error)}</div>` : ''}
  <form method="post" action="${action}" class="cardform panel">
    <input type="hidden" name="type" value="${type}">
    <div class="grid2">
      ${field('Date', 'date', card.date || '', { type: 'date', required: true })}
      <label class="fld">Project / Plant<select name="projectId"><option value="">— select —</option>${projOpts}</select></label>
      ${field('Company Code (ENC/…)', 'companyCode', card.companyCode || 'ENC/')}
      <label class="fld">Vehicle Reg. No.<select name="vehicleId"><option value="">— select —</option>${vehOpts}</select></label>
      ${field('Vehicle / Machinery Meter', 'meter', card.meter || '', { type: 'number' })}
      <label class="fld">Repair type<select name="repairType"><option value="">— select —</option>${repairOpt('Accident')}${repairOpt('Running')}${repairOpt('Other')}</select></label>
      ${field('Expected completion date', 'expectedDate', card.expectedDate || '', { type: 'date' })}
      ${field('Driver / Operator name', 'driverName', card.driverName || '')}
      ${field('Contact No.', 'contactNo', card.contactNo || '')}
      ${field('ECD No.', 'ecdNo', card.ecdNo || '')}
      ${isOut ? `<label class="fld">External Company / Vendor<select name="vendorId" required><option value="">— select —</option>${venOpts}</select></label>` : ''}
    </div>
    <fieldset class="docs">
      <legend>Availability of documents and records</legend>
      <label class="chk"><input type="checkbox" name="docServiceBook" ${chk(card.docServiceBook)}> Service & Repair Details Book</label>
      <label class="chk"><input type="checkbox" name="docRunningChart" ${chk(card.docRunningChart)}> Running Chart Book</label>
      <label class="chk"><input type="checkbox" name="docLicenseInsurance" ${chk(card.docLicenseInsurance)}> Revenue License & Insurance Certificate</label>
    </fieldset>
    <label class="fld">Required service and repair details
      <textarea name="details" rows="4" placeholder="e.g. Full Service">${e(card.details || '')}</textarea></label>
    <div class="formactions">
      <button class="btn btn-primary" type="submit">${mode === 'edit' ? 'Save changes' : 'Create job card'}</button>
      <a class="btn btn-ghost" href="/jobcards">Cancel</a>
    </div>
  </form>`;
}

// --- job detail ------------------------------------------------------------
function actionForm(card, def) {
  const tone = def.tone === 'danger' ? 'btn-danger' : def.tone === 'secondary' ? 'btn-secondary' : 'btn-primary';
  const isComplete = def.effect === 'completeInternal';
  const completion = isComplete
    ? `<div class="completion">
        <label class="fld">Work performed<textarea name="workDone" rows="2" required></textarea></label>
        <label class="fld">Parts used<input name="partsUsed"></label>
        <div class="grid2">
          <label class="fld">Labour hours<input name="labourHours" type="number" step="0.5"></label>
          <label class="fld">Final meter reading<input name="finalMeter" type="number"></label>
        </div>
      </div>`
    : '';
  const note = def.note
    ? `<textarea name="note" rows="2" placeholder="${def.note === 'required' ? 'Comment (required)' : 'Comment (optional)'}" ${def.note === 'required' ? 'required' : ''}></textarea>`
    : '';
  return `<form method="post" action="/jobcards/${card.id}/action" class="action-form">
    <input type="hidden" name="action" value="${def.action}">
    ${completion}${note}
    <button class="btn ${tone}" type="submit">${e(def.label)}</button>
  </form>`;
}

function kv(label, value) {
  return `<div class="kv"><span class="kv-k">${e(label)}</span><span class="kv-v">${value}</span></div>`;
}

function jobDetail({ card, actions, events, vendor, technician }) {
  const docs = [
    ['Service & Repair Details Book', card.docServiceBook],
    ['Running Chart Book', card.docRunningChart],
    ['Revenue License & Insurance', card.docLicenseInsurance],
  ].map(([l, v]) => `<li>${v ? '✅' : '⬜'} ${e(l)}</li>`).join('');

  const workshop = (card.startedAt || card.completedAt)
    ? `<section class="panel"><h2>Workshop</h2>
        ${kv('Technician', e(technician ? technician.name : '—'))}
        ${kv('Started', fmtDateTime(card.startedAt))}
        ${card.holdReason ? kv('On-hold reason', e(card.holdReason)) : ''}
        ${kv('Completed', fmtDateTime(card.completedAt))}
        ${card.workDone ? kv('Work performed', nl2br(card.workDone)) : ''}
        ${card.partsUsed ? kv('Parts used', e(card.partsUsed)) : ''}
        ${card.labourHours ? kv('Labour hours', e(card.labourHours)) : ''}
        ${card.finalMeter ? kv('Final meter', e(card.finalMeter)) : ''}
      </section>`
    : '';

  const vendorBlock = card.type === 'OUTSOURCED'
    ? `<section class="panel"><h2>Vendor / External Company</h2>
        ${kv('Company', e(card.vendorName || '—'))}
        ${kv('Email', vendor ? e(vendor.email) : '—')}
        ${kv('Contact', vendor ? e(vendor.contactNo) : '—')}
        ${kv('Email sent', card.emailSentAt ? fmtDateTime(card.emailSentAt) : '<span class="muted">not yet</span>')}
      </section>`
    : '';

  const timelineRows = events.map((ev) => `<li><span class="muted small">${fmtDateTime(ev.at)}</span> — <strong>${e(ev.userName)}</strong> ${e(ev.action)}${ev.toStatus ? ` → ${e(STATUS_LABELS[ev.toStatus] || ev.toStatus)}` : ''}${ev.note ? `<div class="note">“${e(ev.note)}”</div>` : ''}</li>`).join('');

  const actionPanel = actions.length
    ? `<section class="panel actions"><h2>Actions</h2>${actions.map((a) => actionForm(card, a)).join('')}</section>`
    : '';

  return `<div class="page-head detail-head">
    <div><h1>${e(card.no || 'Draft')} ${badge(card.status)}</h1>${typeChip(card.type)}</div>
    <div class="head-actions">
      <a class="btn btn-secondary btn-sm" href="/jobcards/${card.id}/print" target="_blank">🖨️ Print / PDF</a>
      ${card.status === 'DRAFT' ? `<a class="btn btn-ghost btn-sm" href="/jobcards/${card.id}/edit">Edit</a>` : ''}
    </div>
  </div>
  <div class="detail-grid">
    <div class="detail-main">
      <section class="panel"><h2>Request details</h2>
        ${kv('Date', fmtDate(card.date))}
        ${kv('Project / Plant', e(card.projectName || '—'))}
        ${kv('Company Code', e(card.companyCode || '—'))}
        ${kv('Vehicle Reg. No.', e(card.vehicleRegNo || '—'))}
        ${kv('Meter', e(card.meter || '—'))}
        ${kv('Repair type', e(card.repairType || '—'))}
        ${kv('Expected completion', fmtDate(card.expectedDate) || '—')}
        ${kv('Driver / Operator', e(card.driverName || '—'))}
        ${kv('Contact No.', e(card.contactNo || '—'))}
        ${kv('ECD No.', e(card.ecdNo || '—'))}
        ${kv('Documents', `<ul class="docs-list">${docs}</ul>`)}
        ${kv('Service & repair details', nl2br(card.details || '—'))}
      </section>
      ${workshop}
      ${vendorBlock}
      <section class="panel"><h2>Timeline</h2><ul class="timeline">${timelineRows || '<li class="muted">No activity yet.</li>'}</ul></section>
    </div>
    <aside class="detail-side">
      ${actionPanel}
      <section class="panel"><h2>Approvals</h2>
        ${kv('Prepared by', sig(card.preparedBy))}
        ${kv('Reviewed by', sig(card.reviewedBy))}
        ${kv('Approved by', sig(card.approvedBy))}
      </section>
    </aside>
  </div>`;
}

// --- workshop board --------------------------------------------------------
function workshopBoard({ columns }) {
  const col = (key, label, cards) => `<div class="wcol">
    <h3>${e(label)} <span class="count">${cards.length}</span></h3>
    ${cards.map((c) => `<a class="wcard" href="/jobcards/${c.id}">
        <strong>${e(c.no || '(draft)')}</strong>
        <span>${e(c.vehicleRegNo || '—')}</span>
        <span class="muted small">${e(c.details ? c.details.slice(0, 50) : '')}</span>
      </a>`).join('') || '<p class="muted small">—</p>'}
  </div>`;
  return `<div class="page-head"><h1>Workshop Board</h1><p class="muted">Internal jobs routed from approvals.</p></div>
  <div class="board">
    ${col('APPROVED', 'Queued', columns.APPROVED)}
    ${col('IN_PROGRESS', 'In Progress', columns.IN_PROGRESS)}
    ${col('ON_HOLD', 'On Hold', columns.ON_HOLD)}
    ${col('COMPLETED', 'Completed', columns.COMPLETED)}
  </div>`;
}

// --- notifications ---------------------------------------------------------
function notificationsPage({ items }) {
  const rows = items.map((n) => `<li class="${n.read ? '' : 'unread'}">
      <a href="${n.jobCardId ? `/jobcards/${n.jobCardId}` : '#'}">${e(n.message)}</a>
      <span class="muted small">${fmtDateTime(n.at)}</span>
    </li>`).join('');
  return `<div class="page-head"><h1>Notifications</h1>
    <form method="post" action="/notifications/read-all"><button class="btn btn-ghost btn-sm">Mark all read</button></form></div>
  <ul class="notif-list">${rows || '<li class="muted">No notifications.</li>'}</ul>`;
}

// --- outbox ----------------------------------------------------------------
function mailBadge(status) {
  const tone = status === 'sent' ? 'green' : status === 'failed' ? 'red' : status === 'queued' ? 'blue' : 'gray';
  return `<span class="badge tone-${tone}">${e(status || 'simulated')}</span>`;
}

function outboxPage({ items, live }) {
  const rows = items.map((m) => `<tr>
      <td><a href="/outbox/${m.id}">${e(m.subject)}</a></td>
      <td>${e(m.to)}</td>
      <td>${e(m.jobNo || '')}</td>
      <td>${mailBadge(m.status)}</td>
      <td class="muted small">${fmtDateTime(m.at)}</td>
    </tr>`).join('');
  const banner = live
    ? `<div class="flash flash-success">📧 <strong>Live email is ON.</strong> Approved service requests are emailed to vendors for real via SMTP.</div>`
    : `<div class="flash flash-error">📭 <strong>Simulated mode.</strong> Emails are recorded here but not actually sent. See README → “Sending real email through Gmail” to connect your company Gmail.</div>`;
  return `<div class="page-head"><h1>Email Outbox</h1><p class="muted">Vendor service-request emails generated by the system.</p></div>
  ${banner}
  ${items.length ? `<table class="table"><thead><tr><th>Subject</th><th>To</th><th>Job No.</th><th>Status</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No emails yet.</p>'}`;
}

function outboxDetail({ mail }) {
  const att = (mail.attachments || []).map((a) => `📎 ${e(a.name)}`).join(' · ');
  return `<div class="page-head"><h1>${e(mail.subject)}</h1></div>
  <div class="panel email-view">
    ${kv('Status', mailBadge(mail.status))}
    ${mail.error ? kv('Error', `<span class="tone-red">${e(mail.error)}</span>`) : ''}
    ${kv('To', e(mail.to))}
    ${kv('Cc', e(mail.cc || '—'))}
    ${kv('Time', fmtDateTime(mail.at))}
    ${kv('Attachments', att || '—')}
    <hr>
    <pre class="email-body">${e(mail.body)}</pre>
  </div>
  <a class="btn btn-ghost btn-sm" href="/outbox">← Back to outbox</a>`;
}

// --- reports ---------------------------------------------------------------
function reportsPage({ stats }) {
  const row = (label, val) => `<tr><td>${e(label)}</td><td>${val}</td></tr>`;
  const byStatus = Object.keys(STATUS_LABELS).map((s) => row(STATUS_LABELS[s], stats.byStatus[s] || 0)).join('');
  return `<div class="page-head"><h1>Reports</h1></div>
  <div class="stats">
    ${statCard('Total jobs', stats.total)}
    ${statCard('Internal', stats.internal)}
    ${statCard('Outsourced', stats.outsourced)}
    ${statCard('Avg. turnaround (days)', stats.avgTurnaround)}
  </div>
  <section class="panel"><h2>Jobs by status</h2>
    <table class="table"><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${byStatus}</tbody></table>
  </section>`;
}

// --- admin -----------------------------------------------------------------
function adminPage({ users, vehicles, vendors, projects }) {
  const userRows = users.map((u) => `<tr><td>${e(u.username)}</td><td>${e(u.name)}</td><td>${e(u.roles.map((r) => ROLE_LABELS[r] || r).join(', '))}</td><td>${u.active ? 'Active' : 'Disabled'}</td></tr>`).join('');
  const vehRows = vehicles.map((v) => `<tr><td>${e(v.regNo)}</td><td>${e(v.type)}</td><td>${e(v.ecdNo || '')}</td><td>${e(v.currentMeter || '')}</td></tr>`).join('');
  const venRows = vendors.map((v) => `<tr><td>${e(v.companyName)}</td><td>${e(v.email)}</td><td>${e(v.contactNo || '')}</td></tr>`).join('');
  const prjRows = projects.map((p) => `<tr><td>${e(p.name)}</td><td>${e(p.code || '')}</td></tr>`).join('');
  return `<div class="page-head"><h1>Administration</h1></div>
  <section class="panel"><h2>Users</h2>
    <table class="table"><thead><tr><th>Username</th><th>Name</th><th>Roles</th><th>Status</th></tr></thead><tbody>${userRows}</tbody></table>
  </section>
  <section class="panel"><h2>Vehicles / Machinery</h2>
    <table class="table"><thead><tr><th>Reg No.</th><th>Type</th><th>ECD No.</th><th>Meter</th></tr></thead><tbody>${vehRows}</tbody></table>
    <form class="inline-form" method="post" action="/admin/vehicles">
      <input name="regNo" placeholder="Reg No." required>
      <input name="type" placeholder="Type">
      <input name="ecdNo" placeholder="ECD No.">
      <button class="btn btn-secondary btn-sm">Add vehicle</button>
    </form>
  </section>
  <section class="panel"><h2>Vendors / External Companies</h2>
    <table class="table"><thead><tr><th>Company</th><th>Email</th><th>Contact</th></tr></thead><tbody>${venRows}</tbody></table>
    <form class="inline-form" method="post" action="/admin/vendors">
      <input name="companyName" placeholder="Company name" required>
      <input name="email" placeholder="Email" type="email" required>
      <input name="contactNo" placeholder="Contact">
      <button class="btn btn-secondary btn-sm">Add vendor</button>
    </form>
  </section>
  <section class="panel"><h2>Projects / Plants</h2>
    <table class="table"><thead><tr><th>Name</th><th>Code</th></tr></thead><tbody>${prjRows}</tbody></table>
    <form class="inline-form" method="post" action="/admin/projects">
      <input name="name" placeholder="Project name" required>
      <input name="code" placeholder="Code">
      <button class="btn btn-secondary btn-sm">Add project</button>
    </form>
  </section>`;
}

// --- printable form (PDF copy) --------------------------------------------
function printForm({ card }) {
  const yn = (v) => `<span class="cell">${v ? '✔' : ''}</span><span class="cell">${v ? '' : '✔'}</span>`;
  const sigCell = (s) => s
    ? `<div class="sgn">${e(s.name)}</div><div class="sgn-sub">${e(s.designation)}</div><div class="sgn-sub">${fmtDate(s.at)}</div>`
    : '<div class="sgn">&nbsp;</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${e(card.no || 'Request')} — Service Request</title>
<style>
  body{font-family:"Times New Roman",Georgia,serif;color:#000;margin:24px;font-size:13px}
  .sheet{max-width:760px;margin:auto;border:1px solid #000;padding:14px 18px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:6px}
  .co{font-weight:bold;font-size:16px}
  .co small{display:block;font-weight:normal;font-size:11px}
  .title{text-align:right;font-weight:bold}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  td,th{border:1px solid #000;padding:4px 6px;vertical-align:top}
  .label{width:38%;font-weight:bold}
  .docs td{width:60%}.docs .cell{display:inline-block;width:28px;text-align:center;border-left:1px solid #000}
  .sgnrow td{height:64px;text-align:center;vertical-align:bottom}
  .sgn{border-top:1px solid #000;padding-top:2px;font-weight:bold}
  .sgn-sub{font-size:10px}
  .foot{display:flex;justify-content:space-between;margin-top:8px;font-size:10px}
  .noprint{margin:auto;max-width:760px;text-align:right;margin-bottom:10px}
  .btn{padding:8px 14px;background:#0b5;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:14px}
  @media print{.noprint{display:none}body{margin:0}.sheet{border:none}}
</style></head>
<body>
  <div class="noprint"><button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button></div>
  <div class="sheet">
    <div class="head">
      <div class="co">${e(COMPANY.name)}<small>${e(COMPANY.address)} Tel: ${e(COMPANY.tel)} · ${e(COMPANY.email)}</small></div>
      <div class="title">Request for Repairing and Service<br>of Vehicle and Machinery</div>
    </div>
    <table>
      <tr><td class="label">Date</td><td>${fmtDate(card.date)}</td><td class="label">Company Code</td><td>${e(card.companyCode || '')}</td></tr>
      <tr><td class="label">Project / Plant</td><td>${e(card.projectName || '')}</td><td class="label">Vehicle Reg. No.</td><td>${e(card.vehicleRegNo || '')}</td></tr>
      <tr><td class="label">Vehicle / Machinery Meter</td><td>${e(card.meter || '')}</td><td class="label">Repair type</td><td>${e(card.repairType || '')}</td></tr>
      <tr><td class="label">Driver / Operator</td><td>${e(card.driverName || '')}</td><td class="label">Contact No.</td><td>${e(card.contactNo || '')}</td></tr>
      <tr><td class="label">ECD No.</td><td>${e(card.ecdNo || '')}</td><td class="label">Expected completion</td><td>${fmtDate(card.expectedDate)}</td></tr>
      ${card.type === 'OUTSOURCED' ? `<tr><td class="label">External Company</td><td colspan="3">${e(card.vendorName || '')}</td></tr>` : ''}
    </table>
    <table class="docs">
      <tr><th style="text-align:left">Availability of following documents and records</th><th>Yes</th><th>No</th></tr>
      <tr><td>1. Service and Repair Details of Vehicle and Machinery Book</td>${yn(card.docServiceBook)}</tr>
      <tr><td>2. Running Chart Book</td>${yn(card.docRunningChart)}</tr>
      <tr><td>3. Income Revenue License, Insurance Certificate</td>${yn(card.docLicenseInsurance)}</tr>
    </table>
    <table><tr><td class="label">Required service and repair details</td><td>${nl2br(card.details || '')}</td></tr></table>
    <table class="sgnrow">
      <tr><th>Prepared By</th><th>Reviewed By</th><th>Approved By</th></tr>
      <tr><td>${sigCell(card.preparedBy)}</td><td>${sigCell(card.reviewedBy)}</td><td>${sigCell(card.approvedBy)}</td></tr>
    </table>
    <div class="foot"><span>Job Card No.: <strong>${e(card.no || '________')}</strong></span><span>Doc. No.: ${e(COMPANY.docNo)}</span><span>Page 1 of 1</span></div>
  </div>
</body></html>`;
}

module.exports = {
  COMPANY,
  layout,
  loginPage,
  dashboard,
  jobList,
  jobForm,
  jobDetail,
  workshopBoard,
  notificationsPage,
  outboxPage,
  outboxDetail,
  reportsPage,
  adminPage,
  printForm,
};
