/* ============================================================
   REALITY FX — js/pdf.js — downloadable invoices
   ------------------------------------------------------------
   A minimal, dependency-free PDF writer so students can actually
   DOWNLOAD their invoice (not only print it). ASCII-safe on
   purpose: PDF standard fonts (Helvetica) cannot render Unicode.

   Production seam: swap this for a real PDF library (pdf-lib /
   jsPDF) or a server-generated PDF — the call site stays
   `RFX.pdf.downloadInvoice(enr)`.
   ============================================================ */
window.RFX = window.RFX || {};

(function () {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- text helpers ---------- */
  function pdfSafe(s) {
    const map = {
      '\u2014': '-', '\u2013': '-', '\u2018': "'", '\u2019': "'",
      '\u201C': '"', '\u201D': '"', '\u2022': '*', '\u00B7': '|',
      '\u00A0': ' ', '\u2026': '...', '\u2192': '->', '\u2713': '[PAID]',
    };
    return String(s == null ? '' : s)
      .split('').map(ch => (ch in map ? map[ch] : ch)).join('')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function money(amount, currency) {
    const n = Number(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (currency || 'R') + ' ' + n;
  }

  /* ---------- PDF assembly ---------- */
  function buildPdf(objects) {
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach(function (body) {
      offsets.push(pdf.length);
      pdf += (offsets.length) + ' 0 obj\n' + body + '\nendobj\n';
    });
    const xrefPos = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    return pdf;
  }

  /* A4-ish letter page (612x792pt), one page, Helvetica text. */
  function invoicePdf(enr) {
    const p = enr.payment || {};
    const inv = enr.invoice || {};
    const W = 612, M = 56;
    const out = [];
    const T = (x, yy, size, str, bold) =>
      out.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + pdfSafe(str) + ') Tj ET');
    const L = (yy) => out.push(M.toFixed(1) + ' ' + yy.toFixed(1) + ' m ' + (W - M).toFixed(1) + ' ' + yy.toFixed(1) + ' l S');
    const R = 350; // right column x

    // header
    T(M, 740, 22, 'REALITY FX', true);
    T(M + 1, 726, 8, 'THE TRADING ACADEMY  |  ENROLLMENT - REGISTRATION - IDENTITY', false);
    L(714);
    T(M, 688, 16, 'OFFICIAL INVOICE', true);
    // meta (right)
    T(R, 688, 10, 'Invoice  ' + pdfSafe(inv.number), true);
    T(R, 674, 9, 'Date: ' + fmtDate(inv.issuedAt));
    T(R, 661, 9, 'Status: PAID', false);
    // billed to
    T(M, 650, 8, 'BILLED TO', false);
    T(M, 636, 12, p.customerName || '', true);
    T(M, 621, 9, p.email || '');
    // table header
    L(600);
    T(M, 588, 9, 'DESCRIPTION', true);
    T(R, 588, 9, 'AMOUNT', true);
    L(578);
    // course row
    T(M, 558, 10, pdfSafe(p.course || '').slice(0, 62), false);
    T(W - M - 90, 558, 10, money(p.price, p.currency), false);
    T(M, 542, 8, '1 x enrollment - tuition', false);
    // total
    L(516);
    T(M, 500, 11, 'Total paid', true);
    T(W - M - 90, 500, 12, money(p.price, p.currency), true);
    L(488);
    // payment details
    T(M, 462, 8, 'PAYMENT', false);
    T(M, 448, 9, 'Method: ' + pdfSafe(p.paymentMethod || '-'), false);
    T(M, 434, 9, 'Transaction: ' + pdfSafe(p.transactionId || '-'), false);
    T(M, 420, 9, 'Paid: ' + fmtDate(p.paidAt), false);
    // footer
    L(120);
    T(M, 102, 8, 'This invoice confirms full payment for your Reality FX enrollment. A separate', false);
    T(M, 90, 8, 'registration email with your secure link was sent to your inbox.', false);
    T(M, 66, 8, 'Reality FX - realityfx20@gmail.com - realityfx.netlify.app', false);

    const stream = out.join('\n') + '\n';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
    ];
    return buildPdf(objects);
  }

  function invoiceBlob(enr) {
    return new Blob([invoicePdf(enr)], { type: 'application/pdf' });
  }

  function downloadInvoice(enr) {
    const blob = invoiceBlob(enr);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (enr.invoice.number || 'INVOICE') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  window.RFX.pdf = { invoiceBlob, downloadInvoice };
})();
