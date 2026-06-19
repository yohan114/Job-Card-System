'use strict';

/**
 * Email delivery.
 *
 * - If SMTP is configured (via mail.config.json or SMTP_* env vars), emails are
 *   sent for real over a built-in, zero-dependency SMTP client (TLS).
 * - Either way a copy is written to the in-app "Outbox" with a delivery status
 *   (simulated / queued / sent / failed) so there is always an auditable record.
 *
 * Gmail: enable 2-Step Verification, create an App Password, and use
 *   host smtp.gmail.com, port 465, user = your gmail, pass = the App Password.
 *   See README.md ("Sending real email through Gmail").
 */

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const pdf = require('./pdf');

const CONFIG_FILE = path.join(__dirname, '..', 'mail.config.json');

/** Load SMTP config from env vars first, then mail.config.json. Null = simulate. */
function loadConfig() {
  let raw = null;
  const env = process.env;
  if (env.SMTP_USER && env.SMTP_PASS) {
    raw = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM, secure: env.SMTP_SECURE };
  } else if (fs.existsSync(CONFIG_FILE)) {
    try {
      const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (j && j.user && j.pass) raw = j;
    } catch (err) {
      console.error('[MAIL] Ignoring invalid mail.config.json:', err.message);
    }
  }
  if (!raw) return null;
  const port = Number(raw.port) || 465;
  return {
    host: raw.host || 'smtp.gmail.com',
    port,
    user: raw.user,
    pass: raw.pass,
    from: raw.from || raw.user,
    secure: raw.secure !== undefined ? raw.secure !== false && raw.secure !== 'false' : port === 465,
    starttls: port !== 465,
  };
}

function isLive() {
  return !!loadConfig();
}

// --- low-level SMTP helpers ------------------------------------------------
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64wrap = (s) => (Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8')).toString('base64').replace(/(.{76})/g, '$1\r\n');
const dotStuff = (s) => s.replace(/(^|\r\n)\./g, '$1..');

/** Reads complete SMTP responses (handles multi-line 250-/250 replies). */
function makeReader(socket) {
  const queue = [];
  let waiter = null;
  let buf = '';
  const onData = (chunk) => {
    buf += chunk;
    while (true) {
      const lines = buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length; i++) if (/^\d{3} /.test(lines[i])) { end = i; break; }
      if (end === -1) break;
      const resp = { code: parseInt(lines[end].slice(0, 3), 10), text: lines.slice(0, end + 1).join('\n') };
      buf = lines.slice(end + 1).join('\r\n');
      if (waiter) { const w = waiter; waiter = null; w(resp); } else queue.push(resp);
    }
  };
  socket.on('data', onData);
  return {
    read: () => new Promise((res) => { if (queue.length) res(queue.shift()); else waiter = res; }),
    detach: () => socket.removeListener('data', onData),
  };
}

function onceSecure(socket) {
  return new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
}

/** Run the SMTP conversation and deliver one message. Resolves on 250 (queued). */
function sendSmtp(cfg, mime, recipients, fromAddr) {
  return new Promise((resolve, reject) => {
    let socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });

    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { socket.end(); } catch (_) {}
      err ? reject(err) : resolve(true);
    };
    socket.setTimeout(25000, () => finish(new Error('SMTP connection timed out')));
    socket.on('error', finish);

    socket.setEncoding('utf8');
    let reader = makeReader(socket);

    const expect = async (codes, label) => {
      const r = await reader.read();
      if (![].concat(codes).includes(r.code)) {
        throw new Error(`${label} failed: expected ${codes}, got ${r.code} — ${r.text.split('\n')[0]}`);
      }
      return r;
    };
    const send = (line) => socket.write(line + '\r\n');

    (async () => {
      try {
        await expect(220, 'Greeting');
        send('EHLO jobcardsystem');
        await expect(250, 'EHLO');

        if (!cfg.secure && cfg.starttls) {
          send('STARTTLS');
          await expect(220, 'STARTTLS');
          reader.detach();
          const secure = tls.connect({ socket, servername: cfg.host });
          secure.on('error', finish);
          await onceSecure(secure);
          socket = secure;
          socket.setEncoding('utf8');
          reader = makeReader(socket);
          send('EHLO jobcardsystem');
          await expect(250, 'EHLO (TLS)');
        }

        send('AUTH LOGIN');
        await expect(334, 'AUTH LOGIN');
        send(b64(cfg.user));
        await expect(334, 'Username');
        send(b64(cfg.pass));
        await expect(235, 'Authentication'); // wrong app password surfaces here
        send(`MAIL FROM:<${fromAddr}>`);
        await expect(250, 'MAIL FROM');
        for (const rcpt of recipients) {
          send(`RCPT TO:<${rcpt}>`);
          await expect([250, 251], `RCPT TO ${rcpt}`);
        }
        send('DATA');
        await expect(354, 'DATA');
        const data = mime.endsWith('\r\n') ? mime : mime + '\r\n';
        socket.write(dotStuff(data) + '.\r\n');
        await expect(250, 'Message body');
        send('QUIT');
        finish();
      } catch (err) {
        finish(err);
      }
    })();
  });
}

