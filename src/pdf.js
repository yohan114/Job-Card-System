'use strict';

/**
 * Minimal zero-dependency PDF generator for a single-page A4 job card /
 * service request. Uses the standard Helvetica fonts (no embedding needed).
 *
 * If assets/letterhead.jpg exists it is embedded as a full-page background
 * (the company letterhead) and the form is laid out in the blank middle band.
 * Otherwise a plain bordered header/footer is drawn instead.
 */

const fs = require('fs');
const path = require('path');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const COMPANY = {
  name: 'Edward and Christie (Pvt) Ltd',
  address: '19 km Post, Giriulla Road, Badalgama.   Tel: 031 2269966   Email: badalgama@gmail.com',
  docNo: 'EC40.WS.FO.1E:4:22.3',
};

// Load the letterhead image once (if present).
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
    }
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
  }
  return { w: 0, h: 0 };
}

let LETTERHEAD = null;
try {
  const p = path.join(__dirname, '..', 'assets', 'letterhead.jpg');
  if (fs.existsSync(p)) {
    const data = fs.readFileSync(p);
    LETTERHEAD = { data, ...jpegSize(data) };
  }
} catch (err) {
  console.error('[PDF] Could not load letterhead:', err.message);
}

function esc(value) {
  return String(value == null ? '' : value)
    .split('')
    .map((ch) => (ch.charCodeAt(0) > 255 ? '?' : ch))
    .join('')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n\t]+/g, ' ');
}

function fmtDate(v) {
  return v ? String(v).slice(0, 10).replace(/-/g, '/') : '';
}

