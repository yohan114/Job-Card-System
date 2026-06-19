'use strict';

/**
 * Tiny zero-dependency JSON datastore.
 *
 * The whole database lives in one file (data/db.json) and is held in memory.
 * Mutate the object returned by `getData()` then call `persist()` to flush it
 * to disk. The repository layer is deliberately thin so it can later be swapped
 * for a real database (PostgreSQL etc.) without touching the services.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return {
    meta: { counters: { JC: 0, SR: 0 } },
    users: [],
    projects: [],
    vehicles: [],
    vendors: [],
    jobcards: [],
    audits: [],
    notifications: [],
    outbox: [],
  };
}

let data = emptyDb();

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.error('Could not parse db.json, starting fresh:', err.message);
      data = emptyDb();
    }
  }
  return data;
}

function persist() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getData() {
  return data;
}

function isEmpty() {
  return data.users.length === 0;
}

function newId() {
  return crypto.randomBytes(9).toString('hex');
}

/**
 * Sequential, human-friendly document number, unique per year.
 * prefix "JC" -> JC-2026-0001 (internal), "SR" -> SR-2026-0001 (outsourced).
 */
function nextNo(prefix) {
  const year = new Date().getFullYear();
  data.meta.counters[prefix] = (data.meta.counters[prefix] || 0) + 1;
  const seq = String(data.meta.counters[prefix]).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

// Generic collection helpers ------------------------------------------------
function all(collection) {
  return data[collection];
}

function find(collection, id) {
  return data[collection].find((row) => row.id === id);
}

function where(collection, predicate) {
  return data[collection].filter(predicate);
}

function insert(collection, row) {
  if (!row.id) row.id = newId();
  data[collection].push(row);
  persist();
  return row;
}

function update(collection, id, patch) {
  const row = find(collection, id);
  if (!row) return null;
  Object.assign(row, patch);
  persist();
  return row;
}

module.exports = {
  DB_FILE,
  load,
  persist,
  getData,
  isEmpty,
  newId,
  nextNo,
  all,
  find,
  where,
  insert,
  update,
};
