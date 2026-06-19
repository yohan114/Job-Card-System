'use strict';

/**
 * Tests for the built-in SMTP client and the mailer, with no external services:
 *  1) full SMTP conversation against a local fake server (multi-recipient),
 *  2) simulated mode (no config) records to outbox without sending,
 *  3) connection failure is reported as a failed delivery, not a crash.
 *
 * Run:  node test/mail.test.js
 */

const net = require('net');
const assert = require('assert');
const mailer = require('../src/mailer');
const pdf = require('../src/pdf');

let passed = 0;
const ok = (label) => { console.log(`  ok - ${label}`); passed++; };

// A minimal fake SMTP server (plain TCP) that records what it receives.
function startFakeServer() {
  const got = { recipients: [], data: '', mailFrom: null, user: null, pass: null };
  let inData = false;
  let buf = '';
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 fake ESMTP ready\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 OK: queued\r\n'); }
          else got.data += line + '\n';
          continue;
        }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake greets you\r\n250 AUTH LOGIN\r\n');
        else if (up === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (up.startsWith('MAIL FROM')) { got.mailFrom = line; sock.write('250 OK\r\n'); }
        else if (up.startsWith('RCPT TO')) { got.recipients.push(line); sock.write('250 OK\r\n'); }
        else if (up === 'DATA') { inData = true; sock.write('354 Start mail input\r\n'); }
        else if (up === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else if (got.user === null) { got.user = Buffer.from(line, 'base64').toString(); sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (got.pass === null) { got.pass = Buffer.from(line, 'base64').toString(); sock.write('235 2.7.0 Accepted\r\n'); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, got, port: server.address().port })));
}

async function main() {
  // 1) Full conversation against the fake server.
  const { server, got, port } = await startFakeServer();
  const cfg = { host: '127.0.0.1', port, user: 'badalgama@gmail.com', pass: 'app-pass-1234', from: 'ENC <badalgama@gmail.com>', secure: false, starttls: false };
  const pdfBuf = pdf.jobCardPdf({
    no: 'SR-2026-0001', type: 'OUTSOURCED', vehicleRegNo: 'NP-2210', meter: '13400',
    projectName: 'Badalgama Plant', repairType: 'Other', details: 'Hydraulic pump overhaul',
    vendorName: 'DIMO', docServiceBook: true, docRunningChart: true,
    preparedBy: { name: 'Kasun', designation: 'AME', at: '2026-06-19T00:00:00Z' },
    reviewedBy: { name: 'Nuwan', designation: 'ME', at: '2026-06-19T00:00:00Z' },
    approvedBy: { name: 'Amarasekara', designation: 'OM', at: '2026-06-19T00:00:00Z' },
  });
  assert.ok(Buffer.isBuffer(pdfBuf), 'jobCardPdf returns a Buffer');
  assert.strictEqual(pdfBuf.slice(0, 5).toString('latin1'), '%PDF-', 'PDF has %PDF- header');
  assert.ok(pdfBuf.toString('latin1').trimEnd().endsWith('%%EOF'), 'PDF ends with %%EOF');
  ok('jobCardPdf produces a valid PDF');

  const mime = mailer.buildMime({
    from: cfg.from, to: 'vendor@example.com', cc: ['boss@enc.example'],
    subject: 'Service Request SR-2026-0001', text: 'Line one.\n.dot-leading line\nLast line.',
    attachments: [{ name: 'SR-2026-0001.pdf', type: 'application/pdf', content: pdfBuf }],
  });
  assert.ok(mime.includes('Content-Type: application/pdf'), 'mime has pdf content-type');
  assert.ok(mime.includes('filename="SR-2026-0001.pdf"'), 'mime has pdf filename');
  assert.ok(mime.includes('JVBERi0xLjQ'), 'pdf bytes base64-encoded into the message');
  ok('PDF attached as a binary base64 part');

  await mailer.sendSmtp(cfg, mime, ['vendor@example.com', 'boss@enc.example'], 'badalgama@gmail.com');
  server.close();

  assert.strictEqual(got.user, 'badalgama@gmail.com', 'auth username decoded');
  assert.strictEqual(got.pass, 'app-pass-1234', 'auth password decoded');
  ok('AUTH LOGIN sends base64 credentials');
  assert.strictEqual(got.recipients.length, 2, 'both recipients received');
  assert.ok(got.recipients[0].includes('vendor@example.com'), 'vendor is a recipient');
  assert.ok(got.recipients[1].includes('boss@enc.example'), 'cc is a recipient');
  ok('MAIL FROM + multiple RCPT TO');
  assert.ok(got.data.includes('Subject: Service Request SR-2026-0001'), 'subject in DATA');
  assert.ok(got.data.includes('Content-Type: multipart/mixed'), 'multipart attachment built');
  assert.ok(got.data.includes('filename="SR-2026-0001.pdf"'), 'attachment filename present');
  assert.ok(got.data.includes('..dot-leading line'), 'leading-dot line is dot-stuffed');
  ok('DATA body, headers, attachment and dot-stuffing');

  // 2) Simulated mode (no SMTP config) — must record to outbox, not send.
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  assert.strictEqual(mailer.isLive(), false, 'isLive false without config');
  const sim = mailer.deliver({ to: 'x@y.z', subject: 'Sim', body: 'hello', recipients: ['x@y.z'] });
  assert.strictEqual(sim.status, 'simulated', 'simulated status recorded');
  ok('simulated mode records to outbox without sending');

  // 3) Connection failure path — resolves to a "failed" outbox row, no crash.
  process.env.SMTP_USER = 'u'; process.env.SMTP_PASS = 'p';
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; process.env.SMTP_SECURE = 'false';
  assert.strictEqual(mailer.isLive(), true, 'isLive true with env config');
  const fail = mailer.deliver({ to: 'x@y.z', subject: 'Fail', body: 'hello', recipients: ['x@y.z'] });
  assert.strictEqual(fail.status, 'queued', 'queued before async send resolves');
  await new Promise((r) => setTimeout(r, 600));
  const after = mailer.listOutbox().find((m) => m.id === fail.id);
  assert.strictEqual(after.status, 'failed', 'unreachable host marks delivery failed');
  assert.ok(after.error, 'error message captured');
  ok('connection failure is captured, server stays up');
  ['SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE'].forEach((k) => delete process.env[k]);

  console.log(`\nAll ${passed} mail checks passed.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
