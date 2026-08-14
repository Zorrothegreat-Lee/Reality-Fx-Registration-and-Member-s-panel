/* ============================================================
   REALITY FX — js/pdf.js — branded downloadable documents
   ------------------------------------------------------------
   A minimal, dependency-free PDF writer so students can actually
   DOWNLOAD their invoice and Academy prep guide (not only print).
   Brand layer: deep-black pages with Reality FX gold (#D4AF37)
   rules, panels and wordmark — the same design language as the
   site. ASCII-safe on purpose: PDF standard fonts (Helvetica)
   cannot render Unicode.

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
      '\u00A0': ' ', '\u2026': '...', '\u2192': '->', '\u2713': '[OK]',
      '\u2248': '~', '\u269C': '+',
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
    const n = Number(amount || 0).toFixed(2).replace(/\B(?=(?:\d{3})+(?!\d))/g, ',');
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

  /* ---------- brand palette (Reality FX gold on deep black) ---------- */
  const GOLD = '0.831 0.686 0.216';      // #D4AF37
  const GOLD_DEEP = '0.659 0.518 0.165'; // #A8842A
  const BG = '0.031 0.031 0.029';        // #080808 deep black
  const PANEL = '0.071 0.071 0.063';     // dark card
  const LIGHT = '0.918 0.902 0.874';     // warm off-white body
  const MUTED = '0.604 0.588 0.557';     // soft grey

  /* ---------- content-stream brand helpers ---------- */
  function rect(out, x, y, w, h, color) {
    out.push('q ' + color + ' rg ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + w.toFixed(1) + ' ' + h.toFixed(1) + ' re f Q');
  }
  function border(out, x, y, w, h, color, width) {
    out.push('q ' + (width || 0.4).toFixed(1) + ' w ' + color + ' RG ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + w.toFixed(1) + ' ' + h.toFixed(1) + ' re S Q');
  }
  function rule(out, x1, y, x2, color, width) {
    out.push('q ' + (width || 0.8).toFixed(1) + ' w ' + color + ' RG ' + x1.toFixed(1) + ' ' + y.toFixed(1) + ' m ' + x2.toFixed(1) + ' ' + y.toFixed(1) + ' l S Q');
  }
  function txt(out, x, y, size, str, color, bold) {
    out.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + color + ' rg ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + pdfSafe(str) + ') Tj ET');
  }

  /* One branded A4-ish page (612x792pt). Every page opens with the deep
     black field so the whole document reads as one gold-on-black piece. */
  function openPage(out, W, H) {
    rect(out, 0, 0, W, H, BG);
  }

  /* The masthead used on document openers: gold hairline, gold wordmark,
     muted tagline, gold rule. */
  function masthead(out, W, M) {
    rect(out, M, 768, W - 2 * M, 1, GOLD); // gold hairline
    txt(out, M, 746, 22, 'REALITY FX', GOLD, true);
    txt(out, M + 1, 731, 8, 'THE TRADING ACADEMY  |  ENROLLMENT - REGISTRATION - IDENTITY', MUTED, false);
    rule(out, M, 716, W - M, GOLD, 1.2);
  }

  /* Slim running header for inner pages: small gold wordmark left, page
     number right, gold rule beneath. */
  function slimHeader(out, W, M, pageNo) {
    rect(out, M, 768, W - 2 * M, 1, GOLD);
    txt(out, M, 746, 10, 'REALITY FX ACADEMY', GOLD, true);
    txt(out, W - M - 50, 746, 9, 'Page ' + pageNo, MUTED, false);
    rule(out, M, 734, W - M, GOLD, 0.8);
  }

  /* Branded footer: gold rule, muted line, and the student's ID as a
     personal mark — every page quietly carries whose copy it is. */
  function footer(out, W, M, enr, pageNo, withPrepared) {
    rule(out, M, 120, W - M, GOLD, 0.6);
    txt(out, M, 106, 8, 'Reality FX Academy - ' + ((RFX.db && RFX.db.prepGuideYear) ? RFX.db.prepGuideYear() : '2026'), MUTED, false);
    const id = (enr && enr.studentId) ? enr.studentId : 'Reality FX Student';
    txt(out, W - M - 150, 106, 8, id + ' | Reality FX', GOLD_DEEP, true);
    if (withPrepared) {
      txt(out, M, 92, 8, 'Prepared by the Reality FX Registrar - realityfx.netlify.app', MUTED, false);
    }
  }

  /* Word-wrap for body text. max = characters per line. */
  function wrapBody(str, max) {
    const words = String(str).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(function (w) {
      if ((line + ' ' + w).length > max) { if (line) lines.push(line); line = w; }
      else { line = line ? line + ' ' + w : w; }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* ---------------- the branded invoice ---------------- */
  function invoicePdf(enr) {
    const p = enr.payment || {};
    const inv = enr.invoice || {};
    const W = 612, M = 56, R = 350;
    const out = [];
    openPage(out, W, 792);
    masthead(out, W, M);

    // heading + meta (right)
    txt(out, M, 688, 16, 'OFFICIAL INVOICE', GOLD, true);
    txt(out, R, 688, 10, 'Invoice  ' + pdfSafe(inv.number), LIGHT, true);
    txt(out, R, 674, 9, 'Date: ' + fmtDate(inv.issuedAt), MUTED, false);
    txt(out, R, 661, 9, 'Status: ', MUTED, false);
    txt(out, R + 46, 661, 9, 'PAID', GOLD, true);

    // billed to (gold-trimmed dark panel)
    txt(out, M, 646, 8, 'BILLED TO', GOLD, true);
    rect(out, M, 592, W - 2 * M, 48, PANEL);
    border(out, M, 592, W - 2 * M, 48, GOLD, 0.4);
    txt(out, M + 14, 626, 12, pdfSafe(p.customerName || ''), LIGHT, true);
    txt(out, M + 14, 610, 9, pdfSafe(p.email || ''), MUTED, false);

    // line items
    rule(out, M, 580, W - M, GOLD, 0.8);
    txt(out, M, 566, 9, 'DESCRIPTION', GOLD, true);
    txt(out, W - M - 90, 566, 9, 'AMOUNT', GOLD, true);
    rule(out, M, 556, W - M, GOLD_DEEP, 0.4);
    txt(out, M, 538, 10, pdfSafe(p.course || '').slice(0, 62), LIGHT, false);
    txt(out, W - M - 90, 538, 10, money(p.price, p.currency), LIGHT, false);
    txt(out, M, 522, 8, '1 x enrollment - tuition', MUTED, false);

    // total (gold-trimmed band, gold figure)
    rect(out, M, 492, W - 2 * M, 34, PANEL);
    border(out, M, 492, W - 2 * M, 34, GOLD, 0.4);
    txt(out, M + 14, 512, 11, 'Total paid', LIGHT, true);
    txt(out, W - M - 90, 514, 13, money(p.price, p.currency), GOLD, true);

    // payment details
    txt(out, M, 468, 8, 'PAYMENT', GOLD, true);
    txt(out, M, 452, 9, 'Method: ' + pdfSafe(p.paymentMethod || '-'), MUTED, false);
    txt(out, M, 438, 9, 'Transaction: ' + pdfSafe(p.transactionId || '-'), MUTED, false);
    txt(out, M, 424, 9, 'Paid: ' + fmtDate(p.paidAt), MUTED, false);

    // footer
    rule(out, M, 120, W - M, GOLD, 0.6);
    txt(out, M, 106, 8, 'This invoice confirms full payment for your Reality FX enrollment. A separate', MUTED, false);
    txt(out, M, 92, 8, 'registration email with your secure link was sent to your inbox.', MUTED, false);
    txt(out, M, 68, 8, 'REALITY FX', GOLD, true);
    txt(out, M + 74, 68, 8, '| realityfx.netlify.app', MUTED, false);

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

  /* ---------------- the branded Academy prep guide ----------------
     A multi-page A4 letter, same content as the prep-guide email (read
     from db.prepGuideSections), so the student can save or print it.
     Page 1: masthead + metadata card + intro. One page per remaining
     section, with automatic continuation pages. */
  function prepGuidePdf(enr) {
    const secs = (RFX.db.prepGuideSections ? RFX.db.prepGuideSections() : []);
    const W = 612, H = 792, M = 56;
    const pages = [];
    let out = [];
    const flush = () => { pages.push(out.join('\n')); out = []; };
    const pageNo = () => pages.length + 1;
    const year = (RFX.db.prepGuideYear ? RFX.db.prepGuideYear() : '2026');

    // Page 1: masthead + metadata card + intro
    openPage(out, W, H);
    masthead(out, W, M);
    txt(out, M, 692, 17, 'ACADEMY PREPARATION GUIDE', GOLD, true);
    rule(out, M, 682, W - M, GOLD, 1);

    // metadata card
    rect(out, M, 606, W - 2 * M, 72, PANEL);
    border(out, M, 606, W - 2 * M, 72, GOLD, 0.4);
    const meta = [
      ['ACADEMY YEAR', 'Academy Year ' + year],
      ['STUDENT', enr.payment.customerName || '-'],
      ['EMAIL', enr.payment.email || '-'],
      ['STUDENT ID', enr.studentId || '-'],
    ];
    meta.forEach(function (r, i) {
      const y = 664 - i * 16;
      txt(out, M + 14, y, 8, r[0], GOLD, true);
      txt(out, M + 132, y, 9.5, pdfSafe(r[1] || '-'), LIGHT, true);
    });

    // intro
    rule(out, M, 594, W - M, GOLD_DEEP, 0.6);
    let yy = 574;
    (secs[0] ? wrapBody(secs[0].b, 96) : []).forEach(function (ln) {
      txt(out, M, yy, 10, pdfSafe(ln), LIGHT, false);
      yy -= 15;
    });
    footer(out, W, M, enr, 1, true);
    flush();

    // one page per remaining section (auto continuation when long)
    secs.slice(1).forEach(function (s, idx) {
      openPage(out, W, H);
      slimHeader(out, W, M, pageNo());
      const title = ((idx + 2) + '. ' + String(s.t || '')).toUpperCase();
      const titleSafe = pdfSafe(title.length > 64 ? title.slice(0, 61) + '...' : title);
      txt(out, M, 712, 14, titleSafe, GOLD, true);
      rule(out, M, 700, W - M, GOLD, 0.6);

      let y2 = 682;
      const lines = wrapBody(s.b || '', 96);
      lines.forEach(function (ln) {
        if (y2 < 130) {
          // overflow → new continuation page
          flush();
          openPage(out, W, H);
          slimHeader(out, W, M, pageNo());
          txt(out, M, 712, 12, pdfSafe(title.length > 64 ? title.slice(0, 61) + '...' : title) + '  (CONT.)', GOLD_DEEP, true);
          rule(out, M, 700, W - M, GOLD, 0.5);
          y2 = 682;
        }
        txt(out, M, y2, 10, pdfSafe(ln), LIGHT, false);
        y2 -= 16;
      });
      footer(out, W, M, enr, pageNo(), false);
      flush();
    });

    // object layout (after the 4 fixed objects below):
    //   page i  →  Page object at 5 + i*2,  /Contents stream at 6 + i*2
    const pageObjs = [];
    pages.forEach(function (stream, i) {
      pageObjs.push(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>',
        '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream'
      );
    });
    const kids = pages.map(function (_, i) { return (5 + i * 2) + ' 0 R'; }).join(' ');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
    ].concat(pageObjs);
    return buildPdf(objects);
  }

  function prepGuideBlob(enr) {
    return new Blob([prepGuidePdf(enr)], { type: 'application/pdf' });
  }

  function downloadPrepGuide(enr) {
    const blob = prepGuideBlob(enr);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RFX-Academy-Prep-Guide-' + (RFX.db.prepGuideYear ? RFX.db.prepGuideYear() : '2026') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  window.RFX.pdf = { invoiceBlob, downloadInvoice, prepGuideBlob, downloadPrepGuide };
})();
