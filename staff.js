/* RFX Staff Portal — invite activation, sign-in, shift clock in/out, roster */
(function () {
  'use strict';

  const db = RFX.db, ui = RFX.ui;

  let me = null; // current staff member

  /* ---------------- url helpers ---------------- */
  function param(name) {
    const p = new URLSearchParams(location.search);
    return p.get(name);
  }

  /* ---------------- views ---------------- */
  function show(view) {
    ['screen-invite', 'screen-login', 'screen-panel'].forEach(v => {
      document.getElementById(v).hidden = v !== view;
    });
  }

  function roleLabel(role) {
    return role === 'admin' ? 'Admin' : role === 'reception' ? 'Reception' : role === 'approver' ? 'Approver' : 'Finance';
  }

  /* ---------------- invite activation ---------------- */
  function initInvite() {
    const token = param('invite');
    if (!token) return false;
    const v = db.validateStaffInvite(token);
    if (!v.ok) {
      // show the invite card WITH the error so the holder knows the link is dead
      document.getElementById('inv-name').textContent = 'Invite not available';
      document.getElementById('inv-code').disabled = true;
      document.getElementById('btn-activate').disabled = true;
      document.getElementById('inv-err').textContent = v.msg;
      document.getElementById('inv-err').hidden = false;
      show('screen-invite');
      return true;
    }
    const s = v.staff;
    document.getElementById('inv-name').textContent = s.name + ' — ' + roleLabel(s.role);
    show('screen-invite');
    return true;
  }

  function doActivate() {
    const token = param('invite');
    const code = document.getElementById('inv-code').value.trim();
    const res = db.activateStaff(token, code);
    if (!res.ok) {
      ui.toastErr(res.msg || 'Could not activate invite.');
      return;
    }
    ui.toastOk('Staff access activated — welcome aboard.');
    me = res.staff;
    showPanel();
  }

  /* ---------------- sign in ---------------- */
  let panelIv = null;
  function doLogin() {
    const email = document.getElementById('s-email').value.trim();
    const code = document.getElementById('s-code').value;
    const lock = document.getElementById('s-lockout');
    lock.hidden = true;
    const res = db.staffLogin(email, code);
    if (!res.ok) {
      if (res.locked) {
        lock.textContent = res.msg;
        lock.hidden = false;
      } else {
        ui.toastErr(res.msg || 'Sign-in failed.');
      }
      return;
    }
    ui.toastOk('Signed in — good to work.');
    me = res.staff;
    showPanel();
  }

  /* ---------------- panel ---------------- */
  function showPanel() {
    show('screen-panel');
    document.getElementById('st-name').textContent = me.name;
    document.getElementById('st-role').textContent = roleLabel(me.role);
    document.getElementById('st-shift').innerHTML = '<span class="pill gold">' + me.id + ' · ' + roleLabel(me.role) + '</span>';
    // admin-only: hire section
    document.getElementById('admin-invite').hidden = me.role !== 'admin';
    renderShift();
    renderRoster();
    renderMyWallet();
    refreshPill();
    if (panelIv) clearInterval(panelIv);
    panelIv = setInterval(function () { renderRoster(); refreshPill(); renderMyWallet(); }, 8000);
  }

  /* ---------------- my RFX wallet ---------------- */
  function renderMyWallet() {
    const box = document.getElementById('my-wallet');
    if (!box || !me) return;
    const w = db.staffWalletFor(me.id);
    const rows = (w.ledger || []).slice().reverse().slice(0, 6);
    box.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<span class="serif gold" style="font-size:26px;font-weight:600;">' + db.money(w.balance, w.currency) + '</span>' +
      '<span class="mono small" style="color:var(--gold-bright);">' + w.walletNo + '</span>' +
      '<span class="small faint">your RFX money</span></div>' +
      (rows.length
        ? '<div class="eyebrow muted" style="margin:4px 0 6px;">Recent</div><ul class="audit">' + rows.map(e =>
          '<li><span class="a-time">' + db.fmtDate(e.at) + '</span><span class="a-txt"><b style="color:#7ee2a4;">+' + db.money(e.amount, w.currency) + '</b> — ' + ui.esc(e.note || '') + ' <span class="small faint">(' + ui.esc(e.reference || '') + ')</span></span></li>'
        ).join('') + '</ul>'
        : '<p class="small faint">No funds yet. Finance adds money to this wallet when it is earned or approved.</p>');
  }

  function renderShift() {
    const shift = db.currentShift(me.id);
    const st = document.getElementById('shift-status');
    const outBtn = document.getElementById('btn-clock-out');
    if (shift) {
      st.innerHTML = '<span class="dot ok pulse"></span> On duty now · <b>' + (shift.type === 'night' ? 'night shift' : 'day shift') + '</b> since ' + new Date(shift.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      outBtn.hidden = false;
    } else {
      const last = me.shifts.length ? me.shifts[me.shifts.length - 1] : null;
      st.textContent = last ? ('Last shift ended ' + ui.fmtRelative(last.out) + '. Clock in to start a new shift.') : 'Not on a shift yet. Clock in to start.';
      outBtn.hidden = true;
    }
    renderMyShifts();
  }

  function renderMyShifts() {
    const list = document.getElementById('my-shifts');
    const shifts = (me.shifts || []).slice().reverse().slice(0, 8);
    if (!shifts.length) {
      list.innerHTML = '<li><span class="a-time">—</span><span class="a-txt faint">No shifts recorded yet.</span></li>';
      return;
    }
    const ic = RFX.icons && RFX.icons.clock ? RFX.icons.clock : '';
    list.innerHTML = shifts.map(sh => {
      const hrs = sh.out ? ((new Date(sh.out) - new Date(sh.in)) / 3600000).toFixed(1) : '…';
      return '<li><span class="a-time">' + new Date(sh.in).toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' · ' + (sh.type === 'night' ? 'night' : 'day') + '</span>' +
        '<span class="a-txt"><b>' + (sh.type === 'night' ? 'Night' : 'Day') + '</b> · ' + new Date(sh.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        (sh.out ? ' → ' + new Date(sh.out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + hrs + 'h' : ' · in progress') + '</span>' +
        '<span style="margin-left:auto;">' + ic + '</span></li>';
    }).join('');
  }

  function doClock(type) {
    const res = db.clockIn(me.id, type);
    if (!res.ok) { ui.toastErr(res.msg); return; }
    ui.toastOk('Clocked in — ' + (type === 'night' ? 'night' : 'day') + ' shift started.');
    me = db.staffById(me.id);
    renderShift(); renderRoster(); refreshPill();
  }

  function doClockOut() {
    const res = db.clockOut(me.id);
    if (!res.ok) { ui.toastErr(res.msg); return; }
    ui.toastOk('Clocked out — shift ended. Thank you.');
    me = db.staffById(me.id);
    renderShift(); renderRoster(); refreshPill();
  }

  /* ---------------- roster ---------------- */
  function rosterRow(s) {
    const shift = db.currentShift(s.id);
    const since = shift ? 'since ' + new Date(shift.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return '<li><span class="a-time">' + (s.id) + '</span>' +
      '<span class="a-txt"><b>' + ui.esc(s.name) + '</b> · ' + (s.role === 'admin' ? 'Admin' : s.role === 'reception' ? 'Reception' : s.role === 'approver' ? 'Approver' : 'Finance') +
      (shift ? ' <span class="dot ok pulse" style="vertical-align:middle;"></span>' : '') + '</span>' +
      '<span style="margin-left:auto;white-space:nowrap;">' + (shift ? '<span class="pill ok">On duty ' + since + '</span>' : '<span class="pill soon">Off</span>') + '</span></li>';
  }

  function renderRoster() {
    const onDuty = document.getElementById('roster');
    const all = document.getElementById('team-list');
    const duty = db.onDutyStaff();
    onDuty.innerHTML = duty.length ? duty.map(rosterRow).join('') : '<li><span class="a-txt faint">No one on duty right now — coverage gap.</span></li>';
    all.innerHTML = db.staff().map(rosterRow).join('');
  }

  /* ---------------- reception pill ---------------- */
  function refreshPill() {
    const pill = document.getElementById('on-duty-pill');
    if (!pill) return;
    const n = db.onDutyCount();
    pill.innerHTML = n > 0
      ? '<span class="dot ok pulse"></span> Reception · 24/7 · ' + n + ' on duty'
      : '<span class="dot warn"></span> Reception · 24/7 · checking coverage…';
  }

  /* ---------------- hire (admin) ---------------- */
  function doHire() {
    const name = document.getElementById('h-name').value.trim();
    const email = document.getElementById('h-email').value.trim();
    const role = document.getElementById('h-role').value;
    const out = document.getElementById('hire-result');
    const res = db.createStaff({ name, email, role, by: me ? me.name : 'Reality FX Admin' });
    if (!res.ok) { out.innerHTML = '<span class="small" style="color:#f0a89c;">' + ui.esc(res.msg) + '</span>'; return; }
    document.getElementById('h-name').value = '';
    document.getElementById('h-email').value = '';
    out.innerHTML = '<span class="small" style="color:#7ee2a4;">' + (RFX.icons && RFX.icons.checkCircle ? '<span style="vertical-align:middle;">' + RFX.icons.checkCircle + '</span> ' : '') + ui.esc(res.staff.name) + ' invited — the invite email is in the <a href="mailbox.html" style="color:var(--gold-bright);">Mailbox</a>. One-time link, 7-day expiry.</span>';
    renderRoster();
  }

  /* ---------------- multi-tab safety ---------------- */
  // If another tab adopts a newer store revision, refresh our staff reference so
  // clock-in/out and roster actions always land on the live record.
  window.addEventListener('rfx:sync', function () {
    if (!me) return;
    const live = db.staffById(me.id);
    if (live && live !== me) {
      me = live;
      if (document.getElementById('screen-panel') && !document.getElementById('screen-panel').hidden) {
        renderShift(); renderRoster(); renderMyWallet(); refreshPill();
      }
    }
  });

  /* ---------------- sign out ---------------- */
  function doLogout() {
    if (panelIv) { clearInterval(panelIv); panelIv = null; }
    me = null;
    show('screen-login');
    ui.toastOk('Signed out.');
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (initInvite()) {
      document.getElementById('btn-activate').addEventListener('click', doActivate);
    } else {
      show('screen-login');
      document.getElementById('btn-staff-login').addEventListener('click', doLogin);
      document.getElementById('s-code').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    }
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.getElementById('btn-clock-day').addEventListener('click', () => doClock('day'));
    document.getElementById('btn-clock-night').addEventListener('click', () => doClock('night'));
    document.getElementById('btn-clock-out').addEventListener('click', doClockOut);
    document.getElementById('btn-hire').addEventListener('click', doHire);
    refreshPill();
  });
})();
