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
      '<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;flex-wrap:wrap;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.key || '') + '</span>' +
      '<div style="flex:1;min-width:200px;"><div class="small" style="color:var(--text);font-weight:600;">Password recovery</div>' +
      '<div class="small faint">Passwords are stored as secure hashes — staff can never see or reset one. Send the student a self-service reset link instead.</div></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="RFX.srmSendReset(\'' + e.id + '\')">' + (I.mail || '') + ' Send reset link</button></div>' +
      identityFlagLine(e) +
      trustLine(e) +
      '<div class="grid2" style="align-items:start;margin-top:10px;gap:14px;">' +
      '<div><div class="eyebrow muted" style="margin-bottom:6px;">Trust Bar history</div>' +
      '<ul class="audit srm-scroll" id="tb-history">' + trustRows(e) + '</ul></div>' +
      '<div><div class="eyebrow muted" style="margin-bottom:6px;">Wallet ledger</div>' +
      '<ul class="audit srm-scroll">' + ledgerRows + '</ul></div>' +
      '</div>' +
      '<div class="eyebrow muted" style="margin:16px 0 6px;">Journey &amp; events</div>' +
      '<ul class="audit srm-scroll">' + auditRows + '</ul>');
    m.setTitle('Student relationship · ' + ui.esc(e.payment.customerName));
  }

  /* Gold identity-signal pills on the SRM profile — selfie quality, duplicate
     selfie, identity reuse. Review triggers; the moderator's call is final. */
  function identityFlagLine(e) {
    const flags = db.identityFlags(e);
    if (!flags.length) return '';
    return '<div style="border:1px solid rgba(212,175,55,0.4);border-radius:10px;padding:10px 14px;margin-bottom:14px;">' +
      '<div class="eyebrow gold" style="margin-bottom:6px;">Identity signals · flagged for review</div>' +
      flags.map(f => '<span class="pill" style="border-color:rgba(212,175,55,0.45);color:#e0c36a;margin:2px 6px 2px 0;font-size:10px;">' + ui.esc(f.label) + '</span>').join('') +
      '</div>';
  }

  /* print-trust controls (exposed for inline onclick) */
  /* staff-triggered password reset — helps a student recover access without
     ever seeing their password: the same self-service link the student gets
     from Forgot password?, minted by the system and sent to their email. */
  RFX.srmSendReset = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const r = db.requestPasswordReset(e.payment.email);
    ui.toastOk(r.ok
      ? 'Reset link sent to ' + e.payment.email + ' — valid 15 minutes, single-use. It is in their Mailbox.'
      : (r.msg || 'Could not send the reset link.'));
  };
  RFX.srmGrantPrint = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const rules = db.printTrustRules ? db.printTrustRules() : [];
    const rulesHtml = rules.map(r => '<li style="margin-bottom:6px;">' + ui.esc(r) + '</li>').join('');
    const m = ui.modal('<div class="eyebrow" style="margin-bottom:12px;">Grant print access</div>' +
      '<p class="small" style="margin-bottom:16px;">Printing course material is a <b style="color:var(--text);">privilege earned through trust</b>, not smarts. Grant it only to students the Academy trusts not to resell or redistribute material. The grant is recorded against the identity and rides the handoff payload so the OS enforces it at the backend.</p>' +
      '<div style="border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:14px 16px;margin-bottom:16px;background:rgba(212,175,55,0.05);">' +
      '<div class="small" style="color:var(--gold-bright);font-weight:600;margin-bottom:8px;">The print-trust rules</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.6;">' + rulesHtml + '</ul></div>' +
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

  /* ---- Trust Bar controls (staff) ----
     The Trust Bar is how the Academy reads a student at a glance. Staff apply
     measured penalties for conduct events (or credit genuine good conduct),
     and can simulate an OS trust event so the referral-buddy penalty is
     visible in the demo. Flags stay review triggers — the bar records, the
     moderator decides. */
  RFX.srmTrustAdjust = function (id, delta, reason) {
    const e = db.byId(id);
    if (!e) return;
    const r = db.adjustTrust(e, { delta: delta, reason: reason, by: 'Staff' });
    ui.toastOk((delta > 0 ? '+' : '') + delta + '% applied → Trust Bar at ' + r.score + '% · ' + r.tier);
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    render();
    openProfile(id);
  };
  RFX.srmTrustPenalty = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const m = ui.modal(
      '<div class="eyebrow" style="margin-bottom:10px;">Apply a Trust Bar penalty</div>' +
      '<p class="small" style="margin-bottom:14px;">The bar never sways on a whim — penalties are measured and recorded against the identity. Serious violations also ripple to the referrer (they vouched for who they brought in).</p>' +
      '<div class="field" style="margin-bottom:12px;"><label>Severity</label>' +
      '<select class="select" id="tb-sev"><option value="-5">Minor · −5</option><option value="-10" selected>Warning · −10</option><option value="-20">Serious · −20</option></select></div>' +
      '<div class="field"><label>Reason <span style="color:#f0a89c;">* required</span> <span class="small faint">— recorded on the bar and in the audit log</span></label>' +
      '<input class="input" id="tb-reason" placeholder="e.g. Shared account access with a non-student — Fair Usage Policy breach" required></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-dark btn-sm" onclick="this.closest(\'.modal-back\').remove()">Cancel</button>' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.srmTrustConfirmPenalty(\'' + id + '\')">Apply penalty</button></div>');
    m.setTitle('Trust Bar · ' + ui.esc(e.payment.customerName));
  };
  RFX.srmTrustConfirmPenalty = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const reason = ((document.getElementById('tb-reason') || {}).value || '').trim();
    // a reason is MANDATORY — every bar move must carry its cause, so the
    // student and the moderator both see WHY the bar moved. No reason, no move.
    if (!reason) {
      ui.toastErr('A reason is required — every Trust Bar penalty must record its cause.');
      const inp = document.getElementById('tb-reason');
      if (inp) { inp.focus(); inp.style.borderColor = 'rgba(231,111,81,0.6)'; setTimeout(() => { inp.style.borderColor = ''; }, 1600); }
      return;
    }
    const sev = Number((document.getElementById('tb-sev') || {}).value || -10);
    RFX.srmTrustAdjust(id, sev, reason);
  };
  RFX.srmTrustCredit = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const m = ui.modal(
      '<div class="eyebrow" style="margin-bottom:10px;">Credit good conduct</div>' +
      '<p class="small" style="margin-bottom:14px;">Recovery is earned, not given. Credit a student for genuine good conduct — maintained discipline, integrity-clean quizzes, helping the Academy.</p>' +
      '<div class="field" style="margin-bottom:12px;"><label>Amount</label>' +
      '<select class="select" id="tb-credit"><option value="3" selected>Small · +3</option><option value="5">Solid · +5</option><option value="10">Milestone · +10</option></select></div>' +
      '<div class="field"><label>Reason <span style="color:#f0a89c;">* required</span></label>' +
      '<input class="input" id="tb-creason" placeholder="e.g. Two months with a clean integrity record" required></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-dark btn-sm" onclick="this.closest(\'.modal-back\').remove()">Cancel</button>' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.srmTrustConfirmCredit(\'' + id + '\')">Credit conduct</button></div>');
    m.setTitle('Trust Bar · ' + ui.esc(e.payment.customerName));
  };
  RFX.srmTrustConfirmCredit = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const reason = ((document.getElementById('tb-creason') || {}).value || '').trim();
    // a reason is MANDATORY — every bar move must carry its cause, so the
    // student and the moderator both see WHY the bar moved. No reason, no move.
    if (!reason) {
      ui.toastErr('A reason is required — every Trust Bar credit must record its cause.');
      const inp = document.getElementById('tb-creason');
      if (inp) { inp.focus(); inp.style.borderColor = 'rgba(231,111,81,0.6)'; setTimeout(() => { inp.style.borderColor = ''; }, 1600); }
      return;
    }
    const amt = Number((document.getElementById('tb-credit') || {}).value || 5);
    RFX.srmTrustAdjust(id, amt, reason);
  };
  /* Demo helper: simulate a serious OS integrity event (like the real bridge
     event in production) so staff can see the referred-student penalty fire. */
  RFX.srmSimulateTrustEvent = function (id) {
    const e = db.byId(id);
    if (!e) return;
    const r = db.referralTrustPenalty(e, 'integrity violation reported by RFX OS');
    if (r) ui.toastOk('Referral ripple applied: ' + r.before + '% → ' + r.score + '% on the referrer\'s bar (' + r.delta + ').');
    else ui.toastWarn('No active referral record — this student was not referred (or the referrer is the same identity).');
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    render();
    openProfile(id);
  };
  /* Trust Bar history rows for the profile modal. */
  function trustRows(e) {
    const evs = db.trustEvents(e);
    if (!evs.length) return '<li><span class="a-txt faint">No moves recorded — the bar is untouched, which is exactly how it should be.</span></li>';
    return evs.slice(0, 8).map(x =>
      '<li><span class="a-time">' + db.fmtDateShort(x.at) + '</span>' +
      '<span class="a-txt"><b style="color:' + (x.delta < 0 ? '#f0a89c' : '#7ee2a4') + ';">' + (x.delta > 0 ? '+' : '') + x.delta + '</b> ' + ui.esc(x.reason || '') +
      (x.ref ? ' <span class="small faint">(' + ui.esc(x.ref) + ')</span>' : '') + '</span></li>').join('');
  }
  /* Trust section rendered inside the profile modal. */
  function trustLine(e) {
    if (!e.studentId) return '';
    const ts = db.trustStatus(e);
    const n = db.trustEvents(e).length;
    const tierCls = ts.tier === 'caution' ? 'caution' : (ts.tier === 'danger') ? 'low' : (ts.tier === 'restricted' ? 'crit' : '');
    return '<div style="margin:14px 0 4px;">' +
      '<div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;">' +
      ui.trustRingHTML(ts.score, { tierCls: tierCls, cap: 'trust' }) +
      '<div style="flex:1;min-width:220px;">' +
      '<div class="eyebrow muted" style="margin-bottom:4px;">Trust Ring</div>' +
      '<div style="font-size:13.5px;color:var(--text);font-weight:600;">' + ui.esc(ts.label) + '</div>' +
      '<div class="small faint" style="margin-top:4px;">' + n + ' recorded ' + (n === 1 ? 'move' : 'moves') + ' · every penalty and credit is ledgered against the identity.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.srmTrustPenalty(\'' + e.id + '\')">Apply penalty</button>' +
      '<button class="btn btn-dark btn-sm" onclick="RFX.srmTrustCredit(\'' + e.id + '\')">Credit conduct</button>' +
      '<button class="btn btn-dark btn-sm" onclick="RFX.srmSimulateTrustEvent(\'' + e.id + '\')">Simulate OS violation</button>' +
      '</div></div></div></div>';
  }

  $('srm-q').addEventListener('input', render);
  $('srm-filter').addEventListener('change', render);
  render();
  setInterval(() => { kpis(); render(); }, 4000);
})();
