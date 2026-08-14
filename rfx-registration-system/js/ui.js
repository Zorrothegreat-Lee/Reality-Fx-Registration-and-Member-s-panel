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
  /* Toasts appear ONE at a time, in a smooth queue — never a rushed pile.
     Each waits for the previous to finish its visible life, then the next
     slides in. The queue is shared so bursts (sign-in + probe + notification)
     arrive as a calm sequence, not a stack. */
  const toastQueue = [];
  let toastShowing = false;
  function toast(msg, type) {
    toastQueue.push({ msg: String(msg), type: type || 'info' });
    pumpToasts();
  }
  function pumpToasts() {
    if (toastShowing || !toastQueue.length) return;
    const next = toastQueue.shift();
    toastShowing = true;
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const ic = window.RFX.icons || {};
    const icons = { ok: ic.checkCircle || '✓', warn: ic.alert || '⚠', err: ic.x || '✕', info: ic.info || 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + next.type + ' show';
    el.innerHTML = '<span class="t-ic">' + (icons[next.type] || icons.info) + '</span><span class="t-txt">' + esc(next.msg) + '</span>';
    box.appendChild(el);
    // visible life, then fade, then the NEXT toast takes its turn
    setTimeout(() => { el.classList.remove('show'); el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => { el.remove(); toastShowing = false; pumpToasts(); }, 420); }, 3400);
  }
  const toastOk = m => toast(m, 'ok');
  const toastWarn = m => toast(m, 'warn');
  const toastErr = m => toast(m, 'err');

  /* ---------------- modal ---------------- */
  function modal(html, opts) {
    opts = opts || {};
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal"><div class="modal-head"><div class="modal-title"></div><button class="modal-x" aria-label="Close">✕</button></div><div class="modal-body"></div></div>';
    back.querySelector('.modal-body').innerHTML = html;
    // onClose runs BEFORE the modal is removed — lets a caller release
    // resources (e.g. stop a webcam stream) on EVERY close path (✕, backdrop,
    // or an explicit close call), never just the ones it calls itself.
    const close = () => { if (opts.onClose) { try { opts.onClose(); } catch (e) {} } back.remove(); };
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

  /* Busy-button helper — locks a heavy button while its work runs, so a
     double-click can never fire the action twice or leave the user wondering
     whether the click landed. Stores the original label and swaps in a
     spinner; pass the ORIGINAL label to unlock and it restores it. */
  function busyButton(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.__rfxLabel = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('btn-busy');
      btn.innerHTML = '<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.35);border-top-color:currentColor;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:-2px;margin-right:7px;"></span>' + (label || 'Working…');
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-busy');
      if (btn.__rfxLabel) { btn.innerHTML = btn.__rfxLabel; delete btn.__rfxLabel; }
    }
  }
  /* keyframes for the busy spinner (defined once, applies everywhere) */
  (function () {
    if (!document.getElementById('rfx-spin-kf')) {
      const st = document.createElement('style');
      st.id = 'rfx-spin-kf';
      st.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
  })();

  /* Trust RING — the student's standing as a gold percentage ring, the same
     visual language as the RFX OS course-progress ring. Shared by the member
     panel and the SRM so the two surfaces can never disagree on the design. */
  let ringSeq = 0;
  function trustRingHTML(score, opts) {
    opts = opts || {};
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    const C = 2 * Math.PI * 42;
    // +0.5 epsilon keeps the flat butt caps overlapping at 100% (no hairline
    // seam at 12 o'clock) while 0% still draws nothing (offset lands exactly
    // at the dash end).
    const off = (C + 0.5) * (1 - s / 100);
    const tierCls = opts.tierCls || '';
    const cap = opts.cap || 'standing';
    const gid = 'rfxRing' + (++ringSeq) + '_' + Math.floor(Math.random() * 1e6);
    const grads =
      '<linearGradient id="' + gid + 'g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#8f6f1f"/><stop offset="55%" stop-color="#d4af37"/><stop offset="100%" stop-color="#f0d98c"/></linearGradient>' +
      '<linearGradient id="' + gid + 'a" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#8a5a1c"/><stop offset="55%" stop-color="#c08a2a"/><stop offset="100%" stop-color="#e0b45c"/></linearGradient>' +
      '<linearGradient id="' + gid + 'o" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#8f3a1f"/><stop offset="55%" stop-color="#e07b2a"/><stop offset="100%" stop-color="#f0a45c"/></linearGradient>' +
      '<linearGradient id="' + gid + 'r" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#8f2417"/><stop offset="55%" stop-color="#e76f51"/><stop offset="100%" stop-color="#f4a08a"/></linearGradient>' +
      // The glow is an SVG filter (Gaussian blur of the drawn arc) — it hugs
      // the stroke shape itself, so there is NEVER a box or halo square around
      // the ring, just light that follows the gold line.
      '<filter id="' + gid + 'f" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="2.6" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
      + '</filter>';
    const gradUrl = tierCls === 'caution' ? (gid + 'a') : tierCls === 'low' ? (gid + 'o') : tierCls === 'crit' ? (gid + 'r') : (gid + 'g');
    // The clean RFX OS course-completion ring: a dark disc, a thin track, and a
    // single gold arc. No glow, no diamond, no shadows — deliberately identical
    // to the OS so both systems speak one design dialect.
    return '<div class="trust-ring ' + tierCls + '">' +
      '<svg viewBox="0 0 100 100"><defs>' + grads + '</defs>' +
      '<circle class="tr-disc" cx="50" cy="50" r="42"/>' +
      '<circle class="tr-track" cx="50" cy="50" r="42"/>' +
      // --tr drives the draw-on-load animation (CSS animates dashoffset to it);
      // the inline dashoffset starts empty (C) so the ring never flashes full.
      '<circle class="tr-fill" cx="50" cy="50" r="42" style="--tr:' + off.toFixed(2) + ';stroke-dasharray:' + C + ';stroke-dashoffset:' + C + ';stroke:url(#' + gradUrl + ');filter:url(#' + gid + 'f)"/>' +
      '</svg>' +
      '<div class="tr-center"><div class="tr-pct">' + s + '%</div><div class="tr-cap">' + esc(cap) + '</div>' +
      (s === 0 ? '<div class="tr-crit">restricted</div>' : '') +
      '</div>' +
      '</div>';
  }

  /* ---------------- RFX CALENDAR — the classy gold date picker ----------------
     One branded calendar for the whole system. Click the calendar icon, pick
     any day / month / year. Two flavours:
       • mode 'day'   → picks a day-of-month (staff payday) — the value stored
         is the integer day (1-28), the display reads "15th of month".
       • mode 'date'  → picks a full date (student DOB) — the value stored is
         ISO "YYYY-MM-DD", the display reads "15 Aug 2002".
     Popover opens on the 📅 trigger (or the field itself), closes on outside
     click / Escape / after picking. Month nav ‹ ›, month dropdown, and a
     year-grid jump. The selected day is gold-filled; today gets a gold ring. */
  function calendarPicker(host, opts) {
    opts = opts || {};
    const mode = opts.mode || 'date';
    if (host && host.__rfxCal) return null; // never wrap the same field twice
    if (host) host.__rfxCal = true;
    const wrap = document.createElement('span');
    wrap.className = 'rfx-cal';
    host.parentNode.insertBefore(wrap, host);
    wrap.appendChild(host);
    host.classList.add('rfx-cal-input');
    host.setAttribute('readonly', 'readonly');
    host.setAttribute('autocomplete', 'off');
    // a11y: the field and trigger are both buttons that open the same calendar
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trg = document.createElement('button');
    trg.type = 'button';
    trg.className = 'rfx-cal-trigger';
    trg.title = 'Open calendar';
    trg.setAttribute('aria-label', 'Open calendar');
    trg.innerHTML = (window.RFX.icons && window.RFX.icons.calendar) || '📅';
    wrap.appendChild(trg);
    const pop = document.createElement('div');
    pop.className = 'rfx-cal-pop';
    wrap.appendChild(pop);

    // current display state: the month/year being shown + the picked value
    let cur = new Date();
    let yv = null;      // year-grid open: true when jumping years
    let yOff = 0;       // decade offset for the year grid (±8 window, paged)
    let selDate = null; // full Date of the picked day (mode 'date')
    let selDay = null;  // number 1-28 (mode 'day')
    let closed = false;

    // seed from the field's existing value (e.g. a saved payday / DOB)
    if (mode === 'day') {
      const v = parseInt(host.value, 10);
      if (v > 0 && v <= 31) { selDay = v; }
    } else if (host.value) {
      const d = new Date(host.value);
      if (!isNaN(d.getTime())) selDate = d;
    }

    function nth(n) {
      const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function fmtDisplay() {
      return mode === 'day'
        ? (selDay ? nth(selDay) + ' of month' : '')
        : (selDate ? MONTHS_S[selDate.getMonth()] + ' ' + selDate.getDate() + ', ' + selDate.getFullYear() : '');
    }
    function storedValue() {
      return mode === 'day'
        ? (selDay ? String(selDay) : '')
        : (selDate ? selDate.getFullYear() + '-' + String(selDate.getMonth() + 1).padStart(2, '0') + '-' + String(selDate.getDate()).padStart(2, '0') : '');
    }
    function refreshField() {
      host.value = fmtDisplay();
      host.dataset.rfxVal = storedValue(); // machine-readable: payday int / ISO date
      if (opts.onPick) opts.onPick(storedValue(), host);
    }

    function close() {
      pop.classList.remove('open');
      closed = true;
    }
    function outside(e) {
      if (!wrap.contains(e.target)) close();
    }
    function esc(e) { if (e.key === 'Escape') close(); }
    function open() {
      closed = false;
      // re-sync internal selection from the field — the wallet sync path and
      // prefillPersonal set value + dataset.rfxVal programmatically, so on open
      // we re-read them to highlight the saved day (payday / saved DOB)
      const raw = host.dataset.rfxVal || host.value || '';
      if (mode === 'day') {
        const v = parseInt(raw, 10);
        if (v > 0 && v <= 28) selDay = v;
      } else if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) selDate = d;
      }
      pop.classList.add('open');
      // one open calendar at a time
      document.querySelectorAll('.rfx-cal-pop.open').forEach(p => { if (p !== pop) p.classList.remove('open'); });
      setTimeout(() => document.addEventListener('mousedown', outside), 0);
      document.addEventListener('keydown', esc);
    }

    function render() {
      if (closed) return;
      const y = cur.getFullYear(), m = cur.getMonth();
      const today = new Date();
      if (yv) {
        // year-jump grid: 4 columns over a 16-year window, paged with ‹ › so
        // ANY year is reachable (a DOB from the 1970s needs the same clicks as
        // next month). The window snaps to decades so paging feels consistent.
        const base = Math.floor(y / 10) * 10 + yOff * 16;
        const cells = [];
        for (let i = 0; i < 16; i++) {
          const yy = base + i;
          cells.push('<button type="button" class="rfx-cal-ycell' + (yy === y ? ' sel' : '') + '" data-y="' + yy + '">' + yy + '</button>');
        }
        pop.innerHTML =
          '<div class="rfx-cal-head">' +
          '<button type="button" class="rfx-cal-nav" data-yback="1" title="Earlier years">‹</button>' +
          '<div class="rfx-cal-title">' + base + ' – ' + (base + 15) + '</div>' +
          '<button type="button" class="rfx-cal-nav" data-yfwd="1" title="Later years">›</button></div>' +
          '<div class="rfx-cal-years">' + cells.join('') + '</div>' +
          '<div class="rfx-cal-foot"><button type="button" class="rfx-cal-today" data-back="1">← Back to months</button>' +
          '<div class="rfx-cal-mono">' + y + '</div></div>';
        pop.querySelector('[data-yback]').addEventListener('click', () => { yOff -= 1; render(); });
        pop.querySelector('[data-yfwd]').addEventListener('click', () => { yOff += 1; render(); });
        pop.querySelector('[data-back]').addEventListener('click', () => { yOff = 0; yv = false; render(); });
        pop.querySelectorAll('.rfx-cal-ycell').forEach(c => c.addEventListener('click', () => {
          cur = new Date(Number(c.dataset.y), m, 1);
          yv = false;
          yOff = 0;
          render();
        }));
        return;
      }
      const first = new Date(y, m, 1).getDay(); // 0 = Sunday
      // day-of-month mode (payday) caps at 28 — every month has one, and the
      // payroll engine schedules by day-of-month (never the 30th/31st)
      const days = mode === 'day' ? Math.min(new Date(y, m + 1, 0).getDate(), 28) : new Date(y, m + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < first; i++) cells += '<span class="rfx-cal-cell empty"></span>';
      for (let d = 1; d <= days; d++) {
        const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
        const sel = mode === 'day'
          ? (selDay === d)
          : (selDate && selDate.getFullYear() === y && selDate.getMonth() === m && selDate.getDate() === d);
        cells += '<button type="button" class="rfx-cal-cell' + (isToday ? ' today' : '') + (sel ? ' sel' : '') + '" data-d="' + d + '">' + d +
          (isToday && !sel ? '<span class="rfx-cal-dot"></span>' : '') + '</button>';
      }
      pop.innerHTML =
        '<div class="rfx-cal-head">' +
        '<button type="button" class="rfx-cal-nav" data-m="-1" title="Previous month">‹</button>' +
        '<div class="rfx-cal-title">' + MONTHS[m] + ' <span class="rfx-cal-mono" style="cursor:pointer;" data-years="1" title="Jump to a year">' + y + '</span></div>' +
        '<button type="button" class="rfx-cal-nav" data-m="1" title="Next month">›</button></div>' +
        '<div class="rfx-cal-dow">' + ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => '<span' + (i === 0 || i === 6 ? ' class="wknd"' : '') + '>' + d + '</span>').join('') + '</div>' +
        '<div class="rfx-cal-grid">' + cells + '</div>' +
        '<div class="rfx-cal-foot"><button type="button" class="rfx-cal-today" data-today="1">Today</button>' +
        '<div class="rfx-cal-pick">' + (selDate || selDay
          ? (mode === 'day' ? 'Payday: <b>' + nth(selDay) + '</b>' : 'Picked: <b>' + MONTHS_S[selDate.getMonth()] + ' ' + selDate.getDate() + ' ' + selDate.getFullYear() + '</b>')
          : '<span class="small faint">Pick a day</span>') + '</div></div>';
      pop.querySelector('[data-m="-1"]').addEventListener('click', () => { cur = new Date(y, m - 1, 1); render(); });
      pop.querySelector('[data-m="1"]').addEventListener('click', () => { cur = new Date(y, m + 1, 1); render(); });
      pop.querySelector('[data-years]').addEventListener('click', () => { yv = true; render(); });
      pop.querySelector('[data-today]').addEventListener('click', () => {
        cur = new Date();
        if (mode === 'day') { selDay = today.getDate(); }
        else { selDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()); }
        refreshField();
        render();
      });
      pop.querySelectorAll('.rfx-cal-cell:not(.empty)').forEach(c => c.addEventListener('click', () => {
        const d = Number(c.dataset.d);
        if (mode === 'day') selDay = d;
        else selDate = new Date(y, m, d);
        refreshField();
        close();
        if (opts.onChange) opts.onChange(storedValue());
      }));
    }

    function toggle() {
      if (pop.classList.contains('open')) close();
      else { yv = false; yOff = 0; open(); render(); }
    }
    trg.addEventListener('click', toggle);
    host.addEventListener('click', toggle);
    host.addEventListener('focus', e => { e.target.blur(); });
    // drop the outside/keydown listeners once the popover is gone
    const obs = new MutationObserver(() => {
      if (!pop.classList.contains('open')) {
        document.removeEventListener('mousedown', outside);
        document.removeEventListener('keydown', esc);
      }
    });
    obs.observe(pop, { attributes: true, attributeFilter: ['class'] });
    return { open, close, render, refreshField };
  }

  /* ---------------- download an email as a standalone .html file ---------------- */
  /* Shared by the staff mailbox and the student mailbox: renders the email's
     branded HTML into a self-contained file you can save, file or print. */
  function downloadEmail(m) {
    const when = String(m.sentAt || '').slice(0, 10);
    const slug = String(m.subject || m.kind || 'email').replace(/[^\w-]+/g, '-').slice(0, 60);
    const doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + esc(m.subject) + '</title>' +
      '<style>body{font-family:Segoe UI,Arial,sans-serif;background:#f3f1ea;margin:0;padding:32px;} .wrap{max-width:760px;margin:0 auto;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden;padding:28px 34px;} .meta{font-size:12.5px;color:#777;border-bottom:1px solid #e5e2d8;padding-bottom:14px;margin-bottom:22px;}</style></head>' +
      '<body><div class="wrap"><div class="meta"><b>Reality FX — ' + esc(m.subject) + '</b><br>To: ' + esc(m.to) + ' · ' + RFX.db.fmtDate(m.sentAt) + ' · Filed from the RFX Mailbox</div>' +
      m.html +
      '</div></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    a.download = 'RFX-' + slug + '-' + when + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  RFX.ui = { esc, toast, toastOk, toastWarn, toastErr, modal, statePill, stateDot, pillarBar, pillarProgress, invoiceHTML, copyText, fmtRelative, STATE_LABELS, trustRingHTML, downloadEmail, calendarPicker, busyButton };
})();
