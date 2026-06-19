'use strict';

/** In-app notifications. Each row targets one user and links to a job card. */

const db = require('./db');

function usersByRole(role) {
  return db.where('users', (u) => u.active && u.roles.includes(role));
}

function notifyUser(userId, card, message) {
  if (!userId) return;
  db.insert('notifications', {
    userId,
    jobCardId: card ? card.id : null,
    jobNo: card ? card.no || card.id : null,
    message,
    read: false,
    at: new Date().toISOString(),
  });
}

/** Notify every active user holding any of the given roles. */
function notifyRoles(roles, card, message) {
  const seen = new Set();
  roles.forEach((role) => {
    usersByRole(role).forEach((u) => {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        notifyUser(u.id, card, message);
      }
    });
  });
}

function unreadCount(userId) {
  return db.where('notifications', (n) => n.userId === userId && !n.read).length;
}

function listFor(userId) {
  return db
    .where('notifications', (n) => n.userId === userId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

function markRead(id, userId) {
  const n = db.find('notifications', id);
  if (n && n.userId === userId) db.update('notifications', id, { read: true });
}

function markAllRead(userId) {
  listFor(userId).forEach((n) => {
    if (!n.read) db.update('notifications', n.id, { read: true });
  });
}

module.exports = { usersByRole, notifyUser, notifyRoles, unreadCount, listFor, markRead, markAllRead };
