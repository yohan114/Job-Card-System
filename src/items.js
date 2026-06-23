'use strict';

const db = require('./db');

const now = () => new Date().toISOString();

const CATEGORIES = [
  'General Items',
  'Filters',
  'Electrical',
  'Bearings & Seals',
  'Hydraulics',
  'Oil & Lubricants',
  'Battery',
  'Belts',
  'Tyre',
  'Other',
];

function createItem(form, user) {
  const name = (form.name || '').trim();
  if (!name) return { error: 'Item name is required.' };
  // dedup check
  const existing = db.all('items').find(
    (i) => i.name.toLowerCase() === name.toLowerCase() &&
           (i.category || '').toLowerCase() === (form.category || '').toLowerCase()
  );
  if (existing) return { error: 'An item with this name and category already exists.' };

  return { item: db.insert('items', {
    name,
    category: (form.category || 'General Items').trim(),
    unit: (form.unit || 'Nos').trim(),
    createdAt: now(),
    createdBy: user.id,
  }) };
}

function allItems() {
  return db.all('items').sort((a, b) => a.name.localeCompare(b.name));
}

function searchItems(q) {
  if (!q) return allItems().slice(0, 50);
  const lq = q.toLowerCase();
  return db.all('items')
    .filter((i) => i.name.toLowerCase().includes(lq) || (i.category || '').toLowerCase().includes(lq))
    .slice(0, 50);
}

module.exports = { createItem, allItems, searchItems, CATEGORIES };
