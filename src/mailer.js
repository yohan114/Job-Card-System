'use strict';

/**
 * Email delivery. To keep the system runnable with zero configuration, mail is
 * written to an in-app "Outbox" (and logged to the console) instead of being
 * sent over SMTP. To send real email, plug an SMTP client (e.g. nodemailer)
 * into `deliver()` — everything else stays the same.
 */

const db = require('./db');

function deliver(message) {
  // Persist to the outbox so it is viewable in the app and survives restarts.
  const row = db.insert('outbox', { ...message, at: new Date().toISOString() });
  console.log(`[MAIL] to=${message.to} cc=${message.cc || '-'} subject="${message.subject}"`);
  // To enable real delivery, do it here, e.g.:
  //   if (process.env.SMTP_HOST) await smtpTransport.sendMail({...});
  return row;
}

/**
 * Email a service request to the selected vendor, attaching the printable PDF
 * copy of the request and copying the internal requesters.
 */
function sendVendorRequest(card, vendor, internalCc, baseUrl) {
  const printUrl = `${baseUrl}/jobcards/${card.id}/print`;
  const lines = [
    `Dear ${vendor.companyName},`,
    '',
    `Please find attached our service request ${card.no} for the following:`,
    '',
    `  Vehicle / Machinery : ${card.vehicleRegNo || '-'}  (Meter: ${card.meter || '-'})`,
    `  Project / Plant     : ${card.projectName || '-'}`,
    `  Repair type         : ${card.repairType || '-'}`,
    `  Expected completion : ${card.expectedDate || 'As soon as possible'}`,
    '',
    'Required service and repair details:',
    `  ${card.details || '-'}`,
    '',
    'Kindly review the attached request, confirm the quotation/timeline, and proceed.',
    '',
    'Approved by:',
    `  ${card.approvedBy ? `${card.approvedBy.name}, ${card.approvedBy.designation}` : '-'}`,
    '',
    'Thank you,',
    'Edward and Christie (Pvt) Ltd',
    '19 km Post, Giriulla Road, Badalgama. Tel: 031 2269966',
  ];

  return deliver({
    jobCardId: card.id,
    jobNo: card.no,
    to: vendor.email,
    cc: internalCc.join(', '),
    subject: `Service Request ${card.no} — ${card.vehicleRegNo || 'Vehicle/Machinery'} | Edward and Christie (Pvt) Ltd`,
    body: lines.join('\n'),
    attachments: [{ name: `${card.no}.pdf`, url: printUrl }],
  });
}

function listOutbox() {
  return db.all('outbox').slice().sort((a, b) => b.at.localeCompare(a.at));
}

module.exports = { deliver, sendVendorRequest, listOutbox };
