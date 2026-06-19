'use strict';

/**
 * Domain rules: roles, job types, statuses and the two workflow state machines.
 * The transition tables are the single source of truth for "who can do what,
 * when" — controllers and views both read from here so the UI can never offer
 * an action the server would reject.
 */

const ROLES = {
  TRANSPORT_OFFICER: 'TRANSPORT_OFFICER',
  TRANSPORT_MANAGER: 'TRANSPORT_MANAGER',
  ASST_MECH_ENGINEER: 'ASST_MECH_ENGINEER',
  MECH_ENGINEER: 'MECH_ENGINEER',
  OPERATIONAL_MANAGER: 'OPERATIONAL_MANAGER',
  TECHNICIAN: 'TECHNICIAN',
  ADMIN: 'ADMIN',
};

const ROLE_LABELS = {
  TRANSPORT_OFFICER: 'Transport Officer',
  TRANSPORT_MANAGER: 'Transport Manager',
  ASST_MECH_ENGINEER: 'Assistant Mechanical Engineer',
  MECH_ENGINEER: 'Mechanical Engineer',
  OPERATIONAL_MANAGER: 'Operational Manager',
  TECHNICIAN: 'Workshop Technician',
  ADMIN: 'Administrator',
};

const TYPES = {
  INTERNAL: 'INTERNAL',
  OUTSOURCED: 'OUTSOURCED',
};

const TYPE_LABELS = {
  INTERNAL: 'Internal Workshop Job',
  OUTSOURCED: 'Outsourced Service Request',
};

const STATUS = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  SENT_TO_VENDOR: 'SENT_TO_VENDOR',
  CLOSED: 'CLOSED',
};

const STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved — Queued in Workshop',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  SENT_TO_VENDOR: 'Sent to Vendor',
  CLOSED: 'Closed',
};

// Colour class used for status badges in the UI.
const STATUS_TONE = {
  DRAFT: 'gray',
  PENDING_REVIEW: 'amber',
  PENDING_APPROVAL: 'amber',
  APPROVED: 'blue',
  IN_PROGRESS: 'blue',
  ON_HOLD: 'red',
  COMPLETED: 'green',
  SENT_TO_VENDOR: 'blue',
  CLOSED: 'green',
};

const R = ROLES;

/**
 * Workflow definitions. transitions[type][status] => array of available actions.
 * Each action: { action, label, to, roles, note, tone, effect }
 *   note:  'required' | 'optional' | undefined  (comment box behaviour)
 *   effect: key handled by the job-card service (side effects + audit text)
 */
