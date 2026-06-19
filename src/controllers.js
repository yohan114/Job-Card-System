'use strict';

/** Request handlers. Each receives a `ctx` built by server.js. */

const db = require('./db');
const domain = require('./domain');
const auth = require('./auth');
const views = require('./views');
const jobs = require('./jobcards');
const notify = require('./notifications');
const mailer = require('./mailer');

const { TYPES } = domain;

function typeFromQuery(q) {
  return (q.type || '').toUpperCase() === 'OUTSOURCED' ? TYPES.OUTSOURCED : TYPES.INTERNAL;
}

// --- auth ------------------------------------------------------------------
function showLogin(ctx) {
  if (ctx.user) return ctx.redirect('/');
  ctx.raw(views.loginPage({}));
}

function login(ctx) {
  const { username, password } = ctx.body;
  const user = db.where('users', (u) => u.username === username && u.active)[0];
  if (!user || !auth.verifyPassword(password || '', user.password)) {
    return ctx.raw(views.loginPage({ error: 'Invalid username or password.' }), 401);
  }
  auth.createSession(ctx.res, user.id);
  ctx.redirect('/');
}

function logout(ctx) {
  auth.destroySession(ctx.req, ctx.res);
  ctx.redirect('/login');
}

// --- dashboard -------------------------------------------------------------
function home(ctx) {
  const all = jobs.list();
  const stats = {
    open: all.filter((c) => c.status !== domain.STATUS.CLOSED).length,
    workshop: all.filter((c) => ['APPROVED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status)).length,
    completed: all.filter((c) => c.status === domain.STATUS.COMPLETED).length,
  };
  ctx.render('Dashboard', views.dashboard({
    user: ctx.user,
    queue: jobs.myQueue(ctx.user),
    recent: all.slice(0, 8),
    stats,
  }));
}

// --- job cards -------------------------------------------------------------
function listJobs(ctx) {
  const filter = { type: ctx.query.type || '', status: ctx.query.status || '' };
  ctx.render('All Jobs', views.jobList({ cards: jobs.list(filter), filter }));
}

function masterData() {
  return {
    projects: db.all('projects'),
    vehicles: db.all('vehicles'),
    vendors: db.all('vendors'),
  };
}

function newJob(ctx) {
  const type = typeFromQuery(ctx.query);
  if (!domain.canCreate(ctx.user, type)) return ctx.forbidden('You are not allowed to create this type of job.');
  ctx.render('New Job', views.jobForm({ mode: 'new', type, ...masterData() }));
}

function createJob(ctx) {
  const type = (ctx.body.type || '').toUpperCase() === TYPES.OUTSOURCED ? TYPES.OUTSOURCED : TYPES.INTERNAL;
  if (!domain.canCreate(ctx.user, type)) return ctx.forbidden('You are not allowed to create this type of job.');
  if (type === TYPES.OUTSOURCED && !ctx.body.vendorId) {
    ctx.flash('error', 'Please select an external company/vendor.');
    return ctx.render('New Job', views.jobForm({ mode: 'new', type, error: 'Please select an external company/vendor.', card: ctx.body, ...masterData() }));
  }
  const card = jobs.createJobCard(ctx.user, type, ctx.body);
  ctx.flash('success', 'Job card created as draft. Submit it for review when ready.');
  ctx.redirect(`/jobcards/${card.id}`);
}

function showJob(ctx) {
  const card = jobs.get(ctx.params.id);
  if (!card) return ctx.notFound();
  ctx.render(card.no || 'Job Card', views.jobDetail({
    card,
    actions: domain.availableActions(card, ctx.user),
    events: jobs.timeline(card.id),
    vendor: card.vendorId ? db.find('vendors', card.vendorId) : null,
    technician: card.assignedTechnicianId ? db.find('users', card.assignedTechnicianId) : null,
  }));
}

function editJob(ctx) {
  const card = jobs.get(ctx.params.id);
  if (!card) return ctx.notFound();
  if (card.status !== domain.STATUS.DRAFT) return ctx.forbidden('Only draft job cards can be edited.');
  if (card.createdBy !== ctx.user.id && !domain.hasRole(ctx.user, 'ADMIN')) return ctx.forbidden('Only the preparer can edit this draft.');
  ctx.render('Edit Job', views.jobForm({ mode: 'edit', type: card.type, card, ...masterData() }));
}

function updateJob(ctx) {
  const card = jobs.get(ctx.params.id);
  if (!card) return ctx.notFound();
  if (card.status !== domain.STATUS.DRAFT) return ctx.forbidden('Only draft job cards can be edited.');
  jobs.updateJobCard(card, ctx.body);
  ctx.flash('success', 'Job card updated.');
  ctx.redirect(`/jobcards/${card.id}`);
}

function doAction(ctx) {
  const card = jobs.get(ctx.params.id);
  if (!card) return ctx.notFound();
  const payload = {
    note: ctx.body.note,
    baseUrl: ctx.baseUrl,
    workDone: ctx.body.workDone,
    partsUsed: ctx.body.partsUsed,
    labourHours: ctx.body.labourHours,
    finalMeter: ctx.body.finalMeter,
  };
  const result = jobs.performAction(card, ctx.body.action, ctx.user, payload);
  if (result.error) ctx.flash('error', result.error);
  else ctx.flash('success', 'Done.');
  ctx.redirect(`/jobcards/${card.id}`);
}

function printJob(ctx) {
  const card = jobs.get(ctx.params.id);
  if (!card) return ctx.notFound();
  ctx.raw(views.printForm({ card }));
}

// --- workshop --------------------------------------------------------------
function workshop(ctx) {
  const internal = jobs.list({ type: TYPES.INTERNAL });
  const columns = {
    APPROVED: internal.filter((c) => c.status === 'APPROVED'),
    IN_PROGRESS: internal.filter((c) => c.status === 'IN_PROGRESS'),
    ON_HOLD: internal.filter((c) => c.status === 'ON_HOLD'),
    COMPLETED: internal.filter((c) => c.status === 'COMPLETED'),
  };
  ctx.render('Workshop', views.workshopBoard({ columns }));
}

// --- notifications ---------------------------------------------------------
function listNotifs(ctx) {
  ctx.render('Notifications', views.notificationsPage({ items: notify.listFor(ctx.user.id) }));
}

function readAllNotifs(ctx) {
  notify.markAllRead(ctx.user.id);
  ctx.redirect('/notifications');
}

// --- outbox ----------------------------------------------------------------
function listOutbox(ctx) {
  ctx.render('Email Outbox', views.outboxPage({ items: mailer.listOutbox() }));
}

function showMail(ctx) {
  const mail = db.find('outbox', ctx.params.id);
  if (!mail) return ctx.notFound();
  ctx.render(mail.subject, views.outboxDetail({ mail }));
}

// --- reports ---------------------------------------------------------------
function reports(ctx) {
  const all = jobs.list();
  const byStatus = {};
  all.forEach((c) => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  const done = all.filter((c) => c.completedAt && c.createdAt);
  const avg = done.length
    ? (done.reduce((sum, c) => sum + (new Date(c.completedAt) - new Date(c.createdAt)), 0) / done.length / 86400000)
    : 0;
  ctx.render('Reports', views.reportsPage({
    stats: {
      total: all.length,
      internal: all.filter((c) => c.type === TYPES.INTERNAL).length,
      outsourced: all.filter((c) => c.type === TYPES.OUTSOURCED).length,
      avgTurnaround: avg ? avg.toFixed(1) : '—',
      byStatus,
    },
  }));
}

// --- admin -----------------------------------------------------------------
function adminHome(ctx) {
  ctx.render('Admin', views.adminPage({
    users: db.all('users'),
    vehicles: db.all('vehicles'),
    vendors: db.all('vendors'),
    projects: db.all('projects'),
  }));
}

function addVehicle(ctx) {
  db.insert('vehicles', { regNo: ctx.body.regNo, type: ctx.body.type || '', ecdNo: ctx.body.ecdNo || '', currentMeter: Number(ctx.body.meter) || 0 });
  ctx.flash('success', 'Vehicle added.');
  ctx.redirect('/admin');
}

function addVendor(ctx) {
  db.insert('vendors', { companyName: ctx.body.companyName, email: ctx.body.email, contactNo: ctx.body.contactNo || '', address: ctx.body.address || '' });
  ctx.flash('success', 'Vendor added.');
  ctx.redirect('/admin');
}

function addProject(ctx) {
  db.insert('projects', { name: ctx.body.name, code: ctx.body.code || '' });
  ctx.flash('success', 'Project added.');
  ctx.redirect('/admin');
}

module.exports = {
  showLogin, login, logout,
  home,
  listJobs, newJob, createJob, showJob, editJob, updateJob, doAction, printJob,
  workshop,
  listNotifs, readAllNotifs,
  listOutbox, showMail,
  reports,
  adminHome, addVehicle, addVendor, addProject,
};
