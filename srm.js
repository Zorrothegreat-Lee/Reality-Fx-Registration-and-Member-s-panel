/* Students (SRM) — srm.html
   The Student Relationship Manager: every enrollment is a relationship record.
   Search, filter, open a full profile (identity, wallet, awards, spend, audit). */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  const $ = id => document.getElementById(id);

  function kpis() {
    const all = db.enrollments();
    const active = all.filter(e => e.state === 'ACTIVE').length;
    const approved = all.filter(e => e.state === 'APPROVED' || e.state === 'RFX_OS_CONFIRMED' || e.state === 'SYNCING_WITH_RFX_OS').length;
    const wallets = db.wallets().filter(w => w.balance > 0).length;
    $('srm-count').innerHTML = '<span class="dot gold"></span> ' + all.length + ' records · ' + active + ' active';
    $('srm-chips').innerHTML = [
      '<span class="pill ok">' + active + ' active</span>',
      '<span class="pill info">' + approved + ' approved</span>',
      '<span class="pill gold">' + wallets + ' wallets with credit</span>',
    ].join(' ');
  }

  function countryOf(e) {
    return (e.registration && e.registration.personal && e.registration.personal.country) || '—';
  }

  function render() {
    const q = $('srm-q').value.trim().toLowerCase();
    const f = $('srm-filter').value;
    const all = db.enrollments();
    const list = all.filter(e => {
      if (f && e.state !== f) return false;
      if (!q) return true;
      const hay = [
        e.payment.customerName, e.payment.email, e.payment.course,
        e.studentId || '', e.studentCode || '', e.id, countryOf(e),
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    const box = $('srm-list');
    if (!all.length) {
      box.innerHTML = '<div class="empty-state"><div class="e-ic">' + (RFX.icons.users || '') + '</div><div class="e-t">No students yet</div>' +
        '<p class="small">Every enrollment becomes a relationship record the moment it is created — approved or not. Create one in the Staff Console to see it here.</p></div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty-state" style="padding:26px;"><div class="e-t">No records match</div><p class="small">Try a different search or clear the stage filter.</p></div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr>' +
      '<th>Student</th><th>ID</th><th>Course</th><th>Country</th><th>Wallet</th><th>State</th><th></th>' +
      '</tr></thead><tbody>' +
      list.map(e => {
        const w = db.getWallet(e.payment.email);
        return '<tr data-id="' + e.id + '">' +
          '<td><b style="color:var(--text);">' + ui.esc(e.payment.customerName) + '</b><div class="small faint">' + ui.esc(e.payment.email) + '</div></td>' +
          '<td class="mono small">' + (e.studentId || '<span class="faint">—</span>') + '</td>' +
          '<td class="small" style="color:var(--muted);">' + ui.esc(e.payment.course) + '<div class="small faint">' + db.money(e.payment.price, e.payment.currency) + '</div></td>' +
          '<td class="small">' + ui.esc(countryOf(e)) + '</td>' +
          '<td class="small" style="color:var(--muted);">' + (w.balance > 0 ? '<span class="gold">' + db.money(w.balance, w.currency) + '</span>' : '<span class="faint">R0.00</span>') + '</td>' +
          '<td>' + ui.statePill(e.state) + '</td>' +
          '<td style="text-align:right;"><span class="btn btn-dark btn-sm">Profile</span></td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openProfile(tr.dataset.id)));
  }

  /* ---------------- profile ---------------- */
  function merchLine(e) {
    const mine = db.merchByEmail(e.payment.email);
    if (!mine.length) return '';
    const bits = mine.map(o => o.kind === 'earned'
      ? 'reward (avg ' + o.average + '%) — ' + (db.MERCH_STATUS_LABELS[o.status] || o.status)
      : (o.items[0] ? o.items[0].name : 'merch') + ' — ' + (db.MERCH_STATUS_LABELS[o.status] || o.status)).join('; ');
    return '<dt>Merch</dt><dd>' + ui.esc(bits) + '</dd>';
  }
  function printLine(e) {
    const pt = e.printTrust || {};
    if (pt.level === 'trusted') {
      return '<dt>Print access</dt><dd><span class="pill ok" style="font-size:9px;">trusted</span> granted ' + db.fmtDateShort(pt.grantedAt) + ' by ' + ui.esc(pt.grantedBy || '—') +
        ' <button class="btn btn-dark btn-sm" style="margin-left:8px;" onclick="RFX.srmRevokePrint(\'' + e.id + '\')">Revoke</button></dd>';
    }
    if (pt.revokedAt) {
      return '<dt>Print access</dt><dd><span class="pill danger" style="font-size:9px;">revoked</span> ' + db.fmtDateShort(pt.revokedAt) + ' <button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="RFX.srmGrantPrint(\'' + e.id + '\')">Re-grant</button></dd>';
    }
    return '<dt>Print access</dt><dd><span class="pill" style="font-size:9px;">standard</span> watermarked · print blacked out' +
      ' <button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="RFX.srmGrantPrint(\'' + e.id + '\')">Grant (earned trust)</button></dd>';
  }
  function cooldownLine(e) {
    if (e.cooldownFlag) {
      return '<dt>Cooldown</dt><dd><span class="pill warn" style="font-size:9px;">refunded identity</span> re-enrollment blocked until ' + db.fmtDateShort(e.cooldownFlag.until) + ' <span class="small faint">(' + e.cooldownFlag.daysLeft + 'd left · prior refund ' + e.cooldownFlag.priorRefund + ')</span></dd>';
    }
    if (e.resolution && e.resolution.materialRevoked) {
      return '<dt>Revoked</dt><dd><span class="pill danger" style="font-size:9px;">material rights revoked</span> on refund — re-enroll eligible ' + db.fmtDateShort(e.resolution.reapplyEligibleAt) + '</dd>';
    }
    return '';
  }

  function openProfile(id) {
    const e = db.byId(id);
    if (!e) return;
    const w = db.getWallet(e.payment.email);
    const I = RFX.icons || {};
    const reg = e.registration || {};
    const ledger = (w.ledger || []).slice().reverse().slice(0, 12);
    const audit = (e.audit || []).slice().reverse().slice(0, 10);
    const identity = reg.personal || {};

    const ledgerRows = ledger.length
      ? ledger.map(x => {
        const signed = x.amount < 0
          ? '<b style="color:#f0a89c;">-' + db.money(Math.abs(x.amount), w.currency) + '</b>'
          : '<b style="color:#7ee2a4;">+' + db.money(x.amount, w.currency) + '</b>';
        return '<li><span class="a-time">' + db.fmtDateShort(x.at) + '</span><span class="a-txt">' + signed + ' ' + ui.esc(x.note || '') + ' <span class="small faint">(' + ui.esc(x.ref || x.type || '') + ')</span></span></li>';
      }).join('')
      : '<li><span class="a-txt faint">No wallet activity yet — balance starts at R0.00.</span></li>';

    const auditRows = audit.length
      ? audit.map(a => '<li><span class="a-time">' + db.fmtDateShort(a.at) + '</span><span class="a-txt"><b>' + ui.esc(a.event) + '</b> — ' + ui.esc(a.detail) + '</span></li>').join('')
      : '<li><span class="a-txt faint">No events recorded.</span></li>';

    const m = ui.modal(
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap;">' +
      '<div class="avatar-lg">' + (e.payment.customerName || '?').charAt(0).toUpperCase() + '</div>' +
      '<div style="flex:1;"><h3 class="serif" style="font-size:21px;margin-bottom:2px;">' + ui.esc(e.payment.customerName) + '</h3>' +
      '<div class="small faint">' + ui.esc(e.payment.email) + ' · ' + ui.esc(countryOf(e)) + '</div></div>' +
      ui.statePill(e.state) + '</div>' +
      '<dl class="kv" style="margin-bottom:16px;">' +
      '<dt>Student ID</dt><dd class="mono gold">' + (e.studentId || '—') + '</dd>' +
      '<dt>Student Code</dt><dd class="mono">' + (e.studentCode ? 'RFX-••••' : '—') + '</dd>' +
      '<dt>Enrollment</dt><dd class="mono">' + e.id + '</dd>' +
      '<dt>Course</dt><dd>' + ui.esc(e.payment.course) + '</dd>' +
      '<dt>Paid</dt><dd>' + db.money(e.payment.price, e.payment.currency) + ' · ' + db.fmtDateShort(e.payment.paidAt) + '</dd>' +
      '<dt>Invoice</dt><dd class="mono">' + e.invoice.number + '</dd>' +
      '<dt>Wallet</dt><dd class="mono">' + w.walletNo + '</dd>' +
      '<dt>Balance</dt><dd><b class="gold">' + db.money(w.balance, w.currency) + '</b> · ' + db.money(db.spendable(e.payment.email), w.currency) + ' spendable</dd>' +
      (identity.fullName ? '<dt>Full name</dt><dd>' + ui.esc(identity.fullName) + '</dd>' : '') +
      (reg.emailVerifiedAt ? '<dt>Email</dt><dd><span class="pill ok" style="font-size:9px;">verified</span> ' + db.fmtDateShort(reg.emailVerifiedAt) + '</dd>' : '') +
      (reg.captchaPassedAt ? '<dt>Human</dt><dd><span class="pill ok" style="font-size:9px;">captcha passed</span></dd>' : '') +
      (reg.termsAcceptedAt ? '<dt>Agreements</dt><dd>accepted ' + db.fmtDateShort(reg.termsAcceptedAt) + ' <span class="small faint">(v' + ui.esc(reg.agreementVersion || '?') + ')</span></dd>' : '') +
      (e.handoff && e.handoff.confirmedAt ? '<dt>RFX OS</dt><dd><span class="pill ok" style="font-size:9px;">handshake confirmed</span> ' + db.fmtDateShort(e.handoff.confirmedAt) + '</dd>' : '') +
      merchLine(e) + cooldownLine(e) + printLine(e) +
      '</dl>' +
      '<div class="eyebrow muted" style="margin:6px 0 6px;">Wallet ledger</div>' +
      '<ul class="audit">' + ledgerRows + '</ul>' +
      '<div class="eyebrow muted" style="margin:16px 0 6px;">Journey &amp; events</div>' +
      '<ul class="audit">' + auditRows + '</ul>');
    m.setTitle('Student relationship · ' + ui.esc(e.payment.customerName));
  }

  /* print-trust controls (exposed for inline onclick) */
  RFX.srmGrantPrint = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const m = ui.modal('<div class="eyebrow" style="margin-bottom:12px;">Grant print access</div>' +
      '<p class="small" style="margin-bottom:16px;">Printing course material is a <b style="color:var(--text);">privilege earned through trust</b>, not smarts. Grant it only to students the Academy trusts not to resell or redistribute material. The grant is recorded against the identity and rides the handoff payload so the OS enforces it at the backend.</p>' +
      '<div class="field"><label>Reason (recorded in the audit log)</label>' +
      '<input class="input" id="pt-note" placeholder="e.g. Maintained 85% average and a clean integrity record"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button class="btn btn-dark btn-sm" onclick="this.closest(\'.modal-back\').remove()">Cancel</button>' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.srmGrantPrintConfirm(\'' + id + '\')">Grant print access</button></div>');
    m.setTitle('Print access · ' + ui.esc(e.payment.customerName));
  };
  RFX.srmGrantPrintConfirm = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const note = document.getElementById('pt-note') ? document.getElementById('pt-note').value.trim() : '';
    db.grantPrintTrust(e, 'Staff', note || 'Earned trust');
    ui.toastOk('Print access granted to ' + ui.esc(e.payment.customerName) + ' — OS will honour it on next sync.');
    // close every open modal, then refresh the profile so it shows the granted state
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    render();
    openProfile(id);
  };
  RFX.srmRevokePrint = function (id) {
    const e = db.byId(id);
    if (!e) return;
    db.revokePrintTrust(e, 'Staff', 'Trust withdrawn');
    ui.toastErr('Print access revoked from ' + ui.esc(e.payment.customerName) + ' — OS watermark + print blackout restored.');
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    render();
    openProfile(id); // refresh the profile so it shows the revoked state
  };

  $('srm-q').addEventListener('input', render);
  $('srm-filter').addEventListener('change', render);
  render();
  setInterval(() => { kpis(); render(); }, 4000);
})();