const TRANSITIONS = {
  INTERNAL: {
    DRAFT: [
      { action: 'submit', label: 'Submit for Review', to: STATUS.PENDING_REVIEW, roles: [R.TRANSPORT_OFFICER, R.ADMIN], effect: 'submit', tone: 'primary' },
    ],
    PENDING_REVIEW: [
      { action: 'review', label: 'Approve Review', to: STATUS.PENDING_APPROVAL, roles: [R.TRANSPORT_MANAGER, R.ADMIN], effect: 'review', tone: 'primary' },
      { action: 'return', label: 'Return for Revision', to: STATUS.DRAFT, roles: [R.TRANSPORT_MANAGER, R.ADMIN], note: 'required', tone: 'danger' },
    ],
    PENDING_APPROVAL: [
      { action: 'approve', label: 'Approve & Send to Workshop', to: STATUS.APPROVED, roles: [R.OPERATIONAL_MANAGER, R.ADMIN], effect: 'approveInternal', tone: 'primary' },
      { action: 'return', label: 'Return for Revision', to: STATUS.DRAFT, roles: [R.OPERATIONAL_MANAGER, R.ADMIN], note: 'required', tone: 'danger' },
    ],
    APPROVED: [
      { action: 'start', label: 'Start Job', to: STATUS.IN_PROGRESS, roles: [R.TECHNICIAN, R.ADMIN], effect: 'startJob', tone: 'primary' },
    ],
    IN_PROGRESS: [
      { action: 'hold', label: 'Put On Hold', to: STATUS.ON_HOLD, roles: [R.TECHNICIAN, R.ADMIN], note: 'required', tone: 'danger' },
      { action: 'complete', label: 'End / Complete Job', to: STATUS.COMPLETED, roles: [R.TECHNICIAN, R.ADMIN], effect: 'completeInternal', tone: 'primary' },
    ],
    ON_HOLD: [
      { action: 'resume', label: 'Resume Job', to: STATUS.IN_PROGRESS, roles: [R.TECHNICIAN, R.ADMIN], tone: 'primary' },
    ],
    COMPLETED: [
      { action: 'close', label: 'Review & Close', to: STATUS.CLOSED, roles: [R.TRANSPORT_OFFICER, R.TRANSPORT_MANAGER, R.OPERATIONAL_MANAGER, R.ADMIN], note: 'optional', tone: 'primary' },
    ],
    CLOSED: [],
  },
  OUTSOURCED: {
    DRAFT: [
      { action: 'submit', label: 'Submit for Review', to: STATUS.PENDING_REVIEW, roles: [R.ASST_MECH_ENGINEER, R.ADMIN], effect: 'submit', tone: 'primary' },
    ],
    PENDING_REVIEW: [
      { action: 'review', label: 'Approve Review', to: STATUS.PENDING_APPROVAL, roles: [R.MECH_ENGINEER, R.ADMIN], effect: 'review', tone: 'primary' },
      { action: 'return', label: 'Return for Revision', to: STATUS.DRAFT, roles: [R.MECH_ENGINEER, R.ADMIN], note: 'required', tone: 'danger' },
    ],
    PENDING_APPROVAL: [
      { action: 'approve', label: 'Approve & Email Vendor', to: STATUS.SENT_TO_VENDOR, roles: [R.OPERATIONAL_MANAGER, R.ADMIN], effect: 'approveOutsourced', tone: 'primary' },
      { action: 'return', label: 'Return for Revision', to: STATUS.DRAFT, roles: [R.OPERATIONAL_MANAGER, R.ADMIN], note: 'required', tone: 'danger' },
    ],
    SENT_TO_VENDOR: [
      { action: 'start', label: 'Mark In Progress', to: STATUS.IN_PROGRESS, roles: [R.ASST_MECH_ENGINEER, R.MECH_ENGINEER, R.OPERATIONAL_MANAGER, R.ADMIN], tone: 'primary' },
      { action: 'resend', label: 'Resend Email to Vendor', to: STATUS.SENT_TO_VENDOR, roles: [R.ASST_MECH_ENGINEER, R.MECH_ENGINEER, R.OPERATIONAL_MANAGER, R.ADMIN], effect: 'resendEmail', tone: 'secondary' },
    ],
    IN_PROGRESS: [
      { action: 'complete', label: 'Mark Completed', to: STATUS.COMPLETED, roles: [R.ASST_MECH_ENGINEER, R.MECH_ENGINEER, R.OPERATIONAL_MANAGER, R.ADMIN], effect: 'completeOutsourced', tone: 'primary' },
    ],
    COMPLETED: [
      { action: 'close', label: 'Review & Close', to: STATUS.CLOSED, roles: [R.ASST_MECH_ENGINEER, R.MECH_ENGINEER, R.OPERATIONAL_MANAGER, R.ADMIN], note: 'optional', tone: 'primary' },
    ],
    CLOSED: [],
  },
};

// Roles allowed to create each job type.
const CREATE_ROLES = {
  INTERNAL: [R.TRANSPORT_OFFICER, R.ADMIN],
  OUTSOURCED: [R.ASST_MECH_ENGINEER, R.ADMIN],
};

function hasRole(user, role) {
  return !!user && Array.isArray(user.roles) && user.roles.includes(role);
}

function hasAnyRole(user, roles) {
  return !!user && roles.some((role) => hasRole(user, role));
}

function canCreate(user, type) {
  return hasAnyRole(user, CREATE_ROLES[type] || []);
}

/** Actions the given user may perform on the given job card right now. */
function availableActions(card, user) {
  const list = (TRANSITIONS[card.type] && TRANSITIONS[card.type][card.status]) || [];
  return list.filter((t) => hasAnyRole(user, t.roles));
}

/** Look up a single action definition, validating role + current status. */
function findAction(card, actionName, user) {
  const list = (TRANSITIONS[card.type] && TRANSITIONS[card.type][card.status]) || [];
  const def = list.find((t) => t.action === actionName);
  if (!def) return { error: 'That action is not available for this job in its current state.' };
  if (!hasAnyRole(user, def.roles)) return { error: 'You do not have permission to perform this action.' };
  return { def };
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  TYPES,
  TYPE_LABELS,
  STATUS,
  STATUS_LABELS,
  STATUS_TONE,
  TRANSITIONS,
  CREATE_ROLES,
  hasRole,
  hasAnyRole,
  canCreate,
  availableActions,
  findAction,
};
