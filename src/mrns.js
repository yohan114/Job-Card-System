'use strict';

const db = require('./db');

const now = () => new Date().toISOString();

function signature(user) {
  return { userId: user.id, name: user.name, at: now() };
}

/** Derive MRN status from its receipt lines. */
function computeStatus(mrn, receipts) {
  const netQty = receipts.reduce((s, r) => s + (r.qty || 0), 0);
  const reqQty = mrn.reqQty || 0;
  const hasReturn = receipts.some((r) => r.transactionType === 'Return');
  if (hasReturn && netQty <= 0) return 'returned';
  if (netQty <= 0) return 'pending';
  if (netQty < reqQty) return 'partial';
  return 'received';
}

/** Compute cost totals for an MRN given its receipt lines. */
function mrnCost(receipts) {
  let priced = 0;
  let unpriced = 0;
  let total = 0;
  for (const r of receipts) {
    if (r.transactionType === 'Return') continue;
    if (r.unitPrice != null) {
      total += (r.qty || 0) * r.unitPrice;
      priced++;
    } else {
      unpriced++;
    }
  }
  return { total: Math.round(total * 100) / 100, pricedLines: priced, unpricedLines: unpriced };
}

/** Compute aggregate parts cost for a job number. */
function mrnStats(jobNo) {
  const mrns = db.where('mrns', (m) => m.jobNo === jobNo);
  let total = 0;
  let unpriced = 0;
  let mrnCount = mrns.length;
  for (const m of mrns) {
    const receipts = db.where('receipts', (r) => r.mrnId === m.id);
    const c = mrnCost(receipts);
    total += c.total;
    unpriced += c.unpricedLines;
  }
  return { mrnCount, total: Math.round(total * 100) / 100, unpricedLines: unpriced };
}

/** Enrich an MRN record with computed status and cost. */
function enrichMrn(mrn) {
  const receipts = db.where('receipts', (r) => r.mrnId === mrn.id);
  const cost = mrnCost(receipts);
  const status = computeStatus(mrn, receipts);
  return { ...mrn, receipts, cost, status };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function createMrn(form, user) {
  const itemId = form.itemId || null;
  const item = itemId ? db.find('items', itemId) : null;
  const mrn = db.insert('mrns', {
    mrnNum: form.mrnNum || '',
    jobNo: form.jobNo || null,
    jobCardId: form.jobCardId || null,
    vehicleMachinery: (form.vehicleMachinery || '').trim(),
    reqDate: form.reqDate || new Date().toISOString().slice(0, 10),
    itemId: itemId,
    itemName: (form.itemName || (item && item.name) || '').trim(),
    category: (form.category || (item && item.category) || 'General Items').trim(),
    reqQty: Number(form.reqQty) || 1,
    recQty: 0,
    hasUnpriced: false,
    purchaseSource: form.purchaseSource || '',
    status: 'pending',
    createdAt: now(),
    createdBy: user.id,
  });
  return mrn;
}

function addReceipt(mrnId, form, user) {
  const mrn = db.find('mrns', mrnId);
  if (!mrn) return null;

  const qty = Number(form.qty) || 0;
  const unitPrice = form.unitPrice !== '' && form.unitPrice != null
    ? Number(form.unitPrice) : null;

  const receipt = db.insert('receipts', {
    mrnId,
    transactionType: form.transactionType === 'Return' ? 'Return' : 'Receive',
    qty,
    deliveryDate: form.deliveryDate || new Date().toISOString().slice(0, 10),
    grnNumber: (form.grnNumber || '').trim(),
    invoiceNumber: (form.invoiceNumber || '').trim(),
    invoiceDate: form.invoiceDate || '',
    supplierName: (form.supplierName || '').trim(),
    purchaseSource: (form.purchaseSource || mrn.purchaseSource || '').trim(),
    unitPrice,
    createdAt: now(),
    createdBy: user.id,
  });

  // recompute mrn aggregates
  const allReceipts = db.where('receipts', (r) => r.mrnId === mrnId);
  const netQty = allReceipts.reduce((s, r) => s + (r.qty || 0), 0);
  const hasUnpriced = allReceipts.some(
    (r) => r.transactionType !== 'Return' && r.unitPrice == null
  );
  const status = computeStatus(mrn, allReceipts);
  db.update('mrns', mrnId, { recQty: netQty, hasUnpriced, status });

  return receipt;
}

function updatePrice(receiptId, unitPrice, user) {
  const receipt = db.find('receipts', receiptId);
  if (!receipt) return null;
  const updated = db.update('receipts', receiptId, { unitPrice: Number(unitPrice) || null });

  // recheck mrn hasUnpriced flag
  const mrn = db.find('mrns', receipt.mrnId);
  if (mrn) {
    const allReceipts = db.where('receipts', (r) => r.mrnId === receipt.mrnId);
    const hasUnpriced = allReceipts.some(
      (r) => r.transactionType !== 'Return' && r.unitPrice == null
    );
    db.update('mrns', receipt.mrnId, { hasUnpriced });
  }
  return updated;
}

module.exports = { createMrn, addReceipt, updatePrice, mrnStats, enrichMrn, mrnCost };
