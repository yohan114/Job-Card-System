'use strict';

/**
 * Job-card service: creation, editing and the workflow transition engine.
 * All status changes flow through performAction(), which validates the
 * transition against domain rules, applies side effects, writes an immutable
 * audit entry, and fires notifications / vendor email.
 */

const db = require('./db');
const domain = require('./domain');
const notify = require('./notifications');
const mailer = require('./mailer');

const { STATUS, TYPES, ROLES } = domain;

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function signature(user) {
  return { userId: user.id, name: user.name, designation: user.designation, at: now() };
}

function projectName(id) {
  const p = id && db.find('projects', id);
  return p ? p.name : '';
}
function vehicleReg(id) {
  const v = id && db.find('vehicles', id);
  return v ? v.regNo : '';
}
function vendorName(id) {
  const v = id && db.find('vendors', id);
  return v ? v.companyName : '';
}

// Find an existing vehicle by reg number, or create one on the fly (typeable).
function resolveVehicle(form) {
  if (form.vehicleId) {
    const v = db.find('vehicles', form.vehicleId);
    if (v) return { vehicleId: v.id, vehicleRegNo: v.regNo };
  }
  const typed = (form.vehicleRegNo || '').trim();
  if (!typed) return { vehicleId: null, vehicleRegNo: '' };
  let v = db.all('vehicles').find((x) => x.regNo.toLowerCase() === typed.toLowerCase());
  if (!v) {
    v = db.insert('vehicles', { regNo: typed, type: form.vehicleType || '', projectId: form.projectId || null, ecdNo: form.ecdNo || '', currentMeter: Number(form.meter) || 0 });
  }
  return { vehicleId: v.id, vehicleRegNo: v.regNo };
}

// Fields the preparer may set on create / while in DRAFT.
function readForm(form, type) {
  const base = {
    date: form.date || today(),
    projectId: form.projectId || null,
    projectName: projectName(form.projectId) || form.projectName || '',
    companyCode: form.companyCode || '',
    vehicleId: null,
    vehicleRegNo: '',
    meter: form.meter || '',
    repairType: form.repairType || '',
    repairTypeNote: form.repairTypeNote || '',
    expectedDate: form.expectedDate || '',
    driverName: form.driverName || '',
    contactNo: form.contactNo || '',
    ecdNo: form.ecdNo || '',
    docServiceBook: form.docServiceBook === 'on' || form.docServiceBook === true,
    docRunningChart: form.docRunningChart === 'on' || form.docRunningChart === true,
    docLicenseInsurance: form.docLicenseInsurance === 'on' || form.docLicenseInsurance === true,
    details: form.details || '',
    vendorId: null,
    vendorName: '',
    linkedJobId: null,
    linkedJobNo: null,
  };

  if (type === TYPES.OUTSOURCED) {
    // An outside request is raised against an existing (non-closed) internal job;
    // the vehicle and job context are copied from it.
    base.vendorId = form.vendorId || null;
    base.vendorName = vendorName(form.vendorId);
    const linked = form.linkedJobId ? db.find('jobcards', form.linkedJobId) : null;
    if (linked) {
      base.linkedJobId = linked.id;
      base.linkedJobNo = linked.no || null;
      base.vehicleId = linked.vehicleId;
      base.vehicleRegNo = linked.vehicleRegNo;
      base.projectId = base.projectId || linked.projectId;
      base.projectName = base.projectName || linked.projectName;
      base.meter = base.meter || linked.meter;
      base.repairType = base.repairType || linked.repairType;
      base.driverName = base.driverName || linked.driverName;
      base.contactNo = base.contactNo || linked.contactNo;
      base.ecdNo = base.ecdNo || linked.ecdNo;
      base.companyCode = base.companyCode || linked.companyCode;
    }
  } else {
    const veh = resolveVehicle(form);
    base.vehicleId = veh.vehicleId;
    base.vehicleRegNo = veh.vehicleRegNo;
  }
  return base;
}

function createJobCard(user, type, form) {
  const card = {
    type,
    status: STATUS.DRAFT,
    no: null,
    ...readForm(form, type),
    preparedBy: signature(user),
    reviewedBy: null,
    approvedBy: null,
    assignedTechnicianId: null,
    startedAt: null,
    completedAt: null,
    holdReason: null,
    workDone: '',
    partsUsed: '',
    labourHours: '',
    finalMeter: '',
    emailSentAt: null,
    pdfReady: false,
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.id,
  };
  const saved = db.insert('jobcards', card);
  addAudit(saved, user, { action: 'create', to: STATUS.DRAFT }, '');
  return saved;
}

function updateJobCard(card, form) {
  const patch = { ...readForm(form, card.type), updatedAt: now() };
  return db.update('jobcards', card.id, patch);
}

function addAudit(card, user, def, note, fromStatus) {
  db.insert('audits', {
    jobCardId: card.id,
    userId: user.id,
    userName: user.name,
    action: def.action,
    fromStatus: fromStatus || null,
    toStatus: def.to,
    note: note || '',
    at: now(),
  });
}

function timeline(cardId) {
  return db.where('audits', (a) => a.jobCardId === cardId).sort((a, b) => a.at.localeCompare(b.at));
}

function internalEmails(card) {
  const out = new Set();
  [card.preparedBy, card.reviewedBy, card.approvedBy].forEach((sig) => {
    if (!sig) return;
    const u = db.find('users', sig.userId);
    if (u && u.email) out.add(u.email);
  });
  return [...out];
}

/**
 * Validate and apply a workflow action. Returns { card } or { error }.
 * payload may carry: note, baseUrl, and workshop completion fields.
 */
