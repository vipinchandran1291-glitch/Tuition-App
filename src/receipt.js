const PDFDocument = require('pdfkit');
const { getSettings } = require('./db');
const { money, amountInWords, receiptNo, dateLabel, batchName } = require('./utils');

// Streams an A5 receipt PDF for a payment row joined with student + batch.
// Uses "Rs." because the built-in PDF fonts have no rupee glyph.
function writeReceipt(res, p) {
  const s = getSettings();
  const doc = new PDFDocument({ size: 'A5', margin: 36 });
  const no = receiptNo(p);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${no}.pdf"`);
  doc.pipe(res);

  const W = doc.page.width - 72;
  const ink = '#1f2937';
  const muted = '#6b7280';

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text(s.center_name, { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (s.center_address) doc.text(s.center_address, { align: 'center' });
  if (s.center_phone) doc.text(`Phone: ${s.center_phone}`, { align: 'center' });

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text('FEE RECEIPT', { align: 'center', characterSpacing: 2 });
  doc.moveDown(0.6);

  let y = doc.y;
  doc.moveTo(36, y).lineTo(36 + W, y).strokeColor('#d1d5db').stroke();
  y += 10;

  const row = (label, value, opts = {}) => {
    doc.font('Helvetica').fontSize(10).fillColor(muted).text(label, 36, y, { width: 110 });
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10).fillColor(ink)
      .text(value || '-', 150, y, { width: W - 114 });
    y = doc.y + 6;
  };

  row('Receipt No.', no, { bold: true });
  row('Date', dateLabel(p.paid_on));
  row('Student', p.student_name, { bold: true });
  row('Class', batchName(p));
  if (p.roll_no) row('Roll No.', p.roll_no);
  if (p.parent_name) row('Parent', p.parent_name);
  row('Fee for', p.months_covered);
  row('Payment Mode', p.mode);
  if (p.note) row('Note', p.note);

  y += 4;
  doc.roundedRect(36, y, W, 54, 6).fillColor('#f3f4f6').fill();
  doc.font('Helvetica').fontSize(10).fillColor(muted).text('Amount Received', 48, y + 10);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(`Rs. ${money(p.amount)}`, 48, y + 24);
  doc.font('Helvetica').fontSize(8).fillColor(muted)
    .text(amountInWords(p.amount), 200, y + 30, { width: W - 176, align: 'right' });
  y += 70;

  if (typeof p.balance_after === 'number') {
    const label = p.balance_after > 0 ? `Balance due: Rs. ${money(p.balance_after)}`
      : p.balance_after < 0 ? `Advance credit: Rs. ${money(-p.balance_after)}` : 'No balance due';
    doc.font('Helvetica').fontSize(10).fillColor(ink).text(label, 36, y);
    y = doc.y + 30;
  } else {
    y += 20;
  }

  doc.moveTo(36 + W - 140, y + 20).lineTo(36 + W, y + 20).strokeColor('#9ca3af').stroke();
  doc.font('Helvetica').fontSize(9).fillColor(muted).text('Authorised Signature', 36 + W - 140, y + 26, { width: 140, align: 'center' });

  doc.fontSize(8).fillColor(muted)
    .text('This is a computer generated receipt.', 36, doc.page.height - 50, { width: W, align: 'center' });

  doc.end();
}

module.exports = { writeReceipt };
