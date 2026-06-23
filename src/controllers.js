'use strict';

/** Request handlers. Each receives a `ctx` built by server.js. */

const db = require('./db');
const domain = require('./domain');
const auth = require('./auth');
const views = require('./views');
const jobs = require('./jobcards');
const notify = require('./notifications');
const mailer = require('./mailer');
const mrnSvc = require('./mrns');
const itemSvc = require('./items');

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
    internalJobs: jobs.eligibleForOutsourcing(),
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
  if (type === TYPES.OUTSOURCED) {
    let err = null;
    if (!ctx.body.linkedJobId) err = 'Please select the internal job this service request relates to.';
    else if (!ctx.body.vendorId) err = 'Please select an external company/vendor.';
    if (err) {
      ctx.flash('error', err);
      return ctx.render('New Job', views.jobForm({ mode: 'new', type, error: err, card: ctx.body, ...masterData() }));
    }
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
  ctx.render('Email Outbox', views.outboxPage({ items: mailer.listOutbox(), live: mailer.isLive() }));
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

// --- account / password ----------------------------------------------------
function showChangePassword(ctx) {
  ctx.render('Change Password', views.changePasswordPage({ mustChange: !!ctx.user.mustChangePassword }));
}

function changePassword(ctx) {
  const { current, next, confirm } = ctx.body;
  const u = ctx.user;
  let err = null;
  if (!auth.verifyPassword(current || '', u.password)) err = 'Your current password is incorrect.';
  else if (!next || next.length < 6) err = 'New password must be at least 6 characters.';
  else if (next !== confirm) err = 'New password and confirmation do not match.';
  else if (next === current) err = 'New password must be different from the current one.';
  if (err) { ctx.flash('error', err); return ctx.redirect('/account/password'); }
  db.update('users', u.id, { password: auth.hashPassword(next), mustChangePassword: false });
  ctx.flash('success', 'Your password has been updated.');
  ctx.redirect('/');
}

// --- admin -----------------------------------------------------------------
function adminHome(ctx) {
  ctx.render('Admin', views.adminPage({
    users: db.all('users'),
    vehicles: db.all('vehicles'),
    vendors: db.all('vendors'),
    projects: db.all('projects'),
    roles: Object.values(domain.ROLES).map((v) => ({ value: v, label: domain.ROLE_LABELS[v] || v })),
  }));
}

function addUser(ctx) {
  const { username, name, designation, email, role, password } = ctx.body;
  if (!username || !password) { ctx.flash('error', 'Username and temporary password are required.'); return ctx.redirect('/admin'); }
  if (password.length < 6) { ctx.flash('error', 'Temporary password must be at least 6 characters.'); return ctx.redirect('/admin'); }
  if (db.where('users', (u) => u.username.toLowerCase() === username.toLowerCase()).length) {
    ctx.flash('error', `Username "${username}" already exists.`);
    return ctx.redirect('/admin');
  }
  db.insert('users', {
    username,
    name: name || username,
    designation: designation || '',
    email: email || '',
    roles: role ? [role] : [],
    password: auth.hashPassword(password),
    active: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  });
  ctx.flash('success', `User "${username}" created. They must change the temporary password at first login.`);
  ctx.redirect('/admin');
}

function resetPassword(ctx) {
  const u = db.find('users', ctx.params.id);
  if (!u) return ctx.notFound();
  const pw = ctx.body.password || '';
  if (pw.length < 6) { ctx.flash('error', 'Temporary password must be at least 6 characters.'); return ctx.redirect('/admin'); }
  db.update('users', u.id, { password: auth.hashPassword(pw), mustChangePassword: true });
  ctx.flash('success', `Password reset for "${u.username}". They must change it at next login.`);
  ctx.redirect('/admin');
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

// --- MRNs ------------------------------------------------------------------
function listMrns(ctx) {
  const filter = {
    vehicle: ctx.query.vehicle || '',
    category: ctx.query.category || '',
    status: ctx.query.status || '',
    jobNo: ctx.query.jobNo || '',
    unpriced: ctx.query.unpriced || '',
  };
  let mrns = db.all('mrns');
  if (filter.vehicle) mrns = mrns.filter((m) => (m.vehicleMachinery || '').toLowerCase().includes(filter.vehicle.toLowerCase()));
  if (filter.category) mrns = mrns.filter((m) => m.category === filter.category);
  if (filter.status) mrns = mrns.filter((m) => m.status === filter.status);
  if (filter.jobNo) mrns = mrns.filter((m) => m.jobNo === filter.jobNo);
  if (filter.unpriced === '1') mrns = mrns.filter((m) => m.hasUnpriced);
  mrns = mrns.slice().sort((a, b) => (b.reqDate || '').localeCompare(a.reqDate || ''));
  ctx.render('MRN / Parts', views.mrnList({ mrns, filter, categories: itemSvc.CATEGORIES }));
}

function newMrn(ctx) {
  ctx.render('New MRN', views.mrnForm({
    mode: 'new',
    vehicles: db.all('vehicles'),
    categories: itemSvc.CATEGORIES,
    prefill: ctx.query,
  }));
}

function createMrn(ctx) {
  const mrn = mrnSvc.createMrn(ctx.body, ctx.user);
  ctx.flash('success', 'MRN created.');
  ctx.redirect(`/mrns/${mrn.id}`);
}

function showMrn(ctx) {
  const raw = db.find('mrns', ctx.params.id);
  if (!raw) return ctx.notFound();
  const mrn = mrnSvc.enrichMrn(raw);
  ctx.render(`MRN ${mrn.mrnNum || mrn.id}`, views.mrnDetail({ mrn }));
}

function receiveMrn(ctx) {
  const mrn = db.find('mrns', ctx.params.id);
  if (!mrn) return ctx.notFound();
  mrnSvc.addReceipt(ctx.params.id, { ...ctx.body, transactionType: 'Receive' }, ctx.user);
  ctx.flash('success', 'Receipt recorded.');
  ctx.redirect(`/mrns/${ctx.params.id}`);
}

function returnMrn(ctx) {
  const mrn = db.find('mrns', ctx.params.id);
  if (!mrn) return ctx.notFound();
  mrnSvc.addReceipt(ctx.params.id, { ...ctx.body, transactionType: 'Return' }, ctx.user);
  ctx.flash('success', 'Return recorded.');
  ctx.redirect(`/mrns/${ctx.params.id}`);
}

function priceMrnReceipt(ctx) {
  const receipt = db.find('receipts', ctx.params.rid);
  if (!receipt || receipt.mrnId !== ctx.params.id) return ctx.notFound();
  const price = parseFloat(ctx.body.unitPrice);
  if (isNaN(price) || price < 0) { ctx.flash('error', 'Enter a valid price.'); return ctx.redirect(`/mrns/${ctx.params.id}`); }
  mrnSvc.updatePrice(ctx.params.rid, price, ctx.user);
  ctx.flash('success', 'Price updated.');
  ctx.redirect(`/mrns/${ctx.params.id}`);
}

// --- Items -----------------------------------------------------------------
function listItems(ctx) {
  const q = ctx.query.q || '';
  const cat = ctx.query.category || '';
  let items = itemSvc.allItems();
  if (q) items = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  if (cat) items = items.filter((i) => i.category === cat);
  ctx.render('Item Catalog', views.itemList({ items, q, cat, categories: itemSvc.CATEGORIES }));
}

function newItem(ctx) {
  ctx.render('New Item', views.itemForm({ categories: itemSvc.CATEGORIES }));
}

function createItem(ctx) {
  const { item, error } = itemSvc.createItem(ctx.body, ctx.user);
  if (error) { ctx.flash('error', error); return ctx.redirect('/items/new'); }
  ctx.flash('success', `Item "${item.name}" added to catalog.`);
  ctx.redirect('/items');
}

function itemsAutocomplete(ctx) {
  const results = itemSvc.searchItems(ctx.query.q || '').map((i) => ({
    id: i.id, name: i.name, category: i.category, unit: i.unit,
  }));
  ctx.res.setHeader('Content-Type', 'application/json');
  ctx.res.end(JSON.stringify(results));
}

// --- Cost summary ----------------------------------------------------------
function costSummary(ctx) {
  // Group MRNs by jobNo and compute totals
  const allMrns = db.all('mrns').filter((m) => m.jobNo);
  const byJob = {};
  for (const m of allMrns) {
    if (!byJob[m.jobNo]) byJob[m.jobNo] = { jobNo: m.jobNo, mrns: [], partsCost: 0, unpricedLines: 0, mrnCount: 0 };
    const receipts = db.where('receipts', (r) => r.mrnId === m.id);
    const c = mrnSvc.mrnCost(receipts);
    byJob[m.jobNo].partsCost += c.total;
    byJob[m.jobNo].unpricedLines += c.unpricedLines;
    byJob[m.jobNo].mrnCount++;
  }
  const rows = Object.values(byJob).sort((a, b) => b.partsCost - a.partsCost);
  ctx.render('Cost Summary', views.costSummaryPage({ rows }));
}

function costDetail(ctx) {
  const jobNo = decodeURIComponent(ctx.params.jobNo);
  const mrns = db.where('mrns', (m) => m.jobNo === jobNo).map(mrnSvc.enrichMrn);
  if (!mrns.length) return ctx.notFound();
  const stats = mrnSvc.mrnStats(jobNo);
  ctx.render(`Cost: ${jobNo}`, views.costDetailPage({ jobNo, mrns, stats }));
}

module.exports = {
  showLogin, login, logout,
  home,
  listJobs, newJob, createJob, showJob, editJob, updateJob, doAction, printJob,
  workshop,
  listNotifs, readAllNotifs,
  listOutbox, showMail,
  reports,
  showChangePassword, changePassword,
  adminHome, addUser, resetPassword, addVehicle, addVendor, addProject,
  // MRNs
  listMrns, newMrn, createMrn, showMrn, receiveMrn, returnMrn, priceMrnReceipt,
  // Items
  listItems, newItem, createItem, itemsAutocomplete,
  // Costs
  costSummary, costDetail,
};