function performAction(card, actionName, user, payload = {}) {
  const { def, error } = domain.findAction(card, actionName, user);
  if (error) return { error };
  if (def.note === 'required' && !(payload.note && payload.note.trim())) {
    return { error: 'A comment is required for this action.' };
  }

  const from = card.status;
  const patch = { status: def.to, updatedAt: now() };

  switch (def.effect) {
    case 'review':
      patch.reviewedBy = signature(user);
      break;
    case 'approveInternal':
      patch.approvedBy = signature(user);
      patch.no = card.no || db.nextNo('JC');
      break;
    case 'startJob':
      patch.assignedTechnicianId = user.id;
      patch.startedAt = now();
      patch.holdReason = null;
      break;
    case 'completeInternal':
      patch.completedAt = now();
      patch.workDone = payload.workDone || '';
      patch.partsUsed = payload.partsUsed || '';
      patch.labourHours = payload.labourHours || '';
      patch.finalMeter = payload.finalMeter || '';
      if (payload.finalMeter && card.vehicleId) {
        db.update('vehicles', card.vehicleId, { currentMeter: Number(payload.finalMeter) || undefined });
      }
      break;
    case 'approveOutsourced':
      patch.approvedBy = signature(user);
      patch.no = card.no || db.nextNo('SR');
      patch.pdfReady = true;
      patch.emailSentAt = now();
      break;
    case 'resendEmail':
      patch.emailSentAt = now();
      break;
    case 'completeOutsourced':
      patch.completedAt = now();
      break;
    case 'submit':
    default:
      if (actionName === 'hold') patch.holdReason = payload.note || '';
      if (actionName === 'resume') patch.holdReason = null;
      break;
  }

  db.update('jobcards', card.id, patch);
  const updated = db.find('jobcards', card.id);
  addAudit(updated, user, def, payload.note, from);
  postEffects(actionName, def, updated, user, payload);
  return { card: updated };
}

/** Notifications + vendor email, run after the card is saved. */
function postEffects(actionName, def, card, user, payload) {
  const isInternal = card.type === TYPES.INTERNAL;
  const ref = card.no || 'job card';

  switch (def.effect) {
    case 'submit': {
      if (isInternal) {
        notify.notifyRoles([ROLES.TRANSPORT_MANAGER], card, `${user.name} submitted a job card for your review.`);
      } else {
        notify.notifyRoles([ROLES.MECH_ENGINEER], card, `${user.name} submitted a service request for your approval.`);
      }
      break;
    }
    case 'review':
      notify.notifyRoles([ROLES.OPERATIONAL_MANAGER], card, `${ref} reviewed by ${user.name} — awaiting your approval.`);
      break;
    case 'approveInternal':
      notify.notifyRoles([ROLES.TECHNICIAN], card, `New job ${card.no} approved and queued in the workshop.`);
      notify.notifyUser(card.preparedBy && card.preparedBy.userId, card, `Your job card ${card.no} was approved and sent to the workshop.`);
      break;
    case 'completeInternal':
      notify.notifyRoles([ROLES.TRANSPORT_OFFICER, ROLES.TRANSPORT_MANAGER, ROLES.OPERATIONAL_MANAGER], card, `Job ${card.no} has been completed by ${user.name} — please review.`);
      break;
    case 'approveOutsourced':
    case 'resendEmail': {
      const vendor = card.vendorId && db.find('vendors', card.vendorId);
      if (vendor && vendor.email) {
        mailer.sendVendorRequest(card, vendor, internalEmails(card), payload.baseUrl || '');
      }
      notify.notifyUser(card.preparedBy && card.preparedBy.userId, card, `Service request ${card.no} ${def.effect === 'resendEmail' ? 're-sent' : 'approved and emailed'} to ${card.vendorName || 'the vendor'}.`);
      notify.notifyUser(card.reviewedBy && card.reviewedBy.userId, card, `Service request ${card.no} emailed to ${card.vendorName || 'the vendor'}.`);
      break;
    }
    case 'completeOutsourced':
      notify.notifyRoles([ROLES.ASST_MECH_ENGINEER, ROLES.MECH_ENGINEER, ROLES.OPERATIONAL_MANAGER], card, `Service request ${card.no} marked completed — please review.`);
      break;
    default:
      if (actionName === 'return') {
        notify.notifyUser(card.preparedBy && card.preparedBy.userId, card, `Returned for revision by ${user.name}: ${payload.note || ''}`);
      }
      break;
  }
}

// --- queries used by controllers ------------------------------------------
function get(id) {
  return db.find('jobcards', id);
}

function list(filter = {}) {
  let rows = db.all('jobcards').slice();
  if (filter.type) rows = rows.filter((c) => c.type === filter.type);
  if (filter.status) rows = rows.filter((c) => c.status === filter.status);
  if (filter.createdBy) rows = rows.filter((c) => c.createdBy === filter.createdBy);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Cards that are currently waiting on the given user to act. */
function myQueue(user) {
  return list().filter((card) => domain.availableActions(card, user).some((a) => a.tone === 'primary'));
}

/** Internal jobs that may be outsourced: already requested and not yet closed. */
function eligibleForOutsourcing() {
  return list({ type: TYPES.INTERNAL }).filter((j) => j.status !== STATUS.DRAFT && j.status !== STATUS.CLOSED);
}

module.exports = {
  createJobCard,
  updateJobCard,
  performAction,
  timeline,
  get,
  list,
  myQueue,
  eligibleForOutsourcing,
  today,
};
