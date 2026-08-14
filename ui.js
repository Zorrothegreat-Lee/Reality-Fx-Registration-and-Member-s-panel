/* ============================================================
   REALITY FX — shared UI helpers (toasts, modal, labels)
   ============================================================ */

window.RFX = window.RFX || {};

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- toasts ---------------- */
  function toast(msg, type) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const ic = window.RFX.icons || {};
    const icons = { ok: ic.checkCircle || '✓', warn: ic.alert || '⚠', err: ic.x || '✕', info: ic.info || 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = '<span class="t-ic">' + (icons[type] || icons.info) + '</span><span class="t-txt">' + esc(msg) + '</span>';
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 420); }, 3600);
  }
  const toastOk = m => toast(m, 'ok');
  const toastWarn = m => toast(m, 'warn');
  const toastErr = m => toast(m, 'err');

  /* ---------------- modal ---------------- */
  function modal(html) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal"><div class="modal-head"><div class="modal-title"></div><button class="modal-x" aria-label="Close">✕</button></div><div class="modal-body"></div></div>';
    back.querySelector('.modal-body').innerHTML = html;
    const close = () => back.remove();
    back.querySelector('.modal-x').addEventListener('click', close);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.body.appendChild(back);
    return {
      el: back,
      setTitle: t => { back.querySelector('.modal-title').innerHTML = t; },
      close,
    };
  }

  /* ---------------- state -> label / pill class ---------------- */
  const STATE_LABELS = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    SYNCING_WITH_RFX_OS: 'Syncing with RFX OS',
    RFX_OS_CONFIRMED: 'RFX OS confirmed',
    ACTIVE: 'Active',
    SYNC_FAILED: 'Sync failed',
    REJECTED: 'Rejected',
    REFUNDED: 'Refunded',
  };
  const STATE_PILL = {
    PENDING: 'warn',
    APPROVED: 'info',
    SYNCING_WITH_RFX_OS: 'warn',
    RFX_OS_CONFIRMED: 'info',
    ACTIVE: 'ok',
    SYNC_FAILED: 'danger',
    REJECTED: 'danger',
    REFUNDED: 'danger',
  };
  function statePill(state) {
    return '<span class="pill ' + (STATE_PILL[state] || '') + '">' + esc(STATE_LABELS[state] || state) + '</span>';
  }
  function stateDot(state) {
    const map = { PENDING: 'warn', APPROVED: 'info', SYNCING_WITH_RFX_OS: 'warn', RFX_OS_CONFIRMED: 'info', ACTIVE: 'ok', SYNC_FAILED: 'danger', REJECTED: 'danger' };
    const pulse = (state === 'SYNCING_WITH_RFX_OS') ? ' pulse' : '';
    return '<span class="dot ' + (map[state] || '') + pulse + '"></span>';
  }

  /* ---------------- the five-pillar pipeline ---------------- */
  const PILLARS = [
    { key: 'purchase', icon: 'cart', label: 'Purchase' },
    { key: 'invoice', icon: 'receipt', label: 'Invoice' },
    { key: 'register', icon: 'edit', label: 'Registration' },
    { key: 'approve', icon: 'checkCircle', label: 'Approval' },
    { key: 'handoff', icon: 'link', label: 'Handoff' },
    { key: 'confirm', icon: 'flag', label: 'Confirmation' },
  ];
  function pillarIcon(name) {
    const ic = window.RFX.icons || {};
    return ic[name] || '';
  }
  function pillarProgress(enr) {
    const p = enr.progress || {};
    const keys = [];
    if (p.purchase) keys.push('purchase');
    if (p.invoiceEmail) keys.push('invoice');
    if (p.registrationSubmitted) keys.push('register');
    if (p.approved) keys.push('approve');
    if (p.handoffConfirmed) keys.push('handoff');
    if (p.active) keys.push('confirm');
    return keys;
  }
  function pillarBar(enr) {
    const done = pillarProgress(enr);
    const html = PILLARS.map(pl => {
      const cls = done.indexOf(pl.key) !== -1 ? 'done' : '';
      return '<div class="tl-step ' + cls + '"><div class="tl-node">' + pillarIcon(pl.icon) + '</div><div class="tl-lab">' + pl.label + '</div></div>';
    }).join('');
    return '<div class="timeline">' + html + '</div>';
  }

  /* ---------------- invoice (shared by Staff Console + Member panel) ---------------- */
  function invoiceHTML(enr) {
    const p = enr.payment;
    const db = window.RFX.db;
    const esc2 = esc;
    return '<div class="invoice print-area">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">' +
      '<img src="assets/logo.svg" style="width:150px;" alt="Reality FX">' +
      '<span class="pill ok" style="margin-left:auto;">' + (p ? 'PAID' : '') + '</span></div>' +
      '<div class="inv-top">' +
      '<div><div class="eyebrow muted">Official invoice</div><h3>INVOICE</h3></div>' +
      '<div class="inv-meta"><b>' + enr.invoice.number + '</b><br>' + db.fmtDateShort(enr.invoice.issuedAt) + '<br><b>Billed to</b><br>' + esc2(p.customerName) + '<br>' + esc2(p.email) + '</div>' +
      '</div>' +
      '<table>' +
      '<thead><tr><th>Description</th><th style="text-align:right;">Amount</th></tr></thead>' +
      '<tbody>' +
      '<tr><td>' + esc2(p.course) + '<div class="small faint">1 × enrollment · tuition</div></td><td style="text-align:right;">' + db.money(p.price, p.currency) + '</td></tr>' +
      '<tr class="inv-total"><td>Total paid</td><td class="amt" style="text-align:right;">' + db.money(p.price, p.currency) + '</td></tr>' +
      '</tbody>' +
      '</table>' +
      '<div class="inv-meta" style="margin-top:16px;text-align:left;">' +
      'Payment: <b>' + esc2(p.paymentMethod) + '</b> · Transaction <b class="mono">' + esc2(p.transactionId) + '</b> · ' + db.fmtDate(p.paidAt) +
      '</div>' +
      '<div class="inv-foot">This invoice confirms full payment for your Reality FX enrollment. ' +
      'Reality FX · realityfx20@gmail.com · realityfx.netlify.app</div>' +
      '</div>';
  }

  /* ---------------- misc ---------------- */
  function copyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
    toast('Copied to clipboard', 'ok');
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  RFX.ui = { esc, toast, toastOk, toastWarn, toastErr, modal, statePill, stateDot, pillarBar, pillarProgress, invoiceHTML, copyText, fmtRelative, STATE_LABELS };
})();