// --- message building ------------------------------------------------------
function buildMime({ from, to, cc, subject, text, attachments }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc && cc.length ? `Cc: ${cc.join(', ')}` : null,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const body = text.replace(/\r?\n/g, '\r\n');

  if (!attachments || !attachments.length) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  const boundary = 'jcs_' + crypto.randomBytes(8).toString('hex');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  let out = `${headers.join('\r\n')}\r\n\r\n`;
  out += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n`;
  for (const att of attachments) {
    out += `--${boundary}\r\nContent-Type: ${att.type || 'application/octet-stream'}; name="${att.name}"\r\n`;
    out += `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${att.name}"\r\n\r\n`;
    out += `${b64wrap(att.content)}\r\n`;
  }
  out += `--${boundary}--\r\n`;
  return out;
}

// --- public API ------------------------------------------------------------
/** Store to outbox and (if configured) send for real, updating the status. */
function deliver(msg, { card } = {}) {
  const cfg = loadConfig();
  const row = db.insert('outbox', {
    jobCardId: msg.jobCardId || null,
    jobNo: msg.jobNo || null,
    to: msg.to,
    cc: (msg.cc || []).join(', '),
    subject: msg.subject,
    body: msg.body,
    attachments: (msg.attachments || []).map((a) => ({ name: a.name })),
    at: new Date().toISOString(),
    status: cfg ? 'queued' : 'simulated',
    error: null,
  });
  console.log(`[MAIL] to=${msg.to} subject="${msg.subject}" mode=${cfg ? 'smtp' : 'simulated'}`);

  if (cfg) {
    const fromAddr = (cfg.from.match(/<([^>]+)>/) || [])[1] || cfg.from;
    const mime = buildMime({ from: cfg.from, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.body, attachments: msg.attachments });
    sendSmtp(cfg, mime, msg.recipients, fromAddr)
      .then(() => db.update('outbox', row.id, { status: 'sent' }))
      .catch((err) => {
        console.error('[MAIL] send failed:', err.message);
        db.update('outbox', row.id, { status: 'failed', error: err.message });
      });
  }
  return row;
}

/** Email a service request to the vendor, attaching the printable request. */
function sendVendorRequest(card, vendor, internalCc, baseUrl) {
  const text = [
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
    `Approved by: ${card.approvedBy ? `${card.approvedBy.name}, ${card.approvedBy.designation}` : '-'}`,
    '',
    'Thank you,',
    'Edward and Christie (Pvt) Ltd',
    '19 km Post, Giriulla Road, Badalgama. Tel: 031 2269966',
  ].join('\n');

  const ccList = [...internalCc];
  const extraCc = [
    'encsrepair@gmail.com',
    'nuoneccom@gmail.com',
    'senaratht@gmail.com',
    'enc.badalgama.om@gmail.com',
    'swnhsilva@gmail.com',
    'carawwala@yahoo.com'
  ];
  extraCc.forEach((email) => {
    if (!ccList.includes(email)) {
      ccList.push(email);
    }
  });
  const recipients = [vendor.email, ...ccList.filter((e) => e && e !== vendor.email)];
  return deliver({
    jobCardId: card.id,
    jobNo: card.no,
    to: vendor.email,
    cc: ccList,
    recipients,
    subject: `Service Request ${card.no} — ${card.vehicleRegNo || 'Vehicle/Machinery'} | Edward and Christie (Pvt) Ltd`,
    body: text,
    attachments: [{ name: `${card.no || 'request'}.pdf`, type: 'application/pdf', content: pdf.jobCardPdf(card) }],
  }, { card });
}

function listOutbox() {
  return db.all('outbox').slice().sort((a, b) => b.at.localeCompare(a.at));
}

module.exports = { deliver, sendVendorRequest, listOutbox, isLive, buildMime, sendSmtp, loadConfig };