function wrap(str, max) {
  const words = String(str == null ? '' : str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function jobCardPdf(card, opts = {}) {
  const useLH = opts.letterhead !== false && !!LETTERHEAD;
  const ops = [];
  const Y = (top) => PAGE_H - top;
  const text = (x, top, str, o = {}) => {
    ops.push(`BT ${o.bold ? '/F2' : '/F1'} ${o.size || 10} Tf 1 0 0 1 ${x.toFixed(2)} ${Y(top).toFixed(2)} Tm (${esc(str)}) Tj ET`);
  };
  const centerAt = (cx, top, str, o = {}) => {
    const sz = o.size || 10;
    const w = String(str).length * sz * (o.bold ? 0.54 : 0.5);
    text(cx - w / 2, top, str, o);
  };
  const line = (x1, t1, x2, t2, lw = 0.7) => {
    ops.push(`${lw} w ${x1.toFixed(2)} ${Y(t1).toFixed(2)} m ${x2.toFixed(2)} ${Y(t2).toFixed(2)} l S`);
  };
  const rect = (x, top, w, h, lw = 0.7) => {
    ops.push(`${lw} w ${x.toFixed(2)} ${(PAGE_H - (top + h)).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };

  const FX = useLH ? 54 : 30;
  const FR = useLH ? 541 : 565;
  const CX = PAGE_W / 2;
  const TITLE = 'Request for Repairing and Service of Vehicle and Machinery';

  let tableTop;
  if (useLH) {
    // The letterhead supplies the header band (logo/company) and footer; the
    // middle is blank, so the form sits between TOP_SAFE and BOTTOM_SAFE.
    centerAt(CX, 178, TITLE, { size: 12, bold: true });
    line(FX, 188, FR, 188, 0.8);
    tableTop = 194;
  } else {
    rect(FX, 40, FR - FX, 772, 1.2);
    text(42, 60, COMPANY.name, { size: 15, bold: true });
    text(42, 74, COMPANY.address, { size: 8 });
    line(FX, 84, FR, 84, 1);
    centerAt(CX, 100, TITLE, { size: 12, bold: true });
    line(FX, 110, FR, 110, 1);
    tableTop = 110;
  }

  const repair = card.repairType ? card.repairType + (card.repairTypeNote ? ` (${card.repairTypeNote})` : '') : '';
  const rows = [
    ['Date', fmtDate(card.date), 'Job Card No.', card.no || ''],
    ['Project / Plant', card.projectName || '', 'Company Code', card.companyCode || ''],
    ['Vehicle Reg. No.', card.vehicleRegNo || '', 'Meter', card.meter || ''],
    ['Repair type', repair, 'Expected completion', fmtDate(card.expectedDate)],
    ['Driver / Operator', card.driverName || '', 'Contact No.', card.contactNo || ''],
    ['ECD No.', card.ecdNo || '', card.type === 'OUTSOURCED' ? 'External Company' : '', card.type === 'OUTSOURCED' ? card.vendorName || '' : ''],
  ];
  const rowH = 22;
  rows.forEach((r, i) => {
    const top = tableTop + i * rowH;
    line(FX, top + rowH, FR, top + rowH, 0.5);
    text(FX + 12, top + 14, r[0], { size: 9, bold: true });
    text(FX + 96, top + 14, r[1], { size: 10 });
    if (r[2]) {
      text(CX + 12, top + 14, r[2], { size: 9, bold: true });
      text(CX + 108, top + 14, r[3], { size: 10 });
    }
  });
  line(FX, tableTop, FR, tableTop, 0.5);
  line(CX, tableTop, CX, tableTop + rows.length * rowH, 0.5);

  let y = tableTop + rows.length * rowH + 18;
  text(FX + 2, y, 'Availability of following documents and records:', { size: 9, bold: true });
  const docs = [
    [card.docServiceBook, '1. Service and Repair Details of Vehicle and Machinery Book'],
    [card.docRunningChart, '2. Running Chart Book'],
    [card.docLicenseInsurance, '3. Income Revenue License, Insurance Certificate'],
  ];
  docs.forEach(([on, label], i) => text(FX + 10, y + 16 + i * 15, `[${on ? 'X' : '  '}]  ${label}`, { size: 9.5 }));

  y = y + 16 + docs.length * 15 + 10;
  text(FX + 2, y, 'Required service and repair details:', { size: 9, bold: true });
  rect(FX, y + 6, FR - FX, 76);
  wrap(card.details, 90).slice(0, 5).forEach((ln, i) => text(FX + 8, y + 22 + i * 14, ln, { size: 10 }));
  y = y + 6 + 76;

  const sigTop = useLH ? Math.max(y + 34, 600) : 690;
  const sigLineTop = sigTop + 32;
  const cols = [
    { cx: FX + 90, label: 'Prepared By', sig: card.preparedBy },
    { cx: CX, label: 'Reviewed By', sig: card.reviewedBy },
    { cx: FR - 90, label: 'Approved By', sig: card.approvedBy },
  ];
  cols.forEach(({ cx, label, sig }) => {
    centerAt(cx, sigTop, label, { size: 10, bold: true });
    if (sig) centerAt(cx, sigLineTop - 4, sig.name, { size: 10 });
    line(cx - 70, sigLineTop, cx + 70, sigLineTop, 0.6);
    if (sig) {
      centerAt(cx, sigLineTop + 13, sig.designation, { size: 8 });
      centerAt(cx, sigLineTop + 25, fmtDate(sig.at), { size: 8 });
    }
  });

  if (useLH) {
    const ry = sigLineTop + 50;
    text(FX + 2, ry, `Job Card No.: ${card.no || '________'}`, { size: 9, bold: true });
    text(FR - 175, ry, `Doc. No.: ${COMPANY.docNo}`, { size: 8 });
  } else {
    line(FX, 772, FR, 772, 0.8);
    text(42, 788, `Job Card No.: ${card.no || '________'}`, { size: 9, bold: true });
    text(330, 788, `Doc. No.: ${COMPANY.docNo}`, { size: 8 });
    text(505, 788, 'Page 1 of 1', { size: 8 });
  }

  let content = ops.join('\n');
  if (useLH) content = `q ${PAGE_W.toFixed(2)} 0 0 ${PAGE_H.toFixed(2)} 0 0 cm /Im0 Do Q\n${content}`;
  return assemble(content, useLH ? LETTERHEAD : null);
}

function assemble(content, image) {
  const len = Buffer.byteLength(content, 'latin1');
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${image ? ' /XObject << /Im0 7 0 R >>' : ''} >> /Contents 4 0 R >>`,
    `<< /Length ${len} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  if (image) {
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data.toString('latin1')}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { jobCardPdf, hasLetterhead: () => !!LETTERHEAD };
