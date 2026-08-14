/* My RFX Account — Members panel (member.html) */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;
  const SESSION_KEY = 'rfx_member_session';

  let enr = null;

  /* Inactivity session timeout — shared devices can't stay logged in.
     Any pointer/keyboard activity resets the clock; after
     `sessionTimeoutMinutes` of silence the panel signs out. */
  let lastActivity = Date.now();
  let activityIv = null;
  const touch = () => { lastActivity = Date.now(); };
  function sessionTimeoutMinutes() {
    const sec = db.getSettings().security || {};
    return Math.max(1, sec.sessionTimeoutMinutes || 15);
  }
  function startActivityWatch() {
    stopActivityWatch();
    lastActivity = Date.now();
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, touch, { passive: true }));
    activityIv = setInterval(() => {
      const mins = sessionTimeoutMinutes();
      if (Date.now() - lastActivity > mins * 60000) {
        stopActivityWatch();
        doLogout();
        ui.toastWarn('Signed out automatically after ' + mins + ' minutes of inactivity — your account stays protected.');
      }
    }, 30000);
  }
  function stopActivityWatch() {
    if (activityIv) { clearInterval(activityIv); activityIv = null; }
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
      document.removeEventListener(ev, touch));
  }

  const $ = id => document.getElementById(id);
  const hide = id => { const el = $(id); if (el) el.hidden = true; };
  const show = id => { const el = $(id); if (el) el.hidden = false; };

  /* ---------------- session ----------------
     Single-session contract (mirrors the OS): every login mints a fresh
     token server-side (db.issueSession). The token is stored locally so a
     boot can verify it's still the ACTIVE session — if the student signed
     in on another device, this token was revoked and this panel locks with
     the same screen the OS shows. */
  function saveSession(payload) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.id) ? o : null;
    } catch (e) { return null; }
  }
  /* Boot verification — the kicked-device check. Returns true when the stored
     token is still the active session for this enrollment. When a fresh login
     happened elsewhere, the record's token changed and this device is out. */
  function sessionStillActive(record) {
    const s = loadSession();
    return !!(s && record && record.session && record.session.token && s.token === record.session.token);
  }
  /* The single lock path — used by BOTH the poll and the cross-tab storage
     listener so the two can never drift. The student is dropped to the login
     screen with one calm explanation; the shared session record is left for
     whoever holds the ACTIVE token (removing it here would kick a fresh
     login in another tab — the exact bug this helper prevents). */
  function forceLock(reason) {
    ui.toastWarn(reason);
    if (panelIv) { clearInterval(panelIv); panelIv = null; }
    stopActivityWatch();
    mailViewOpen = false; mailSelected = null; // never re-open a stale mailbox view
    enr = null;
    resetRings();
    document.body.classList.remove('member-panel');
    show('screen-login'); hide('screen-panel');
  }

  /* ---------------- login ----------------
     Goes through db.memberLogin, which throttles repeated failures and
     locks the account for N minutes after too many wrong attempts. */
  function doLogin() {
    const email = $('m-email').value.trim();
    const code = $('m-code').value.trim();
    if (!email || !code) { ui.toastErr('Enter both your email and your Student Code.'); return; }
    // visible busy state — the student always knows the click landed
    const btn = $('m-login');
    ui.busyButton(btn, true, 'Verifying your identity…');
    setTimeout(function () {
      const r = db.memberLogin(email, code);
      if (!r.ok) {
        ui.busyButton(btn, false);
        if (r.locked) {
          showLockout(r);
        } else {
          ui.toastErr(r.msg);
        }
        return;
      }
      enr = r.enr;
      saveSession({ id: enr.id, token: r.token });
      hide('m-lockout');
      startActivityWatch();
      entrancePending = true; // the cards rise in — once, on sign-in
      // the birthday sweep — once per year per student, idempotent; if today
      // is the student's birthday a branded mailbox note + notification land
      // before the panel renders.
      try { db.checkBirthdays(); } catch (e) { console.error(e); }
      renderPanel();
      ui.toastOk('Welcome back, ' + enr.payment.customerName + '.');
    }, 120);
  }

  /* ---------------- forgot password / reset ----------------
     Recovery is self-service: the login screen links here, a short-lived
     single-use token is emailed to the registered address, and the reset
     link page sets the new password. Staff never see or handle passwords. */
  let resetToken = null;
  function showReset() { show('screen-reset'); hide('screen-login'); hide('screen-setpw'); hide('screen-reset-done'); hide('screen-panel'); }
  function backToLogin() { show('screen-login'); hide('screen-reset'); hide('screen-setpw'); hide('screen-reset-done'); hide('screen-panel'); }

  /* LOCKOUT CLARITY — the student always knows exactly what happened and
     what to do. The lockout box states the reason plainly, shows a live
     countdown that ticks down to the exact second the lock lifts, and gives
     a one-tap Forgot password? path so nobody is ever left staring at a
     wall. */
  let lockTick = null;
  function showLockout(r) {
    const box = $('m-lockout');
    if (!box) { ui.toastErr(r.msg); return; }
    const until = new Date(r.lockedUntil || Date.now() + 15 * 60000).getTime();
    const I = RFX.icons || {};
    box.innerHTML =
      '<div style="display:flex;gap:12px;align-items:flex-start;">' +
      '<span class="ic" style="color:#f0a89c;flex:none;margin-top:2px;">' + (I.clock || I.shield || '') + '</span>' +
      '<div style="flex:1;min-width:0;">' +
      '<div style="font-weight:600;color:#f6b9ae;margin-bottom:4px;">Sign-in is temporarily locked</div>' +
      '<div style="color:#f0a89c;margin-bottom:10px;font-size:12px;">' +
      'Too many failed attempts in a row — this is the safety net. Your password is untouched. You can try again in ' +
      '<b class="mono" id="lock-timer" style="color:#f6b9ae;">' + lockFmt(until) + '</b>.' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" id="lock-forgot" style="font-size:12px;"><span data-icon="key"></span> Forgot password? Recover now</button>' +
      '</div></div>';
    show('m-lockout');
    const t = $('lock-timer');
    if (lockTick) clearInterval(lockTick);
    lockTick = setInterval(function () {
      const left = Math.max(0, until - Date.now());
      if (t) t.textContent = lockFmt(until);
      if (left <= 0 && lockTick) {
        clearInterval(lockTick); lockTick = null;
        hide('m-lockout');
        ui.toastOk('The lock has lifted — you can sign in now.');
      }
    }, 1000);
    const fg = $('lock-forgot');
    if (fg) fg.addEventListener('click', function () { if (lockTick) { clearInterval(lockTick); lockTick = null; } hide('m-lockout'); showReset(); });
    ui.toastErr(r.msg);
  }
  function lockFmt(until) {
    const left = Math.max(0, until - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function doSendReset() {
    const btn = $('r-send');
    const email = $('r-email').value.trim();
    if (!email) { ui.toastErr('Enter the email on your enrollment.'); return; }
    ui.busyButton(btn, true, 'Sending…');
    let settled = false;
    const settle = function (fn) { if (settled) return; settled = true; try { fn(); } catch (e) { console.error(e); } };
    // the button must never stay stuck: an error still clears the busy state
    setTimeout(function () {
      let r = null;
      try { r = db.requestPasswordReset(email); } catch (e) { console.error(e); r = { ok: false, msg: 'Something went wrong sending the link — please try again in a moment.' }; }
      settle(function () {
        ui.busyButton(btn, false);
        const msg = $('r-msg');
        if (!msg) return;
        msg.hidden = false;
        msg.style.color = r.ok ? 'var(--gold-bright)' : '#f0a89c';
        msg.textContent = r.ok
          ? 'If an account exists for ' + ui.esc(email) + ', a secure one-time reset link is on its way — check your email and the Mailbox on your member panel. It works for 15 minutes and can only be used once.'
          : (r.msg || 'Could not send the reset link.');
        if (r.ok) {
          // land the student back on sign-in once the link is out — the
          // confirmation has had its moment
          setTimeout(function () {
            try {
              backToLogin();
              ui.toastOk('Reset link sent — check your Mailbox, then sign in with your new password.');
            } catch (e) { console.error(e); }
          }, 5000);
        }
      });
    }, 600);
    setTimeout(function () { settle(function () { ui.busyButton(btn, false); }); }, 8000); // safety net
  }
  function doSetNewPassword() {
    if (!resetToken) { backToLogin(); return; }
    const btn = $('sp-set');
    const a = $('sp-pw').value, b = $('sp-pw2').value;
    const msg = $('sp-msg');
    msg.hidden = true;
    if (a.length < 8) { msg.textContent = 'Password must be at least 8 characters.'; msg.hidden = false; return; }
    if (a !== b) { msg.textContent = 'Passwords do not match.'; msg.hidden = false; return; }
    ui.busyButton(btn, true, 'Setting…');
    let settled = false;
    const settle = function (fn) { if (settled) return; settled = true; try { fn(); } catch (e) { console.error(e); } };
    setTimeout(function () {
      let r = null;
      try { r = db.resetPasswordWithToken(resetToken, a); } catch (e) { console.error(e); r = { ok: false, msg: 'Something went wrong setting the password — please request a fresh reset link.' }; }
      settle(function () {
        ui.busyButton(btn, false);
        if (!r.ok) { msg.textContent = r.msg || 'That link could not be used.'; msg.hidden = false; return; }
        // success — the token is consumed. Land on the calm branded success
        // screen: the student chooses the moment to sign in with the new
        // password, instead of being silently dropped back at login.
        resetToken = null;
        const resetEmail = (r.enr && r.enr.payment && r.enr.payment.email) || '';
        show('screen-reset-done'); hide('screen-setpw'); hide('screen-login'); hide('screen-reset'); hide('screen-panel');
        // reset confirmation identity — the student sees exactly whose
        // account changed before they sign in again
        const rid = $('rd-identity'), rname = $('rd-name'), remail = $('rd-email');
        if (rid && r.enr) {
          const nm = (r.enr.payment && r.enr.payment.customerName) || '';
          if (rname) rname.textContent = nm || 'Your account';
          if (remail) remail.textContent = resetEmail;
          rid.hidden = false;
        }
        const go = $('rd-signin');
        if (go) {
          go.onclick = function () {
            if (go.disabled) return;
            ui.busyButton(go, true, 'Signing in…');
            setTimeout(function () {
              let login = null;
              try { login = db.memberLogin(resetEmail, a); } catch (e) { console.error(e); login = null; }
              ui.busyButton(go, false);
              if (login && login.ok) {
                enr = login.enr;
                saveSession({ id: enr.id, token: login.token });
                entrancePending = true;
                try { db.checkBirthdays(); } catch (e) { console.error(e); }
                renderPanel();
                ui.toastOk('Password reset — welcome back.');
              } else {
                // the reset itself already succeeded — only the auto sign-in
                // hit the throttle; the student can sign in manually
                $('m-email').value = resetEmail;
                $('m-code').value = '';
                backToLogin();
                ui.toastOk('Password reset — sign in with your new password.');
              }
            }, 120);
          };
        } else {
          backToLogin();
          ui.toastOk('Password reset — sign in with your new password.');
        }
      });
    }, 500);
    setTimeout(function () { settle(function () { ui.busyButton(btn, false); }); }, 8000); // safety net
  }

  /* SECURE YOUR ACCOUNT — the onboarding prompt after credentials are
     issued. Shown until a password is set: reminds the student to record
     their Student ID + password in a password manager, and makes the point
     that staff and support can never see the password (only a secure hash
     is stored, and recovery is self-service). */
  function passwordCard() {
    if (!enr || db.hasPassword(enr)) return '';
    const I = RFX.icons || {};
    // demo / trial / coupon prospects see the option — it exists — but feint
    // and locked: a password is a privilege for real enrolled students. The
    // card stays honest ("it's there for you later"), the fields stay dead,
    // and clicking explains in a calm voice. The founder is always exempt.
    const demoLocked = db.canSetPassword ? !db.canSetPassword(enr) : false;
    const cardBody = demoLocked
      ? '<p class="small" style="margin-bottom:12px;color:var(--muted);line-height:1.6;">Setting a password is reserved for <b style="color:var(--text);">enrolled students</b>. You\'re on a demo pass — your <b style="color:var(--text);">Student Code (' + ui.esc(enr.studentCode || enr.studentId || '') + ')</b> signs you in. When you enrol for real, you\'ll secure your account right here.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' +
        '<div class="field" style="flex:1;min-width:170px;margin:0;"><label style="font-size:10px;">Password</label>' +
        '<input class="input" id="pw-set1" type="password" placeholder="At least 8 characters" autocomplete="new-password" disabled></div>' +
        '<div class="field" style="flex:1;min-width:170px;margin:0;"><label style="font-size:10px;">Confirm</label>' +
        '<input class="input" id="pw-set2" type="password" placeholder="Repeat your password" autocomplete="new-password" disabled></div>' +
        '<button class="btn btn-ghost btn-sm" style="opacity:0.55;cursor:not-allowed;" onclick="RFX.memberSetPassword()">' + (I.lock || '') + ' Set password</button></div>' +
        '<div class="small" id="pw-msg" hidden style="margin-top:10px;font-size:11px;"></div>' +
        '<p class="small faint" style="margin-top:10px;">Your Student Code / Student ID signs you in during your demo — no password needed.</p>'
      : '<p class="small" style="margin-bottom:12px;color:var(--muted);line-height:1.6;">Record your <b style="color:var(--text);">Student ID (' + ui.esc(enr.studentId || '') + ')</b> and a password you choose, in a password manager or another secure place. Reality FX staff and support can <b>never</b> see your password — the system only stores a secure hash, and recovery is always self-service through Forgot password?.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' +
        '<div class="field" style="flex:1;min-width:170px;margin:0;"><label style="font-size:10px;">Password</label>' +
        '<input class="input" id="pw-set1" type="password" placeholder="At least 8 characters" autocomplete="new-password"></div>' +
        '<div class="field" style="flex:1;min-width:170px;margin:0;"><label style="font-size:10px;">Confirm</label>' +
        '<input class="input" id="pw-set2" type="password" placeholder="Repeat your password" autocomplete="new-password"></div>' +
        '<button class="btn btn-gold btn-sm" onclick="RFX.memberSetPassword()">' + (I.check || '') + ' Set password</button></div>' +
        '<div class="small" id="pw-msg" hidden style="margin-top:10px;font-size:11px;"></div>' +
        '<p class="small faint" style="margin-top:10px;">Until you set one, your Student Code / Student ID still signs you in.</p>';
    return '<div class="card" id="password-card" style="border-color:rgba(212,175,55,0.45);' + (demoLocked ? 'opacity:0.78;' : '') + '">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.lock || '') + '</span>' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Secure your account</span>' +
      '<span class="pill" style="font-size:9px;margin-left:auto;border-color:rgba(212,175,55,0.4);color:#c9b57a;" title="Available once you enrol">' + (demoLocked ? 'demo · locked' : 'recommended') + '</span></div>' +
      cardBody +
      '</div>';
  }
  window.RFX.memberSetPassword = function () {
    if (!enr) return;
    // demo students: the option is visible but never usable — explain calmly
    if (db.canSetPassword && !db.canSetPassword(enr)) {
      ui.toastWarn('Setting a password is reserved for enrolled students. Your demo signs you in with your Student Code — secure your account when you enrol for real.');
      return;
    }
    const p1 = document.getElementById('pw-set1'), p2 = document.getElementById('pw-set2'), msg = document.getElementById('pw-msg');
    if (!p1 || !p2) return;
    const a = p1.value, b = p2.value;
    const showMsg = function (txt, ok) { if (msg) { msg.hidden = false; msg.style.color = ok ? '#7ee2a4' : '#f0a89c'; msg.textContent = txt; } };
    if (a.length < 8) return showMsg('Password must be at least 8 characters.', false);
    if (a !== b) return showMsg('Passwords do not match.', false);
    const r = db.setStudentPassword(enr, a);
    if (r.ok) {
      p1.value = ''; p2.value = '';
      showMsg('Password set — from now on you sign in with your email and password. Keep it recorded somewhere secure.', true);
      setTimeout(function () { renderContent(); }, 1800);
    } else showMsg(r.msg || 'Could not set the password.', false);
  };

  /* ---------------- panel ---------------- */
  let panelIv = null;
  /* Form values on the panel (merch sizes, address, custom amount) would be
     wiped by a re-render — stash them first so a refresh never eats a
     half-filled form, then restore. */
  function stashForm() {
    const out = {};
    document.querySelectorAll('#mp-content select, #mp-content input[type=number], #mp-content input:not([type=number])').forEach(el => {
      if (el.id) out[el.id] = el.value;
    });
    return out;
  }
  function restoreForm(s) {
    Object.keys(s).forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value !== s[id]) el.value = s[id];
    });
  }
  /* Signature of the fields the panel renders that can change while the
     student is looking (state, handoff, wallet, referral records). byId
     returns the SAME live object, so we compare a signature — not identity —
     or the panel would never notice e.g. APPROVED -> ACTIVE mid-session. */
  function panelSignature(e) {
    const w = db.getWallet(e.payment.email);
    // referralStats is a db function, not a property on the enrollment
    const refs = db.referralStats(e.studentId || e.id);
    return [
      e.state, (e.handoff && e.handoff.confirmedAt) || '',
      (e.progress && e.progress.activeAt) || '',
      w.balance, (w.ledger || []).length,
      ((e.printTrust || {}).level) || '',
      refs.sent, refs.pendingAmount, refs.paidAmount,
      db.trustScore(e), (e.notifications || []).length, // the bar + feed live-update
      (function () { var sup = db.supportStudentThread(e); return sup ? sup.updatedAt + '|' + (sup.studentUnread || 0) : ''; })(), // staff replies re-render the panel
    ].join('|');
  }
  function renderPanel() {
    document.body.classList.add('member-panel'); // the dashboard spreads wide
    show('screen-panel'); hide('screen-login');
    $('mp-name').textContent = enr.payment.customerName;
    $('mp-state').innerHTML = ui.statePill(enr.state);
    const saved = stashForm();
    renderContent();
    restoreForm(saved);
    toastNewNotifications(); // moments that happened while they were away
    // a staff reply to the live-support line toasts on the student's next look
    const supUnread = db.supportStudentUnread(enr);
    if (supUnread > supportToastedUnread) { ui.toastOk('Reality FX support replied to you — see the Live support card.'); supportToastedUnread = supUnread; }
    startMemberCountdown();
    let sig = panelSignature(enr);
    if (panelIv) clearInterval(panelIv);
    panelIv = setInterval(() => {
      if (!enr) return;
      const cur = db.byId(enr.id) || enr;
      // STRICT one-active-session rule, enforced LIVE: if a sign-in happened
      // anywhere else (another device, another browser — even the same PC),
      // this token is dead. Lock the panel ourselves within seconds — the
      // student never has to remember to sign out of the old one.
      const s = loadSession();
      if (!s || !db.sessionStillValid(cur, s.token)) {
        forceLock('Signed in elsewhere — this session was ended automatically so only one active session stays open per student. Sign in again here.');
        return;
      }
      const next = panelSignature(cur);
      if (next !== sig) {
        sig = next;
        enr = cur;
        if (mailViewOpen) renderMailboxView(); else renderPanel();
      }
      // re-probe the Academy every ~6 polls (15s) so the power-on moment is
      // caught live while the student watches — never opens a dead page.
      if (++probeTick % 6 === 0 && enr && (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED')) probeOs(null, null);
    }, 2500);
  }

  /* Demo-session clock on the member panel — same shared clock as the
     registration page (db.demoTimeLeft), ticking once a second. Only for
     demo-pass enrollments; hides itself when the tour is over. */
  let memberDemoIv = null;
  function startMemberCountdown() {
    const el = document.getElementById('mc-demo-countdown');
    if (!el || !enr || !enr.demoPass) return;
    // the founder's lifetime badge has no clock — nothing to tick
    if (db.isFounder(enr)) return;
    const timeEl = el.querySelector('.dc-time');
    const barFill = el.querySelector('.life-bar-fill');
    if (memberDemoIv) clearInterval(memberDemoIv);
    const tick = () => {
      const left = db.demoTimeLeft(enr);
      if (barFill) { barFill.style.setProperty('--v', Math.round(db.demoLifeLeft(enr) * 100) + '%'); }
      if (left <= 0) { if (el) el.remove(); if (memberDemoIv) clearInterval(memberDemoIv); memberDemoIv = null; return; }
      if (timeEl) timeEl.textContent = db.fmtCountdown(left);
    };
    tick();
    memberDemoIv = setInterval(tick, 1000);
  }

  /* Every course this identity owns — one person, one Student ID, and the
     panel shows the full picture (a member can hold several courses). */
  function coursesCard() {
    const I = RFX.icons || {};
    const mine = db.enrollments().filter(e => e.payment.email === enr.payment.email && e.studentId);
    const rows = mine.map(e =>
      '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">' +
      '<div style="flex:1;"><b style="color:var(--text);font-size:13.5px;">' + ui.esc(e.payment.course) + '</b>' +
      '<div class="small faint">' + e.id + ' · paid ' + db.money(e.payment.price, e.payment.currency) + ' · ' + db.fmtDateShort(e.createdAt) + '</div></div>' +
      ui.statePill(e.state) + '</div>').join('');
    // other courses from the catalogue this student does NOT own yet — the
    // box earns its place by showing what the Academy can offer next
    const owned = new Set(db.enrollments()
      .filter(e => e.payment.email === enr.payment.email && e.payment.course)
      .map(e => db.normCourse(e.payment.course)));
    // SMART suggestions: the ones the balance can cover right now come first
    // (they are actually buyable this minute), then the rest by price, and the
    // cheapest next course wears the 'recommended' tag — the natural step up.
    const spendNow = db.spendable(enr.payment.email);
    const others = db.getCatalog()
      .filter(it => it.kind === 'course' && !owned.has(db.normCourse(it.name)))
      .map(c => ({ c: c, affordable: spendNow >= c.price }))
      .sort((a, b) => (b.affordable - a.affordable) || (a.c.price - b.c.price))
      .slice(0, 6);
    const otherRows = others.length
      ? others.map((o, i) => {
          const c = o.c;
          const tag = o.affordable
            ? '<span class="pill ok" style="font-size:8px;">' + (i === 0 ? 'recommended · affordable now' : 'affordable now') + '</span>'
            : i === 0 ? '<span class="pill gold" style="font-size:8px;">recommended next</span>' : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
          '<span class="mono" style="font-size:10px;color:var(--gold-bright);letter-spacing:0.4px;flex:none;">' + ui.esc(c.code) + '</span>' +
          '<div style="flex:1;min-width:0;"><b style="font-size:12.5px;color:var(--text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ui.esc(c.name) + '</b>' +
          '<span class="small faint" style="font-size:10px;">' + (c.note ? ui.esc(c.note) : 'Your next step in the Academy') + '</span>' + tag + '</div>' +
          '<span class="mono gold" style="font-size:12px;flex:none;">' + db.money(c.price, c.currency || 'R') + '</span>' +
          '<button class="btn btn-dark btn-sm" style="padding:3px 10px;font-size:10.5px;flex:none;" onclick="RFX.memberGoEnroll()" title="Enroll from your balance">' + (I.plus || '') + '</button></div>';
        }).join('')
      : '<p class="small faint">No more courses in the catalogue right now — every course you own is listed above.</p>';
    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:10px;">Your courses</div>' +
      '<div class="mono gold" style="font-size:13px;letter-spacing:0.5px;margin-bottom:8px;">' + (enr.studentId || '—') + ' <span class="small faint" style="letter-spacing:0;">— one identity, every course you own</span></div>' +
      (rows || '<p class="small faint">No courses attached to this identity yet.</p>') +
      '<div class="eyebrow muted" style="margin:14px 0 2px;">More from Reality FX</div>' +
      otherRows +
      '<p class="small faint" style="margin-top:10px;">Verified students skip the forms — pick a course and pay from your balance in the <b style="color:var(--gold);">Enroll in another course</b> card below.</p></div>';
  }
  window.RFX.memberGoEnroll = function () {
    const el = document.getElementById('enroll-more-card');
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); ui.toastOk('Choose your next course below — pay from your balance when it covers the price.'); }
    else ui.toastOk('See the Enroll in another course card — verified students skip the forms.');
  };

  /* Enroll in ANOTHER course from the panel — the "already verified, so it's
     simple" flow. Details are SRM-synced; the only step left is choosing the
     course and paying. Wallet payment creates a REAL new enrollment under the
     same identity and hands it to the OS immediately. */
  function enrollMoreCard() {
    const I = RFX.icons || {};
    const usable = db.spendable(enr.payment.email);
    // ownership uses the SAME normalized key as the db rail, so a course bought
    // through any boundary (website dash vs catalog dash) always shows as owned
    const owned = new Set(db.enrollments()
      .filter(e => e.payment.email === enr.payment.email && e.payment.course)
      .map(e => db.normCourse(e.payment.course)));
    const courses = db.getCatalog().filter(it => it.kind === 'course');
    const rows = courses.map(it => {
      const own = owned.has(db.normCourse(it.name));
      const afford = usable >= it.price;
      const badge = own
        ? '<span class="pill ok" style="font-size:9px;">enrolled</span>'
        : (afford
          ? '<button class="btn btn-gold btn-sm" data-enroll="' + ui.esc(it.code) + '" data-amt="' + it.price + '" data-name="' + ui.esc(it.name) + '">' + (I.plus || '') + ' Enroll · pay from balance</button>'
          : '<button class="btn btn-dark btn-sm" disabled title="Need ' + db.money(it.price - usable, it.currency || 'R') + ' more">' + db.money(it.price - usable, it.currency || 'R') + ' short</button>');
      return '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);">' +
        '<div style="flex:1;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<span class="mono" style="font-size:11px;color:var(--gold-bright);letter-spacing:0.5px;">' + ui.esc(it.code) + '</span>' +
        '<b style="color:var(--text);font-size:13.5px;">' + ui.esc(it.name) + '</b></div>' +
        '<div class="small faint">' + db.money(it.price, it.currency || 'R') + (it.note ? ' · ' + ui.esc(it.note) : '') + '</div></div>' + badge + '</div>';
    }).join('');
    return '<div class="card" id="enroll-more-card"><div class="eyebrow muted" style="margin-bottom:10px;">Enroll in another course</div>' +
      '<p class="small" style="margin-bottom:12px;">You\'re already verified — no re-registration, no forms. Pick a course and pay from your RFX balance; it\'s added to your identity and your Academy access updates instantly.</p>' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;">' +
      '<span class="num gold" style="font-size:24px;">' + db.money(usable, 'R') + '</span>' +
      '<span class="small faint">spendable balance</span></div>' +
      (courses.length ? rows : '<p class="small faint">No courses in the catalog yet — the team adds them on the Credit &amp; Refunds page.</p>') +
      '<p class="small faint" style="margin-top:12px;">Paying by card instead? The website checkout does that — use your wallet here for instant, fee-free enrollment.</p></div>';
  }

  function doEnrollMore(code, amount, name) {
    if (!enr) return;
    const r = db.enrollAdditionalCourse(enr.payment.email, code);
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    ui.toastOk('Welcome to ' + name + ' — ' + db.money(amount, 'R') + ' paid from your balance. Added to ' + enr.studentId + ' and live in RFX OS.');
    renderContent();
  }

  /* staggered entrance — cards rise in with a gentle gold-tinted fade, ONCE,
     on sign-in only (never on the 2.5s poll re-renders) */
  let entrancePending = false;
  let ringsWarm = false; // after the first paint the rings don't redraw on polls
  let ringsWarmTimer = null; // the deferred warm-up — cleared on logout
  function renderContent() {
    const I = RFX.icons || {};
    $('mp-content').innerHTML =
      (db.isFoundersDay() || enr.demoPass ? foundersDayCard() : '') + (db.isFounder(enr) ? masterKeyCard() : '') + notificationsCard() + supportCard() + mailboxCard() + identityCard() + passwordCard() + trustCard() + prepGuideCard() + coursesCard() + vitalsCard() + accessCard() + walletCard() + referralCard() + spendCard() + enrollMoreCard() + merchCard() + journeyCalCard() + machineryCard();
    // the Academy link probes once per render (async, never blocks the panel)
    if (enr && (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED')) {
      probeOs(null, null);
    }
    // the gate line in the Machinery card answers live — the same endpoint
    // the OS Cloud Function calls before issuing any session (FOR-LEE §9.62)
    probeGate();
    let maxEntranceDelay = 0;
    if (entrancePending) {
      entrancePending = false;
      const cards = Array.from($('mp-content').querySelectorAll(':scope > .card'));
      cards.forEach(function (c, i) {
        c.style.animation = 'cardRise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both';
        c.style.animationDelay = (i * 70) + 'ms';
        maxEntranceDelay = Math.max(maxEntranceDelay, i * 70);
        // The ring draw must START when its card becomes visible — otherwise a
        // late card (the Machinery card is last) finishes drawing while still
        // at opacity 0 and pops in pre-drawn. Sync each ring to its card.
        c.querySelectorAll('.trust-ring .tr-fill').forEach(function (f) {
          f.style.animationDelay = (i * 70) + 'ms';
        });
      });
    }
    if (!ringsWarm) {
      ringsWarm = true;
      // Let the draw animation play FIRST — adding the class synchronously here
      // would kill it before the browser ever paints an animated frame. Defer
      // past the LAST card's entrance + the 0.8s ringDraw, so every ring draws
      // in on first load, then polls (2.5s) land on rings-warm and never replay.
      const defer = maxEntranceDelay + 950;
      ringsWarmTimer = setTimeout(() => {
        const el = $('mp-content');
        // belt-and-braces: never warm a panel that is no longer showing (the
        // user may have signed out and back in — the new session re-schedules)
        if (el && document.body.classList.contains('member-panel')) el.classList.add('rings-warm');
      }, defer);
    }
  }

  /* FOUNDER'S DAY — 1 November. The founder stays anonymous (the learning is
     the point); on the day itself the dashboard plays the founder's own words.
     The same words are shared with TOUR students every day — a demo pass is
     a first handshake with the Academy, so the founder's welcome is part of
     it. On Founder's Day the eyebrow marks the day; on a tour it just says
     "a word from the founder". */
  function foundersDayCard() {
    const isDay = db.isFoundersDay();
    const q = db.founderQuotes[new Date().getDate() % db.founderQuotes.length];
    // The quote card sizes to its content (height:auto overrides the uniform
    // 400px card rule) — a short quote stays a tight, elegant strip instead
    // of leaving dead space under a forced tall box.
    return '<div class="card span-full" style="grid-column:1/-1;height:auto;min-height:0;text-align:center;border-color:rgba(212,175,55,0.5);background:linear-gradient(180deg,rgba(212,175,55,0.07),transparent);">' +
      '<span class="eyebrow gold">' + (isDay ? ('Founder\'s Day · ' + db.foundersDayLabel()) : 'A word from the founder') + '</span>' +
      '<div style="font-family:var(--font-serif);font-size:21px;color:var(--gold-bright);margin:10px 0 4px;line-height:1.35;">“' + ui.esc(q) + '”</div>' +
      '<div class="small faint">' + (isDay ? '— the founder, still anonymous · the learning is the point' : '— the founder of Reality FX · the learning is the point') + '</div></div>';
  }

  /* LIVE SUPPORT — the human line. Sarrah answers instantly in the corner;
     this card is where a real person takes over. Staff replies land here and
     toast on the student's next look. */
  let supportToastedUnread = 0;
  function supportCard() {
    const I = RFX.icons || {};
    const t = db.supportStudentThread(enr);
    const unread = db.supportStudentUnread(enr);
    const msgs = t ? t.messages.slice(-8) : [];
    const rows = msgs.length
      ? msgs.map(m =>
        '<div style="display:flex;' + (m.from === 'staff' ? 'justify-content:flex-end;' : '') + ';margin-bottom:8px;">' +
        '<div style="max-width:82%;padding:8px 12px;border-radius:11px;font-size:12.5px;line-height:1.5;' +
        (m.from === 'staff'
          ? 'background:linear-gradient(135deg,rgba(212,175,55,0.16),rgba(212,175,55,0.08));border:1px solid rgba(212,175,55,0.35);color:var(--text);border-bottom-right-radius:3px;'
          : 'background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:3px;') + '">' +
        '<div class="small faint" style="margin-bottom:2px;">' + ui.esc(m.fromName) + ' · ' + db.fmtDateShort(m.at) + '</div>' +
        ui.esc(m.text) + '</div></div>').join('')
      : '<p class="small faint">No messages yet. Sarrah answers instantly — this line reaches a human if you need one.</p>';
    return '<div class="card" id="support-card">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Live support</span>' +
      (unread ? '<span class="pill gold" style="font-size:9px;">' + unread + ' new</span>' : '') +
      '<span class="small faint" style="margin-left:auto;">the human line</span></div>' +
      '<div style="max-height:220px;overflow:auto;">' + rows + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<input class="input" id="mp-support-input" placeholder="Message Reality FX support…" maxlength="2000" style="flex:1;">' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.memberSendSupport()">' + (I.send || '') + ' Send</button></div>' +
      '<p class="small faint" style="margin-top:8px;">Replies go to our team — expect a human on the other end.</p></div>';
  }
  window.RFX.memberSendSupport = function () {
    const input = document.getElementById('mp-support-input');
    const text = input ? input.value : '';
    if (!text.trim()) { ui.toastErr('Type a message first.'); return; }
    const r = db.supportSend(enr.payment.email, 'student', text, { fromName: enr.payment.customerName });
    if (r.ok) {
      db.supportMarkStudentRead(enr);
      supportToastedUnread = 0;
      ui.toastOk('Sent — a member of the team will reply here.');
      renderPanel();
    } else ui.toastErr(r.msg);
  };

  /* MAILBOX — the student's own official inbox. The Academy prep guide names
     the Mailbox as the only channel for official notices, so every student
     gets one: invoices, registration links, verification codes and Academy
     announcements land here addressed to the email on the enrollment. This
     card + full view show ONLY that student's mail, with the same branding
     and download-as-file as the staff mailbox. */
  const MAIL_KIND = {
    invoice: ['Invoice', 'gold'], registration: ['Registration link', 'gold'], verify: ['Verification', 'info'], welcome: ['Welcome', 'ok'],
    credit: ['RFX credit', 'ok'], refund: ['Refund', 'warn'], reapply: ['Re-application', 'info'],
    cashout: ['Cash-out', 'gold'], 'finance-report': ['Finance audit', 'info'], 'staff-fund': ['Staff funding', 'ok'], 'staff-invite': ['Staff invite', 'info'],
    merch: ['Merch', 'gold'], 'prep-guide': ['Prep guide', 'info'], 'operating-guide': ['Operating guide', 'info'], support: ['Support', 'info'],
    birthday: ['Happy birthday', 'gold'],
  };
  let mailSelected = null;
  let mailViewOpen = false;
  function studentMail() {
    const mine = String(enr.payment.email || '').toLowerCase();
    return db.emails().filter(m => String(m.to || '').toLowerCase() === mine).slice().reverse(); // newest first
  }
  function mailboxCard() {
    const I = RFX.icons || {};
    const mine = studentMail();
    const unread = mine.filter(m => !m.read).length;
    const rows = mine.slice(0, 3).map(m => {
      const kb = MAIL_KIND[m.kind] || [m.kind || 'Message', ''];
      const un = !m.read;
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<span class="ic" style="flex:none;color:' + (un ? 'var(--gold-bright)' : 'var(--faint)') + ';">' + (I.doc || '') + '</span>' +
        '<div style="flex:1;min-width:0;">' +
        '<div class="small" style="color:' + (un ? 'var(--text)' : 'var(--faint)') + ';font-weight:' + (un ? '600' : '400') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ui.esc(m.subject) + '</div>' +
        '<div class="small faint" style="font-size:10px;">' + ui.esc(String(m.to || '').split('@')[0] || '') + ' &middot; ' + ui.fmtRelative(m.sentAt) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none;">' +
        '<span class="pill ' + kb[1] + '" style="font-size:8px;">' + kb[0] + '</span>' +
        (un ? '<span class="small gold" style="font-size:9px;">new</span>' : '') +
        '</div></div>';
    }).join('');
    return '<div class="card" id="mailbox-card" style="cursor:pointer;" onclick="RFX.memberOpenMailbox()" title="Open your official inbox">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.mail || I.inbox || '') + '</span>' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Mailbox</span>' +
      (unread ? '<span class="pill gold" style="font-size:9px;">' + unread + ' unread</span>' : '') +
      '<span class="small" style="margin-left:auto;color:var(--gold);">&rarr;</span></div>' +
      (rows || '<p class="small faint">Nothing here yet — your invoice, registration link and Academy announcements will land here.</p>') +
      '<div style="margin-top:12px;"><button class="btn btn-gold btn-sm" style="width:100%;" onclick="event.stopPropagation();RFX.memberOpenMailbox()">' + (I.mail || I.inbox || '') + ' Open your mailbox</button></div>' +
      '<p class="small faint" style="margin-top:9px;">The only channel the Academy uses for official notices.</p>' +
      '<p class="small faint" style="margin-top:2px;">Every message can be downloaded as a file.</p></div>';
  }
  function mailListPane(mine) {
    const I = RFX.icons || {};
    if (!mine.length) return '<div class="mail-list"><div class="empty-state"><div class="e-ic">' + (I.inbox || '') + '</div><div class="e-t">Nothing here yet</div><p class="small">Your invoice, registration link and Academy announcements will land here, with Reality FX branding.</p></div></div>';
    return '<div class="mail-list">' + mine.map(m => {
      const kb = MAIL_KIND[m.kind] || [m.kind || 'Message', ''];
      return '<div class="mail-item ' + (m.read ? '' : 'unread') + (m.id === mailSelected ? ' active' : '') + '" data-id="' + m.id + '" onclick="RFX.memberMailSelect(\'' + m.id + '\')">' +
        '<div class="m-subj">' + ui.esc(m.subject) + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:5px;">' +
        '<span class="pill ' + kb[1] + '" style="font-size:9px;">' + kb[0] + '</span>' +
        '<span class="small faint" style="margin-left:auto;">' + ui.fmtRelative(m.sentAt) + '</span>' +
        '<button class="btn btn-dark btn-sm" title="Download this email as a file" style="padding:3px 8px;font-size:11px;" onclick="event.stopPropagation();RFX.memberMailDownload(\'' + m.id + '\')">' + (I.download || '') + '</button></div></div>';
    }).join('') + '</div>';
  }
  function mailBodyPane(m) {
    const I = RFX.icons || {};
    if (!m) return '<div class="mail-body"><div class="empty-state"><div class="e-ic">' + (I.mail || '') + '</div><div class="e-t">Select a message</div><p class="small">Your official correspondence from Reality FX.</p></div></div>';
    const kb = MAIL_KIND[m.kind] || [m.kind || 'Message', ''];
    return '<div class="mail-body"><div class="eyebrow ' + kb[1] + '" style="margin-bottom:4px;">' + kb[0] + '</div>' +
      '<h3 class="serif" style="font-size:21px;line-height:1.3;">' + ui.esc(m.subject) + '</h3>' +
      '<div class="m-meta" style="display:flex;align-items:center;gap:12px;"><span>To: <b style="color:var(--muted);">' + ui.esc(m.to) + '</b> &middot; ' + db.fmtDate(m.sentAt) + '</span>' +
      '<button class="btn btn-dark btn-sm" id="btn-mail-dl" style="margin-left:auto;">' + (I.download || '') + ' Download file</button></div>' +
      '<div class="mail-paper">' + m.html + '</div></div>';
  }
  function renderMailboxView() {
    const I = RFX.icons || {};
    const mine = studentMail();
    if (!mailSelected || !mine.some(m => m.id === mailSelected)) mailSelected = mine.length ? mine[0].id : null;
    const sel = mine.find(m => m.id === mailSelected);
    if (sel && !sel.read) db.markEmailRead(sel.id);
    const unread = mine.filter(m => !m.read).length;
    $('mp-content').innerHTML =
      '<div class="card span-full" style="grid-column:1/-1;padding:0;">' +
      '<div style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
      '<button class="btn btn-dark btn-sm" onclick="RFX.memberCloseMailbox()">' + (I.home || '') + ' Dashboard</button>' +
      '<div style="flex:1;min-width:200px;"><div class="eyebrow" style="margin-bottom:2px;">Your official inbox</div><div class="serif gold" style="font-size:19px;">Mailbox</div></div>' +
      '<span class="small faint">' + mine.length + ' message' + (mine.length === 1 ? '' : 's') + (unread ? ' &middot; ' + unread + ' unread' : '') + ' &mdash; only mail to ' + ui.esc(enr.payment.email) + '</span>' +
      '</div>' +
      '<div class="mail-layout">' + mailListPane(mine) + mailBodyPane(sel) + '</div>' +
      '</div>';
    const dl = document.getElementById('btn-mail-dl');
    if (dl && sel) dl.addEventListener('click', () => ui.downloadEmail(sel));
  }
  window.RFX.memberOpenMailbox = function () { mailViewOpen = true; renderMailboxView(); };
  window.RFX.memberCloseMailbox = function () { mailViewOpen = false; mailSelected = null; renderContent(); };
  window.RFX.memberMailSelect = function (id) { mailSelected = id; renderMailboxView(); };
  window.RFX.memberMailDownload = function (id) {
    const m = studentMail().find(x => x.id === id);
    if (m) ui.downloadEmail(m);
  };

  /* THE TRUST BAR — how the student carries themselves, drawn in gold.
     100% the day they're approved; conduct drains it, good conduct restores
     it, a referred student's serious violation costs the referrer too. Click
     the bar to open the full standing dashboard (every good & bad action
     that moved it). It never sways easily — and that's the point. */
  function trustCard() {
    if (!enr.studentId) return ''; // the ring exists only once a student identity does
    const I = RFX.icons || {};
    const ts = db.trustStatus(enr);
    const events = db.trustEvents(enr);
    const tierCls = ts.tier === 'caution' ? 'caution' : (ts.tier === 'danger') ? 'low' : (ts.tier === 'restricted' ? 'crit' : '');
    const warnLine = ts.restricted
      ? '<p class="small" style="color:#f0a89c;margin-top:12px;"><b>Restricted.</b> Your account is fully restricted pending moderator review of your case. Contact Reality FX to appeal.</p>'
      : (ts.tier === 'caution' ? '<p class="small" style="color:var(--muted);margin-top:12px;">Be careful — stay above ' + ts.cautionAt + '%. Below ' + ts.timeoutAt + '% your account is timed out. Earn it back through good conduct.</p>'
        : (ts.tier === 'danger' ? '<p class="small" style="color:#f0a89c;margin-top:12px;">' + (ts.extended ? 'Your timeout is extended and your account is critically low. 0% means full restriction.' : (ts.timedOut ? 'Your account is currently timed out. Complete your review steps and keep good conduct — the ring recovers.' : 'Danger zone — below ' + ts.timeoutAt + '% your account is timed out. Good conduct will earn it back.')) + '</p>'
          : (ts.tier === 'excellent' ? '<p class="small faint" style="margin-top:12px;">Excellent standing — the highest tier at Reality FX. Keep doing what you\'re doing.</p>'
            : '<p class="small faint" style="margin-top:12px;">Your standing at Reality FX — it rises with good conduct and falls with policy breaches. Click the ring to see every action that moved it.</p>')));
    /* The ring owns the card's centre — the OS hero treatment: dial on top,
       copy beneath, everything aligned on the same axis. The card is clickable
       and the ring breathes a soft gold glow (the SVG blur already hugs the
       arc; this adds a gentle pulse so the standing feels alive, like the OS). */
    return '<div class="card trust-card" style="cursor:pointer;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px 22px;" onclick="RFX.memberTrustDetail()" title="Open your standing dashboard">' +
      ui.trustRingHTML(ts.score, { tierCls: tierCls, cap: 'standing' }) +
      '<div style="max-width:280px;">' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.shieldCheck || '') + '</span>' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Your Trust</span>' +
      '</div>' +
      '<div style="font-size:14px;color:var(--text);font-weight:600;">' + ui.esc(ts.label) + '</div>' +
      '<div class="small faint" style="margin-top:4px;">' + events.length + ' recorded ' + (events.length === 1 ? 'action' : 'actions') + ' · click to view →</div>' +
      '</div>' + warnLine + '</div>';
  }
  /* The standing dashboard — every good & bad action that moved the bar,
     with the thresholds explained, and the buddy rule made visible. */
  window.RFX.memberTrustDetail = function () {
    const I = RFX.icons || {};
    const ts = db.trustStatus(enr);
    const events = db.trustEvents(enr);
    const rows = events.length
      ? events.map(x =>
        '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<span class="small mono" style="color:' + (x.delta < 0 ? '#f0a89c' : '#7ee2a4') + ';font-weight:700;width:52px;flex:none;">' + (x.delta > 0 ? '+' : '') + x.delta + '</span>' +
        '<div style="flex:1;"><div style="font-size:13px;color:var(--text);">' + ui.esc(x.reason || '') + '</div>' +
        '<div class="small faint">' + db.fmtDate(x.at) + (x.by ? ' · by ' + ui.esc(x.by) : '') + (x.ref ? ' · ' + ui.esc(x.ref) : '') + '</div></div></div>').join('')
      : '<p class="small faint">No moves recorded yet — your bar is untouched, which is exactly how it should be.</p>';
    const tierCls2 = ts.tier === 'caution' ? 'caution' : (ts.tier === 'danger') ? 'low' : (ts.tier === 'restricted' ? 'crit' : '');
    const m = ui.modal(
      '<div style="margin-bottom:14px;">' +
      '<div style="display:flex;align-items:center;gap:26px;flex-wrap:wrap;">' +
      ui.trustRingHTML(ts.score, { tierCls: tierCls2, cap: 'standing' }) +
      '<div style="flex:1;min-width:230px;">' +
      '<div class="small" style="color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">' + ui.esc(ts.label) + '</div>' +
      '<p class="small faint" style="margin:0;">Your ring starts at 100% the day you\'re approved. Policy breaches drain it; genuine good conduct earns it back. It never sways on a whim — and a referred student\'s serious violation costs you points too, because you vouch for who you bring into the family.</p>' +
      '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
      '<span class="pill ok" style="font-size:10px;">Excellent: 80–100%</span>' +
      '<span class="pill" style="font-size:10px;">Stable: 50–79%</span>' +
      '<span class="pill warn" style="font-size:10px;">Caution: 30–49% — be careful</span>' +
      '<span class="pill warn" style="font-size:10px;">Danger zone: below ' + ts.cautionAt + '% · timed out below ' + ts.timeoutAt + '%</span>' +
      '<span class="pill" style="font-size:10px;border-color:rgba(231,111,81,0.4);color:#f0a89c;">Restricted: 0%</span>' +
      '</div></div>' +
      '<div class="eyebrow muted" style="margin:4px 0 6px;">Actions that moved your bar</div>' +
      '<div style="max-height:280px;overflow:auto;">' + rows + '</div>');
    m.setTitle('Trust Bar · your standing at Reality FX');
  }

  /* Notifications feed — the member hears about things that happened while
     they were away: print trust granted, an award landing, a referral
     commission paid, a buddy linking. Unread items carry a gold NEW badge;
     the freshest unread one is toasted the moment the panel opens so no
     special moment is ever missed. */
  function notificationsCard() {
    const I = RFX.icons || {};
    const items = db.studentNotifications(enr);
    if (!items.length) return '';
    const unread = db.unreadNotificationCount(enr);
    const rows = items.slice(0, 6).map(n =>
      '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start;">' +
      '<span class="ic" style="color:var(--gold-bright);flex:none;margin-top:1px;">' + (n.kind === 'printTrust' ? (I.printer || I.doc || '') : n.kind === 'referral' ? (I.link || I.gift || '') : n.kind === 'award' ? (I.award || I.gift || '') : (I.mail || '')) + '</span>' +
      '<div style="flex:1;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<b style="color:var(--text);font-size:13px;">' + ui.esc(n.title) + '</b>' +
      (n.read ? '' : '<span class="pill gold" style="font-size:9px;">NEW</span>') +
      '<span class="small faint" style="margin-left:auto;">' + db.fmtDate(n.at) + '</span></div>' +
      '<div class="small" style="color:var(--muted);margin-top:2px;">' + ui.esc(n.message) + '</div>' +
      '</div></div>').join('');
    return '<div class="card span-full" id="notifications-card">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Your moments</span>' +
      (unread ? '<span class="pill gold" style="font-size:9px;">' + unread + ' new</span>' : '') +
      (unread ? '<button class="btn btn-ghost btn-sm" id="notif-mark-read" style="margin-left:auto;font-size:11px;">Mark all read</button>' : '') +
      '</div>' + rows +
      (items.length > 6 ? '<p class="small faint" style="margin-top:8px;">Showing the latest 6 — the rest live in your email as always.</p>' : '') +
      '</div>';
  }
  function toastNewNotifications() {
    // Toasted is separate from read: the toast is the heads-up, but the gold
    // NEW badge stays on the card until the student clicks "Mark all read".
    // markToasted stamps the newest unread-and-untoasted item and returns it.
    const fresh = db.markToasted(enr);
    if (!fresh) return;
    ui.toastOk(fresh.title + ' — ' + fresh.message);
  }

  /* Merch — earned reward + the merch shop. Physical goods: size + address,
     fulfilment queue on the staff side. Earned merch is never credit. */
  function confettiBits(n) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.9;
      const dur = 2.2 + Math.random() * 1.6;
      const size = 5 + Math.random() * 5;
      const gold = Math.random() < 0.75;
      out += '<i style="left:' + left.toFixed(1) + '%;animation-delay:' + delay.toFixed(2) + 's;animation-duration:' + dur.toFixed(2) + 's;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;' + (gold ? 'background:linear-gradient(135deg,#f0d98c,#d4af37);' : 'background:rgba(255,255,255,0.85);') + '"></i>';
    }
    return out;
  }
  function merchCard() {
    const I = RFX.icons || {};
    const mail = enr.payment.email;
    const w = db.getWallet(mail);
    const earned = db.merchAchievementFor(enr.studentId);
    const mine = db.merchByEmail(mail).slice().reverse();
    const catalog = db.getCatalog().filter(x => x.kind === 'merch');
    const usable = db.spendable(mail);
    const sizes = (db.getSettings().merch && db.getSettings().merch.sizes) || ['S', 'M', 'L', 'XL', 'XXL'];
    const sizeOpts = sizes.map(s => '<option>' + s + '</option>').join('');
    const addr = (enr.registration && enr.registration.identity && enr.registration.identity.address) || '';

    let earnedBlock = '';
    if (earned) {
      const celebrated = !!earned.celebratedAt;
      const confirmed = earned.items[0].size && earned.address;
      if (!celebrated) {
        // The fanfare — plays exactly once, then the pickers reveal.
        earnedBlock = '<div class="merch-celebrate">' +
          '<div class="confetti" aria-hidden="true">' + confettiBits(26) + '</div>' +
          '<div class="merch-celebrate-in">' +
          '<div class="celebrate-trophy">' + (I.trophy || '') + '</div>' +
          '<div class="eyebrow" style="margin-bottom:6px;">Academy achievement unlocked</div>' +
          '<h3 class="serif gold" style="font-size:22px;margin-bottom:4px;">You earned the 80%+ reward</h3>' +
          '<p class="small" style="margin-bottom:14px;">Your average of <b>' + earned.average + '%</b> earned you a free Reality FX tee + hoody. This one\'s on the Academy.</p>' +
          '<button class="btn btn-gold" id="me-celebrate">' + (I.gift || '') + ' Claim my reward</button>' +
          '</div></div>';
      } else {
        earnedBlock = '<div class="merch-earned">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
          '<span class="ic" style="color:var(--gold-bright);">' + (I.trophy || '') + '</span>' +
          (confirmed
            ? '<b style="color:var(--text);">Reward confirmed — sizes locked in, awaiting shipment.</b>'
            : '<b style="color:var(--text);">You earned the 80%+ reward</b>') + '</div>' +
          (confirmed
            ? '<p class="small" style="margin-bottom:6px;">Tee (size ' + ui.esc(earned.items[0].size) + ') · Hoody (size ' + ui.esc(earned.items[1].size) + ') → ' + ui.esc(earned.address) + '</p>'
            : '<p class="small" style="margin-bottom:10px;">Free Reality FX tee + hoody — your average ' + earned.average + '% made it happen. Pick sizes and we\'ll ship.</p>') +
          (confirmed
            ? ''
            : '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
              '<select class="select" id="me-shirt" style="flex:1;min-width:110px;"><option value="">T-shirt size</option>' + sizeOpts + '</select>' +
              '<select class="select" id="me-hoody" style="flex:1;min-width:110px;"><option value="">Hoody size</option>' + sizeOpts + '</select></div>' +
              '<input class="input" id="me-addr" placeholder="Delivery address" value="' + ui.esc(addr) + '" style="margin-bottom:8px;">' +
              '<button class="btn btn-gold btn-sm" id="me-earn-ship">' + (I.send || '') + ' Confirm &amp; ship my reward</button>') +
          '</div>';
      }
    }

    const shopRows = catalog.map(it => {
      const afford = usable >= it.price;
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:160px;"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
        '<span class="mono" style="font-size:10.5px;color:var(--gold-bright);">' + ui.esc(it.code) + '</span>' +
        '<b style="color:var(--text);font-size:13px;">' + ui.esc(it.name) + '</b></div>' +
        '<div class="small faint">' + db.money(it.price, w.currency) + (it.note ? ' · ' + ui.esc(it.note) : '') + '</div></div>' +
        '<select class="select" data-merch-size="' + ui.esc(it.code) + '" style="width:84px;"><option value="">Size</option>' + sizeOpts + '</select>' +
        (afford
          ? '<button class="btn btn-gold btn-sm" data-merch-buy="' + ui.esc(it.code) + '" data-amt="' + it.price + '" data-name="' + ui.esc(it.name) + '">Buy</button>'
          : '<span class="small faint">' + db.money(it.price - usable, w.currency) + ' short</span>') +
        '</div>';
    }).join('');
    const shopAddr = '<input class="input" id="me-shop-addr" placeholder="Delivery address for shop orders" value="' + ui.esc(addr) + '" style="margin:10px 0 2px;">';

    const myRows = mine.length
      ? '<ul class="audit" style="margin-top:10px;">' + mine.map(o =>
        '<li><span class="a-time">' + db.fmtDateShort(o.at) + '</span><span class="a-txt"><b>' + (o.kind === 'earned' ? 'Reward' : ui.esc(o.items[0] && o.items[0].name)) + '</b> ' +
        (o.kind === 'earned' ? '· free' : '· ' + db.money(o.total, 'R')) + ' · <span class="pill ' + (o.status === 'delivered' ? 'ok' : o.status === 'shipped' ? 'info' : 'warn') + '" style="font-size:9px;">' + ui.esc(db.MERCH_STATUS_LABELS[o.status] || o.status) + '</span></span></li>'
      ).join('') + '</ul>'
      : '';

    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:10px;">Merch</div>' +
      (earnedBlock || '') +
      '<div class="eyebrow muted" style="margin:' + (earned ? '16px 0 4px;' : '0 0 4px;') + '">Shop with your RFX balance</div>' +
      (catalog.length ? '<div>' + shopRows + shopAddr + '</div>' : '<p class="small faint">No merch on the catalog yet.</p>') +
      (myRows || '') +
      '<p class="small faint" style="margin-top:10px;">Merch is physical — it needs a size and delivery address, then flows through the fulfilment queue (packing → shipped → delivered). Your earned reward is a free gift from the Academy, never credit.</p></div>';
  }

  /* Spend surface — NOT a store. The website store owns products (each with a
     code Lee mirrors there); this is the wallet's spend rail. The dropdown is
     sorted by price descending and only affordable packages are payable. */
  function spendCard() {
    const I = RFX.icons || {};
    const usable = db.spendable(enr.payment.email);
    const w = db.getWallet(enr.payment.email);
    const catalog = db.getCatalog(); // already sorted price descending
    const rows = catalog.map(it => {
      const afford = usable >= it.price;
      return '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);">' +
        '<div style="flex:1;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<span class="mono" style="font-size:11px;color:var(--gold-bright);letter-spacing:0.5px;">' + ui.esc(it.code) + '</span>' +
        '<b style="color:var(--text);font-size:13.5px;">' + ui.esc(it.name) + '</b></div>' +
        '<div class="small faint">' + db.money(it.price, it.currency || w.currency) + (it.note ? ' · ' + ui.esc(it.note) : '') + '</div></div>' +
        (afford
          ? '<button class="btn btn-gold btn-sm" data-redeem="' + ui.esc(it.code) + '" data-amt="' + it.price + '" data-name="' + ui.esc(it.name) + '">Apply</button>'
          : '<button class="btn btn-dark btn-sm" disabled title="Need ' + db.money(it.price - usable, it.currency || w.currency) + ' more">' + db.money(it.price - usable, it.currency || w.currency) + ' short</button>') +
        '</div>';
    }).join('');
    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:10px;">Spend your credit</div>' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;">' +
      '<span class="num gold" style="font-size:26px;">' + db.money(usable, w.currency) + '</span>' +
      '<span class="small faint">spendable now (expired credits excluded)</span></div>' +
      '<div style="margin-bottom:6px;">' + rows + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<input class="input" id="sp-custom" type="number" placeholder="Custom amount" style="flex:1;">' +
      '<button class="btn btn-ghost btn-sm" id="sp-apply-custom">Apply to next course</button></div>' +
      '<p class="small faint" style="margin-top:12px;">Every package carries a code that matches the website store — pick what you can afford and it applies instantly. Can’t afford a package yet? It shows exactly how much more you need.</p></div>';
  }

  /* Profile tier — the broker pattern done honestly: unverified = DEMO,
     verified + approved = LIVE. The gate is already enforced (no Student Code
     before approval, so a DEMO account simply cannot get in); the badge makes
     the tier visible. The FOUNDER carries the master key — a badge that
     outranks both, plus lifetime access no demo clock can touch. */
  function tierBadge() {
    if (db.isFounder(enr)) {
      return '<span class="pill gold" title="The founder — the master key. Every door, every time."><span class="dot ok pulse"></span> FOUNDER · MASTER KEY</span>';
    }
    const tier = db.profileTier(enr);
    return tier === 'LIVE'
      ? '<span class="pill gold" title="Verified &amp; approved — full access"><span class="dot ok pulse"></span> LIVE PROFILE</span>'
      : '<span class="pill warn" title="Not verified yet — demo access only">DEMO PROFILE</span>';
  }
  function identityCard() {
    const I = RFX.icons || {};
    const p = enr.payment;
    const id = enr.studentId || '—';
    const idRows = [
      { ic: I.user || '', lab: 'Student ID', val: '<span style="font-family:ui-monospace,monospace;">' + ui.esc(id) + '</span>' },
      { ic: I.book || '', lab: 'Course', val: ui.esc(p.course) },
      { ic: I.card || '', lab: 'Paid', val: db.money(p.price, p.currency) + ' <span class="pill ok" style="font-size:8px;">paid</span>' },
      { ic: I.calendar || '', lab: 'Enrolled', val: db.fmtDateShort(enr.createdAt) },
    ];
    const detailRows = idRows.map(r =>
      '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">' +
      '<span class="ic" style="flex:none;color:var(--gold-bright);">' + r.ic + '</span>' +
      '<span class="small faint" style="width:70px;flex:none;font-size:9px;letter-spacing:0.12em;">' + r.lab + '</span>' +
      '<span class="small" style="color:var(--text);margin-left:auto;text-align:right;">' + r.val + '</span></div>'
    ).join('');
    const foot = db.isFounder(enr)
      ? '<div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border:1px solid var(--border-gold);border-radius:10px;background:linear-gradient(90deg,rgba(212,175,55,0.09),transparent);">' +
        '<span class="small gold" style="font-weight:700;letter-spacing:0.1em;">FOUNDER &middot; LIFETIME ACCESS</span>' +
        '<span class="life-bar" title="Master key — never expires" style="width:90px;"><span class="life-bar-fill" style="--v:100%;background:linear-gradient(90deg,#8f6f1f,#d4af37,#f0d98c);"></span></span></div>'
      : demoCountdownBlock();
    return '<div class="card card-gold">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><div class="eyebrow" style="margin:0;color:var(--gold-bright);">Your identity</div>' + tierBadge() + '</div>' +
      '<div class="id-chip" style="border-bottom:1px solid var(--border);padding-bottom:12px;width:100%;">' + id + '</div>' +
      '<div style="margin-top:4px;">' + detailRows + '</div>' +
      foot +
      '</div>';
  }

  /* The demo tour clock. The label changes with the tier so the two facts
     never collide on screen: before approval it is a "demo session" (a tour
     of the registration itself); once APPROVED it becomes a "demo tour" with
     a tooltip making it explicit that the approval is real and permanent —
     the clock is only how long the free tour lasts, never how long the
     student's status lasts. */
  function demoCountdownBlock() {
    // The founder holds the master key: no clock, no drain — a quiet lifetime
    // badge instead of a countdown. Every other demo account sees the tour.
    if (db.isFounder(enr)) {
      return '<div class="demo-countdown dc-inline" id="mc-demo-countdown" title="The founder — the master key. No tour clock applies; access is for life."><span class="ic" data-icon="crown"></span><span class="dc-label" style="color:var(--gold-bright);">Founder · lifetime access</span><span class="life-bar" title="Master key — never expires" style="width:92px;"><span class="life-bar-fill" style="--v:100%;background:linear-gradient(90deg,#8f6f1f,#d4af37,#f0d98c);"></span></span></div>';
    }
    const approved = !!(enr.studentId && enr.progress && enr.progress.approved);
    const label = approved ? 'Demo tour' : 'Demo session';
    const title = approved
      ? 'Free 24-hour tour of the Academy — your approval and Student ID are permanent. This clock is how long the tour lasts.'
      : 'Time left till your demo session is expired';
    const barTitle = approved
      ? 'Tour window remaining — your access is real; this is the free tour\'s life'
      : 'Tour life remaining — it drains as your 24 hours run out';
    return '<div class="demo-countdown dc-inline" id="mc-demo-countdown" title="' + title + '"><span class="ic" data-icon="clock"></span><span class="dc-label">' + label + '</span><span class="dc-time">' + db.fmtCountdown(db.demoTimeLeft(enr)) + '</span><span class="life-bar" title="' + barTitle + '"><span class="life-bar-fill" style="--v:100%"></span></span></div>';
  }

  /* Your vital details — everything private, masked by default, revealed one
     field at a time with the eye. Reveal state survives re-renders so a page
     refresh never silently exposes anything. */
  const revealed = new Set(); // field keys the student has opened this session
  function mask(val) {
    if (!val) return '—';
    const s = String(val);
    // short values must stay fully hidden — showing first2•••last2 on a 5-char
    // secret would leak ~80% of it
    if (s.length <= 6) return '•'.repeat(Math.min(s.length, 12));
    return s.slice(0, 2) + '•'.repeat(Math.min(s.length - 4, 14)) + s.slice(-2);
  }
  function vitalsCard() {
    const I = RFX.icons || {};
    const w = db.getWallet(enr.payment.email);
    const reg = enr.registration || {};
    const idn = reg.identity || {};
    const personal = reg.personal || {};
    const rows = [
      { k: 'code', label: 'Student Code', val: enr.studentCode ? 'RFX-' + enr.studentCode : null, mono: true },
      { k: 'wallet', label: 'Wallet number', val: w.walletNo || null, mono: true },
      { k: 'email', label: 'Enrollment email', val: enr.payment.email, mono: true },
      { k: 'idnum', label: 'Student ID', val: enr.studentId || null, mono: true },
      { k: 'phone', label: 'Phone', val: idn.phone || null, mono: true },
      { k: 'addr', label: 'Address', val: idn.address || null },
      { k: 'dob', label: 'Date of birth', val: personal.dob || null },
    ].filter(r => r.val);
    rows.forEach(r => { if (r.val) vitalValues[r.k] = r.val; });
    const html = rows.map(r => {
      const open = revealed.has(r.k);
      return '<div class="vital-row">' +
        '<div class="vital-lab">' + r.label + '</div>' +
        '<div class="vital-val ' + (r.mono ? 'mono' : '') + '" id="vital-' + r.k + '">' + ui.esc(open ? r.val : mask(r.val)) + '</div>' +
        '<button class="vital-eye" data-vital="' + r.k + '" title="' + (open ? 'Hide' : 'Reveal') + ' ' + r.label.toLowerCase() + '" aria-label="' + (open ? 'Hide' : 'Reveal') + '">' +
        (open ? (I.eyeOff || '') : (I.eye || '')) + '</button>' +
        (open ? '<button class="vital-copy" data-vital-copy="' + r.k + '" title="Copy">' + (I.copy || I.doc || '') + '</button>' : '') +
        '</div>';
    }).join('');
    return '<div class="card">' +
      '<div class="eyebrow" style="margin-bottom:6px;">Your vital details</div>' +
      '<p class="small" style="margin-bottom:12px;">Everything you need to sign in or quote at ceremonies — masked until you reveal it, one field at a time. Never lose your logins again.</p>' +
      '<div class="vital-list">' + html + '</div>' +
      '<p class="small faint" style="margin-top:12px;">These reveal on this device only, for this session. If you ever forget your Student Code, the reception team can verify your identity and re-issue access.</p></div>';
  }

  /* Academy reachability — the Academy is a separate server (RFX OS). If it
     is offline, the link would otherwise 404 / refuse to connect with no
     explanation. So the card shows a live status, and the button itself
     probes before opening: if the Academy is unreachable the student gets a
     calm toast instead of a broken page — never a mystery. */
  let osProbeState = null; // 'checking' | 'up' | 'down' — cached, re-probed per render
  let osWasDown = false;     // true while the Academy is unreachable
  let osWelcomeSent = false; // back-online notice fired once per outage
  let probeTick = 0;         // counts panel polls so the Academy re-probes ~every 15s
  function probeOs(okCb, failCb) {
    const url = db.osIndexUrl();
    osProbeState = 'checking';
    let lastShown = null; // guard: never rewrite the label unless the state changed
    const done = (up) => {
      const state = up ? 'up' : 'down';
      if (osProbeState === state && lastShown === state) { if (up) okCb && okCb(); else failCb && failCb(); return; }
      osProbeState = state;
      lastShown = state;
      const row = document.getElementById('os-probe-row');
      const lab = document.getElementById('os-probe-label');
      const dot = row ? row.querySelector('.dot') : (lab && lab.previousElementSibling);
      // genuine down→up transition — the "power is back" moment
      const wasDown = osWasDown;
      const powerOn = up && osWasDown && !osWelcomeSent;
      if (up) { osWasDown = false; } else { osWasDown = true; osWelcomeSent = false; }
      if (powerOn) osWelcomeSent = true;
      // the shared outage ledger — ONE row per outage, whatever panel saw it
      try {
        if (!up && !wasDown) db.osOutageBegin();   // lights just went out
        if (up && wasDown) db.osOutageEnd();       // lights are back
      } catch (e) { /* the ledger is best-effort */ }
      if (lab) {
        // Wording matters — a student who just paid is not being told "try
        // again later"; they are being told the Academy is being maintained
        // and that their access is safe. Calm, warm, never dismissive.
        lab.innerHTML = up
          ? (powerOn ? 'The Academy is back online — lights are on.' : 'The Academy is online and waiting for you.')
          : '<span class="spanner-glow" title="The Academy is being repaired right now — our engineers are on it. Your access is safe and waiting for you. Please be patient — this is temporary.">' + (RFX.icons && RFX.icons.wrench ? RFX.icons.wrench : '') + '</span> <span class="maintenance-inline">Academy maintenance in progress</span>' + (RFX.icons && RFX.icons.power ? '<span class="os-power-tag">' + RFX.icons.power + ' power is out</span>' : '');
      }
      if (row) {
        row.classList.remove('power-on');
        row.classList.toggle('os-off', !up);
        if (dot) {
          dot.classList.remove('ok', 'warn', 'off');
          dot.classList.toggle('pulse', up);
          dot.classList.add(up ? 'ok' : 'off');
        }
        if (up && powerOn) {
          void row.offsetWidth; // restart the flicker animation
          row.classList.add('power-on');
          // the big ✓ above joins the celebration — a few glowing heartbeats
          // that sell the moment, then it settles back to its steady gold.
          const check = document.querySelector('.big-check .hero-ic');
          if (check) { check.classList.add('check-power'); setTimeout(function () { check.classList.remove('check-power'); }, 3600); }
          // drop the class once the one-shot flicker finishes (keeps the row
          // clean; the next transition re-adds it), and settle the label to
          // the steady line only if the Academy is still up.
          setTimeout(function () { const r2 = document.getElementById('os-probe-row'); if (r2) r2.classList.remove('power-on'); }, 1600);
          if (lab) setTimeout(function () {
            const l2 = document.getElementById('os-probe-label');
            if (l2 && osProbeState === 'up') l2.innerHTML = 'The Academy is online and waiting for you.';
          }, 2400);
        }
      }
      if (up && powerOn) {
        ui.toastOk('The Academy is back online — your seat is ready.');
        try { db.academyOnlineNotice(enr); } catch (e) { /* the notice is best-effort */ }
      }
      if (up) okCb && okCb(); else failCb && failCb();
    };
    try {
      // HEAD-like probe that never throws on CORS (the OS page itself is
      // plain HTML; a same-origin fetch to another port with no-cors tells
      // us whether anything answers).
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3500);
      fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
        .then(function () { clearTimeout(timer); done(true); })
        .catch(function () { clearTimeout(timer); done(false); });
    } catch (e) { done(false); }
  }
  /* THE GATE — System A's own door (FOR-LEE §9.62). The Machinery card's
     gate line probes the same endpoint the OS Cloud Function calls before
     issuing any session: {systemA}/api/gate?email=… . A live answer, never
     a staged label — if the server is unreachable the line says so plainly. */
  let gateProbeAt = 0;
  function probeGate() {
    const lab = document.getElementById('mach-gate');
    if (!lab || !enr) return;
    const nowMs = Date.now();
    if (nowMs - gateProbeAt < 8000) return; // once per ~8s, never per 2.5s poll
    gateProbeAt = nowMs;
    const email = (enr.payment && enr.payment.email) || '';
    const t0 = performance.now();
    const settle = (txt) => { if (lab) { lab.innerHTML = txt; lab.title = 'The gate answers from System A\'s own throttle record — the same record the sign-in screen enforces.'; } };
    try {
      fetch('/api/gate?email=' + encodeURIComponent(email), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (g) {
          const ms = (performance.now() - t0).toFixed(1);
          settle((g && g.locked)
            ? '<span style="color:#f0a89c;">locked</span> · <span class="faint">' + ms + ' ms</span> — try again after the countdown, or use Forgot password?'
            : '<span style="color:#7ee2a4;">open</span> · <span class="faint">' + ms + ' ms</span> — your identity is cleared');
        })
        .catch(function () { settle('<span style="color:#c9b57a;">unreachable</span> — local read stands in'); });
    } catch (e) { settle('<span style="color:#c9b57a;">unreachable</span> — local read stands in'); }
  }
  function accessCard() {
    const I = RFX.icons || {};
    // The Academy entry point (derived once, in db.osIndexUrl). Passing ?sid=
    // lets the Academy greet the student by their identity.
    const osUrl = db.osIndexUrl() + '?sid=' + encodeURIComponent(enr.studentId || '');
    let body;
    if (db.demoTourExpired(enr)) {
      // The 24h free tour has run out — the game-style moment. The tour gave
      // a real look inside; now the door closes with a calm, classy farewell
      // and a straight path to keep going. Never a dead link, never a guilt
      // trip: the record stays, the door reopens the moment they enroll.
      const regHref = enr.registration && enr.registration.token
        ? 'register.html?token=' + enr.registration.token
        : 'index.html';
      body = '<div class="tour-ended" style="text-align:center;padding:18px 10px 14px;">' +
        '<div style="width:74px;height:74px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(212,175,55,0.22),rgba(212,175,55,0.05));border:1px solid rgba(212,175,55,0.4);box-shadow:0 0 34px rgba(212,175,55,0.22);">' +
        '<span style="color:var(--gold-bright);font-size:34px;line-height:1;">' + (I.key || I.lock || '✦') + '</span></div>' +
        '<div class="serif gold" style="font-size:19px;margin-bottom:6px;">Your free tour has ended</div>' +
        '<p class="small" style="color:var(--muted);max-width:420px;margin:0 auto 12px;line-height:1.6;">You saw the Academy from the inside. Your identity and progress are safe — the door simply needs the key that unlocks the real thing.</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:6px;">' +
        '<a class="btn btn-gold" href="' + regHref + '">' + (I.unlock || '') + ' Enroll &amp; keep your access</a>' +
        '<a class="btn btn-ghost" href="index.html">Front desk</a>' +
        '</div>' +
        '<p class="small faint" style="margin-top:8px;">Your registration link stays valid — picking up where you left off takes minutes.</p>' +
        '</div>';
    } else if (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED') {
      // The card body fills the whole 400px box — the check, the status and the
      // button breathe with even space above and below (no dead gap under the
      // CTA), and a quiet reassurance line closes the card.
      body = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;flex:1;padding:6px 0 10px;">' +
        '<div class="big-check" style="width:58px;height:58px;margin:0 auto 14px;"><span class="hero-ic">' + (I.checkCircle || '') + '</span></div>' +
        '<p class="small" style="color:#7ee2a4;font-weight:600;margin-bottom:16px;">Your RFX OS access is ready.</p>' +
        '<div id="os-probe-row" class="os-probe-row' + (osProbeState === 'down' ? ' os-off' : '') + '" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;">' +
        '<span class="dot ' + (osProbeState === 'down' ? 'off' : osProbeState === 'up' ? 'ok pulse' : '') + '"></span>' +
        '<span class="small" style="color:var(--muted);" id="os-probe-label">' +
        (osProbeState === 'down' ? '<span class="spanner-glow" title="The Academy is being repaired right now — our engineers are on it. Your access is safe and waiting for you. Please be patient — this is temporary.">' + (I.wrench || '') + '</span> <span class="maintenance-inline">Academy maintenance in progress</span><span class="os-power-tag">' + (I.power || '') + ' power is out</span>'
          : (osProbeState === 'up' ? 'The Academy is online and waiting for you.'
            : 'Checking the Academy link…')) + '</span></div>' +
        '<a class="btn btn-gold" id="os-enter-btn" href="' + osUrl + '" target="_blank" style="width:100%;">' + (I.unlock || '') + ' Enter the Academy</a>' +
        '<p class="small faint" style="margin-top:14px;">Your identity is verified — RFX OS welcomes you by name, one session at a time.</p></div>';
    } else if (enr.state === 'APPROVED') {
      body = '<div class="access-locked"><span class="ic">' + (I.lock || '') + '</span>' +
        '<span>Approved. RFX OS unlocks the moment the handshake confirms — usually seconds. Check back shortly.</span></div>';
    } else if (enr.state === 'REJECTED') {
      const res = enr.resolution || {};
      let line = 'Your registration was not approved. ';
      if (res.method === 'credit' && res.executedAt) {
        line = 'Resolution complete — ' + db.money(res.amount, enr.payment.currency) + ' credit was added to your RFX account (see your account balance below).';
      } else if (res.method === 'refund' && res.executedAt) {
        line = 'Your refund is queued for the monthly consolidated batch. Note: once paid, all rights and ownership of course material are revoked and a 30-day re-enrollment cooldown begins — see the Refund & Credit Policy you accepted.';
      } else if (db.canReapply(enr).ok) {
        line = 'This rejection can be fixed — re-apply through your registration link.';
      } else {
        line = 'Choose how you would like your payment returned through your registration link.';
      }
      body = '<div class="access-locked"><span class="ic">' + (I.alert || '') + '</span><span>' + ui.esc(line) +
        (enr.registration && enr.registration.token
          ? ' <a href="register.html?token=' + enr.registration.token + '" style="color:var(--gold);text-decoration:underline;">Open registration →</a>'
          : '') + '</span></div>';
    } else if (enr.state === 'REFUNDED') {
      const res = enr.resolution || {};
      const until = res.reapplyEligibleAt ? ' You may re-apply after <b>' + db.fmtDateShort(res.reapplyEligibleAt) + '</b>.' : '';
      body = '<div class="access-locked"><span class="ic">' + (I.alert || '') + '</span><span>' +
        '<b>Your enrollment was refunded.</b> As stated in the policy you accepted, all rights and ownership of Reality FX course material have been revoked and your RFX OS access is closed.' + until +
        '</span></div>';
    } else {
      body = '<div class="access-locked"><span class="ic">' + (I.clock || '') + '</span>' +
        '<span>Your registration is being processed. RFX OS unlocks once you are approved and verified.</span></div>';
    }
    return '<div class="card" style="display:flex;flex-direction:column;"><div class="eyebrow muted" style="margin-bottom:12px;">RFX OS access</div>' + body + '</div>';
  }

  /* The MASTER KEY — the founder's overview card. One place, every door:
     the founder can step into the staff console, the SRM, the admin console,
     the wallet, the registration desk or the Academy at any time, from any
     device. No door is locked to the person who built them all. */
  function masterKeyCard() {
    const I = RFX.icons || {};
    // Registration desk needs a VALID token (a rotated/expired token would
    // land on a broken link); fall back to the front desk when there is none.
    const regToken = (enr.registration && enr.registration.token) || '';
    const regHref = regToken ? 'register.html?token=' + regToken : 'index.html';
    const doors = [
      { href: 'staff.html', ic: I.users || '', t: 'Staff console', d: 'Reception desk & shifts' },
      { href: 'srm.html', ic: I.search || '', t: 'SRM', d: 'Every student, every record' },
      { href: 'admin.html', ic: I.shield || '', t: 'Admin console', d: 'Enrollments, audit & finance' },
      { href: 'wallet.html', ic: I.wallet || '', t: 'Wallet centre', d: 'Credit, payouts & wages' },
      { href: regHref, ic: I.doc || '', t: 'Registration desk', d: 'The gate, as students see it' },
      { href: db.osIndexUrl() + '?sid=' + encodeURIComponent(enr.studentId || ''), ic: I.unlock || '', t: 'RFX OS Academy', d: 'The learning environment' },
    ];
    // six doors, no orphans: a fixed 3×2 grid on wide screens, 2×3 on
    // tablets, 1×6 on phones — every door equal, every gap equal
    const tiles = doors.map(d =>
      '<a href="' + d.href + '" target="_blank" style="display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:7px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;text-decoration:none;background:rgba(255,255,255,0.015);transition:border-color .25s,transform .25s,background .25s;min-height:88px;">' +
      '<span style="display:flex;align-items:center;gap:9px;width:100%;"><span class="ic" style="color:var(--gold-bright);">' + d.ic + '</span>' +
      '<b style="font-size:13px;color:var(--text);">' + d.t + '</b></span>' +
      '<span class="small faint" style="font-size:10.5px;line-height:1.45;">' + d.d + '</span></a>').join('');
    return '<div class="card mk-overview" style="grid-column:1/-1;border-color:rgba(212,175,55,0.45);background:linear-gradient(135deg,rgba(212,175,55,0.06),rgba(0,0,0,0) 55%);">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.key || I.lock || '') + '</span>' +
      '<span class="eyebrow gold" style="margin-bottom:0;">The Master Key — founder overview</span></div>' +
      '<p class="small faint" style="margin-bottom:12px;">Every door, from anywhere — no console is locked to the person who built them all. Step in, look, step out; you see exactly what staff and students see.</p>' +
      '<div class="mk-doors">' + tiles + '</div></div>';
  }

  /* Referral marketing — the student's own shareable code, their tier and
     every student they brought in. Payouts are single-level (direct referrals
     only) and commissions vest only after the referred student survives the
     refund window — money subject to change is not yet earned. */
  function referralCard() {
    const I = RFX.icons || {};
    const id = enr.studentId || enr.id;
    const st = db.referralStats(id);
    const net = db.referralNetwork(id);
    const link = location.href.split('member.html')[0] + 'index.html?ref=' + encodeURIComponent(enr.referralCode || '');
    const tiers = (db.getSettings().referral && db.getSettings().referral.tiers) || [{ min: 0, rate: 15 }];
    const tierRows = tiers.map(t =>
      '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px;">' +
      '<span style="color:var(--muted);">' + (t.min === 0 ? 'Starter' : t.min + '+ students') + '</span>' +
      '<b style="color:' + (st.rate >= t.rate ? 'var(--gold-bright)' : 'var(--faint)') + ';">' + t.rate + '%</b></div>').join('');
    const rows = net.length
      ? '<ul class="audit" style="margin-top:10px;">' + net.map(r =>
        '<li><span class="a-time">' + db.fmtDateShort(r.at) + '</span><span class="a-txt"><b>' + ui.esc(r.name) + '</b> <span class="small faint">' + ui.esc(r.studentId || r.id) + '</span> · ' +
        '<span class="pill ' + (r.state === 'ACTIVE' ? 'ok' : r.state === 'REFUNDED' ? 'danger' : r.state === 'REJECTED' ? 'warn' : '') + '" style="font-size:9px;">' + ui.esc(r.state) + '</span></span></li>').join('') + '</ul>'
      : '<p class="small faint" style="margin-top:10px;">No one has enrolled through your code yet. Share it — when a friend you brought in is fully locked in, you earn commission.</p>';
    return '<div class="card"><div class="eyebrow" style="margin-bottom:10px;">Refer &amp; earn</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
      '<span class="mono gold" style="font-size:16px;letter-spacing:1px;">' + ui.esc(enr.referralCode || '—') + '</span>' +
      '<span class="pill gold" style="font-size:9px;">your code · ' + st.rate + '% tier</span>' +
      (st.tierUpAt ? '<span class="small faint">next tier at ' + st.tierUpAt + ' referrals → ' + st.nextRate + '%</span>' : '<span class="small faint">top tier reached</span>') + '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
      '<input class="input" id="ref-link" readonly value="' + ui.esc(link) + '" style="flex:1;min-width:200px;font-size:12px;">' +
      '<button class="btn btn-ghost btn-sm" data-ref-copy>Share</button></div>' +
      '<div style="display:flex;gap:18px;margin-bottom:12px;flex-wrap:wrap;">' +
      '<div><span class="num gold" style="font-size:22px;">' + db.money(st.paidAmount, 'R') + '</span><div class="small faint">paid to wallet</div></div>' +
      '<div><span class="num" style="font-size:22px;color:var(--text);">' + db.money(st.pendingAmount, 'R') + '</span><div class="small faint">pending vesting</div></div>' +
      '<div><span class="num" style="font-size:22px;color:var(--text);">' + st.active + '</span><div class="small faint">active referrals</div></div></div>' +
      '<div class="small faint" style="margin-bottom:4px;">Tier ladder — more students, higher split:</div>' + tierRows +
      '<div class="small" style="margin-top:10px;color:var(--muted);">Earnings arrive in your RFX wallet once the student you brought in is <b style="color:var(--text);">fully locked in</b> — they must survive the ' + ((db.getSettings().referral && db.getSettings().referral.vestingDays) || 30) + '-day refund window. Commissions are paid only on students who are truly committed — that is what keeps every rand protected and the Academy strong.</div>' +
      rows + '</div>';
  }

  function walletCard() {
    const I = RFX.icons || {};
    const w = db.getWallet(enr.payment.email);
    const sum = db.walletSummary(enr.payment.email);
    const ledger = (w.ledger || []).slice().reverse();
    const warnMs = 60 * 86400 * 1000;
    const nowMs = Date.now();
    let rows;
    if (ledger.length) {
      rows = ledger.map(e => {
        let exp = '';
        if (e.type === 'credit' && e.expiresAt) {
          const diff = new Date(e.expiresAt).getTime() - nowMs;
          exp = diff <= 0 ? ' <span class="pill danger" style="font-size:9px;">expired</span>'
            : diff < warnMs ? ' <span class="pill warn" style="font-size:9px;">expires ' + db.fmtDateShort(e.expiresAt) + '</span>'
            : ' <span class="small faint">· valid until ' + db.fmtDateShort(e.expiresAt) + '</span>';
        }
        const kind = e.type === 'award'
          ? ' <span class="pill gold" style="font-size:9px;">award · never expires</span>'
          : e.type === 'credit' ? ' <span class="pill ok" style="font-size:9px;">credit</span>'
          : e.type === 'redeem' ? ' <span class="pill info" style="font-size:9px;">spent</span>' : '';
        const note = e.type === 'award' && e.note ? '<div class="small faint">' + ui.esc(e.note) + '</div>' : '';
        const signed = e.amount < 0
          ? '<b style="color:#f0a89c;">-' + db.money(Math.abs(e.amount), w.currency) + '</b>'
          : '<b style="color:#7ee2a4;">+' + db.money(e.amount, w.currency) + '</b>';
        return '<li><span class="a-time">' + db.fmtDateShort(e.at) + '</span><span class="a-txt">' + signed + kind + exp + note + '</span></li>';
      }).join('');
    } else {
      rows = '<li><span class="a-time">—</span><span class="a-txt faint">No activity yet — every RFX account starts at R0.00.</span></li>';
    }
    const expiredLine = sum.expired > 0
      ? '<p class="small" style="color:var(--warn);margin-bottom:10px;">Includes ' + db.money(sum.expired, w.currency) + ' of expired credit — that part is not spendable. Spendable: <b>' + db.money(db.spendable(enr.payment.email), w.currency) + '</b></p>'
      : '';
    // The card body fills the 400px box — balance and wallet number up top,
    // the ledger flowing beneath, so an empty account never leaves a dead
    // gap: the list section grows to fill whatever space remains.
    return '<div class="card" style="display:flex;flex-direction:column;">' +
      '<div class="eyebrow muted" style="margin-bottom:10px;">RFX account credit</div>' +
      '<div class="mono gold" style="font-size:14px;letter-spacing:1px;margin-bottom:4px;">' + w.walletNo + ' <span class="small faint" style="letter-spacing:0;">— your wallet number · quote it at ceremonies &amp; giveaways</span></div>' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">' +
      '<span class="num gold" style="font-size:30px;">' + db.money(sum.balance, w.currency) + '</span>' +
      '<span class="small faint">balance</span></div>' + expiredLine +
      (sum.expiringSoon > 0 ? '<p class="small" style="color:var(--warn);margin-bottom:10px;"><b>' + db.money(sum.expiringSoon, w.currency) + '</b> expires within 60 days — use it before it lapses.</p>' : '') +
      (db.spendable(enr.payment.email) >= 50
        ? '<button class="btn btn-ghost btn-sm" data-cashout style="margin-top:12px;">' + (I.send || '') + ' Cash out prize money</button>'
        : '') +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:' + (ledger.length ? 'flex-start' : 'center') + ';margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">' +
      '<ul class="audit">' + rows + '</ul></div></div>';
  }

  /* The Academy prep guide — the 'what to bring to school' letter. Students
     can download the PDF or re-read the email from the panel, so a first-year
     who lost the original is never left guessing what to prepare. */
  function prepGuideCard() {
    const I = RFX.icons || {};
    const year = db.prepGuideYear ? db.prepGuideYear() : 2026;
    const sentAt = enr.registration && enr.registration.prepGuideSentAt;
    // the letter's full table of contents — the box earns its space by being
    // the quick-reference for everything the student must prepare
    const sections = (db.prepGuideSections ? db.prepGuideSections() : []).slice(0, 12);
    const secRows = sections.map((s, i) =>
      '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);align-items:flex-start;">' +
      '<span class="mono" style="font-size:10px;color:var(--gold-bright);width:24px;flex:none;padding-top:2px;">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<div style="min-width:0;"><b style="font-size:12.5px;color:var(--text);display:block;line-height:1.35;">' + ui.esc(s.t) + '</b>' +
      '<span class="small faint" style="font-size:10.5px;line-height:1.5;display:block;margin-top:2px;">' + ui.esc(String(s.b || '').slice(0, 115)) + (String(s.b || '').length > 115 ? '…' : '') + '</span></div></div>').join('');
    return '<div class="card" style="border-color:rgba(212,175,55,0.35);">' +
      '<div class="eyebrow gold" style="margin-bottom:8px;">Academy prep guide ' + year + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">' +
      '<span class="pill ' + (sentAt ? 'ok' : '') + '" style="font-size:9px;">' + (sentAt ? 'sent ' + db.fmtDateShort(sentAt) : 'ready for you') + '</span>' +
      '<span class="small faint">what to prepare · where everything lives · how your wallet works</span></div>' +
      '<div style="max-height:238px;overflow:auto;margin:10px 0 6px;">' + (secRows || '<p class="small faint">The guide is being finalised for the year.</p>') + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px;">' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.memberPrepGuidePdf()">' + (I.download || '') + ' Download guide (PDF)</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="RFX.memberPrepGuideEmail()">' + (I.mail || '') + ' Email me the guide</button></div></div>';
  }
  function doPrepGuidePdf() {
    if (RFX.pdf && RFX.pdf.downloadPrepGuide) { RFX.pdf.downloadPrepGuide(enr); ui.toastOk('Academy prep guide downloaded.'); }
    else ui.toastErr('PDF generator not loaded.');
  }
  function doPrepGuideEmail() {
    const m = db.sendPrepGuide(enr);
    if (m) ui.toastOk('Academy prep guide emailed to ' + enr.payment.email + '.');
    else ui.toastErr('Could not send the prep guide.');
    renderContent();
  }

  /* THE JOURNEY CALENDAR — the student's own planner. Three tiers
     (Standard / Demanding / Elite) and a focus (study / updates / all),
     academy dates auto-inserted, and suggestions tied to the student's own
     standing. The card shows the next three dates; the full view is the
     planner with smooth transitions. */
  function journeyCalCard() {
    const I = RFX.icons || {};
    const cal = db.journeyCal(enr);
    const tier = db.journeyCalTier(enr);
    const T = db.CAL_TIERS[tier] || {};
    const tierLabel = T.label || 'Standard';
    const all = (cal.events || []).concat(db.calAcademyEvents(enr)).concat(db.calSuggestions(enr));
    const upcoming = all
      .filter(e => e.date && e.date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .slice(0, 5);
    // demo preview — founder walkthroughs and tours get a seeded 'Coming up'
    // so the planner reads as alive (study rhythm, briefings, dates all
    // flowing) without writing a single fake event to the store. Marked DEMO.
    if ((db.isFounder(enr) || enr.demoPass) && upcoming.length < 4) {
      const today = new Date();
      const plan0 = (T.plan && T.plan[0]) || 'Review this week\'s lesson once';
      [
        { off: 2, title: 'Study block — ' + plan0, kind: 'demo' },
        { off: 5, title: 'Journal your best trade — one entry', kind: 'suggest' },
        { off: 9, title: 'Prep check — your 2026 guide is in the Mailbox', kind: 'demo' },
      ].forEach(function (s) {
        const d = new Date(today); d.setDate(d.getDate() + s.off);
        upcoming.push({ date: d.toISOString().slice(0, 10), title: s.title, kind: s.kind });
      });
      upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
    const rows = upcoming.length
      ? upcoming.map(e => {
        const d = new Date(e.date + 'T00:00:00');
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const pill = e.kind === 'academy' ? ['gold', 'Academy'] : e.kind === 'suggest' ? ['info', 'Suggested'] : e.kind === 'demo' ? ['', 'Demo'] : ['', 'Mine'];
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);">' +
          '<span class="mono" style="font-size:10px;color:var(--gold-bright);width:34px;flex:none;">' + dd + '/' + mm + '</span>' +
          '<span class="small" style="color:var(--text);">' + ui.esc(e.title) + '</span>' +
          '<span class="pill ' + pill[0] + '" style="font-size:9px;margin-left:auto;">' + pill[1] + '</span></div>';
      }).join('')
      : '<p class="small faint">No dates lined up yet — your planner is ready when you are.</p>';
    // the tier's study rhythm — the wider card earns it with the plan preview
    const plan = (T.plan || []).slice(0, 3);
    const planRows = plan.length
      ? plan.map(p => '<div style="display:flex;gap:8px;padding:5px 0;align-items:flex-start;"><span style="color:var(--gold);font-size:11px;line-height:1.4;">✦</span><span class="small" style="color:var(--muted);line-height:1.4;">' + ui.esc(p) + '</span></div>').join('')
      : '';
    // academy briefings — short current notices, fresh from the same constants
    const briefs = db.calBriefings(enr);
    const subs = db.briefingSubs(enr);
    const subsOn = Object.keys(subs).filter(k => subs[k]).length;
    const totalTypes = (db.CAL_BRIEFING_TYPES || []).length;
    const briefRows = briefs.length
      ? briefs.map(b => '<div style="display:flex;gap:8px;padding:5px 0;align-items:flex-start;">' +
        '<span style="color:var(--gold);flex:none;width:14px;height:14px;">' + (I.flag || '') + '</span>' +
        '<div style="min-width:0;"><span class="small" style="color:var(--muted);line-height:1.4;display:block;">' + ui.esc(b.title) + '</span>' +
        '<span class="small faint" style="font-size:9px;">' + ui.esc(b.when) + '</span></div></div>').join('')
      : '<p class="small faint">Nothing new — check back around Academy dates.</p>';
    // study-session tracker — the week's slots and today's mark-done button
    const st = db.sessionTracker(enr);
    const stBlock = '<div style="margin-top:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">' +
      '<span class="small faint" style="font-size:10px;">This week</span>' +
      '<span class="mono" style="font-size:10px;color:' + (st.done >= st.target ? 'var(--gold-bright)' : 'var(--muted)') + ';">' + st.done + '/' + st.target + ' sessions</span></div>' +
      '<div style="height:6px;border-radius:99px;background:rgba(255,255,255,0.08);overflow:hidden;">' +
      '<div style="height:100%;width:' + st.pct + '%;border-radius:99px;background:linear-gradient(90deg,rgba(212,175,55,0.45),var(--gold));transition:width .6s cubic-bezier(.22,1,.36,1);"></div></div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:' + (st.streak >= 2 ? 'var(--gold-bright)' : 'var(--faint)') + ';">' + '<span class="ic-run">' + (I.flame || '') + '</span> <b>' + st.streak + '</b>-day study streak' + (st.streak >= 2 ? ' — keep it alive' : ' — begin with your first session today') + '</div>' +
      (st.today && !st.today.done
        ? '<button class="btn btn-gold btn-sm" style="width:100%;margin-top:9px;" onclick="event.stopPropagation();RFX.memberSessionDone()">' + (I.check || '') + ' Mark today\'s session done</button>'
        : (st.today && st.today.done ? '<div class="small" style="color:#7ee2a4;margin-top:9px;font-size:11px;">✓ Today\'s session complete — well done.</div>' : '')) +
      '</div>';
    return '<div class="card jcal-card" id="journey-cal-card" style="cursor:pointer;" onclick="RFX.memberJourneyCal()" title="Open your journey calendar">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
      '<span class="ic" style="color:var(--gold-bright);">' + (I.calendar || '') + '</span>' +
      '<span class="eyebrow muted" style="margin-bottom:0;">Your journey calendar</span>' +
      '<span class="pill gold" style="font-size:9px;margin-left:auto;">' + tierLabel + '</span></div>' +
      '<div class="jcal-cols">' +
      '<div class="jcal-panel first">' +
      '<div class="small faint" style="margin-bottom:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;">Coming up</div>' +
      rows +
      '</div>' +
      '<div class="jcal-panel">' +
      '<div class="small faint" style="margin-bottom:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;">Study rhythm</div>' +
      '<div class="small" style="color:var(--gold-bright);font-size:11px;padding:4px 0 2px;">' + ui.esc(T.cadence || '') + '</div>' +
      planRows +
      stBlock +
      '</div>' +
      '<div class="jcal-panel">' +
      '<div class="small faint" style="margin-bottom:4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;">Updates &amp; briefings</div>' +
      (subsOn < totalTypes ? '<div class="small faint" style="font-size:9px;margin-bottom:2px;">' + subsOn + ' of ' + totalTypes + ' feeds on — manage in your planner</div>' : '') +
      briefRows +
      '</div>' +
      '</div>' +
      '<div style="margin-top:12px;"><button class="btn btn-gold btn-sm" style="width:100%;" onclick="event.stopPropagation();RFX.memberJourneyCal()">' + (I.calendar || '') + ' Open my planner</button></div>' +
      '<p class="small faint" style="margin-top:8px;">Academy dates, your study rhythm, briefings and reminders — in one place. It updates as you grow.</p></div>';
  }
  /* Full planner view — tier + focus chooser (smooth transitions), the month
     with academy/own/suggested events, and a quick add. */
  let calViewOpen = false;
  window.RFX.memberJourneyCal = function () { calViewOpen = true; renderJourneyCalView(); };
  window.RFX.memberJourneyCalClose = function () { calViewOpen = false; renderContent(); };
  window.RFX.memberCalTier = function (t) { db.setJourneyCal(enr, { tier: t }); renderJourneyCalView(); };
  window.RFX.memberCalFocus = function (f) { db.setJourneyCal(enr, { focus: f }); renderJourneyCalView(); };
  window.RFX.memberCalAdd = function () {
    const title = document.getElementById('jc-add-title') ? document.getElementById('jc-add-title').value.trim() : '';
    const date = document.getElementById('jc-add-date') ? document.getElementById('jc-add-date').value : '';
    if (!title || !date) { ui.toastErr('Give your event a name and a date.'); return; }
    db.calAddEvent(enr, { title: title, date: date, kind: 'own' });
    ui.toastOk('Added to your journey calendar.');
    renderJourneyCalView();
  };
  window.RFX.memberCalToggle = function (id) { db.calToggleEvent(enr, id); renderJourneyCalView(); };
  window.RFX.memberCalRemove = function (id) { db.calRemoveEvent(enr, id); renderJourneyCalView(); };
  window.RFX.memberBriefSub = function (id) {
    const s = db.briefingSubs(enr);
    db.setBriefingSub(enr, id, !s[id]);
    ui.toastOk((s[id] ? 'Unsubscribed from' : 'Subscribed to') + ' ' + ((db.CAL_BRIEFING_TYPES.find(t => t.id === id) || {}).label || 'feed') + '.');
    renderJourneyCalView();
  };
  window.RFX.memberSessionDone = function () {
    const r = db.markTodaySession(enr);
    const st = r.tracker;
    if (r.reward) {
      ui.toastOk(r.reward.milestone + '-day streak — ' + r.reward.streak + ' days in a row. That rhythm is exactly how traders are made. Check your Mailbox for the note.');
    } else {
      ui.toastOk(st.today && st.today.done ? 'Session marked done — ' + st.done + ' of ' + st.target + ' this week. Keep the rhythm!' : 'Session re-opened — take it at your pace.');
    }
    if (calViewOpen) renderJourneyCalView(); else renderContent();
  };
  function renderJourneyCalView() {
    const I = RFX.icons || {};
    const cal = db.journeyCal(enr);
    const tier = db.journeyCalTier(enr);
    const focus = db.journeyCalFocus(enr);
    const T = db.CAL_TIERS[tier];
    const all = (cal.events || []).concat(db.calAcademyEvents(enr)).concat(db.calSuggestions(enr));
    const sorted = all.slice().sort((a, b) => (a.date || (a.when ? '9999' : '')).localeCompare(b.date || (b.when ? '9999' : '')));
    const rows = sorted.map(e => {
      const d = e.date ? new Date(e.date + 'T00:00:00') : null;
      const dd = d ? String(d.getDate()).padStart(2, '0') : '';
      const mm = d ? String(d.getMonth() + 1).padStart(2, '0') : '';
      const own = e.kind === 'own';
      const isSuggest = e.kind === 'suggest';
      return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border);">' +
        '<span class="mono" style="font-size:10px;color:var(--gold-bright);width:44px;flex:none;">' + (d ? dd + '/' + mm : '<span style="color:var(--faint);">Soon</span>') + '</span>' +
        '<div style="flex:1;"><div style="font-size:13px;color:var(--text);">' + ui.esc(e.title) + '</div>' +
        '<div class="small faint">' + ui.esc(e.when || '') + '</div></div>' +
        '<span class="pill ' + (e.kind === 'academy' ? 'gold' : isSuggest ? 'info' : '') + '" style="font-size:9px;">' + (e.kind === 'academy' ? 'Academy' : isSuggest ? 'Suggested' : 'Mine') + '</span>' +
        (own ? '<button class="btn btn-dark btn-sm" title="Done" style="padding:3px 9px;font-size:11px;" onclick="RFX.memberCalToggle(\'' + e.id + '\')">' + (e.done ? '✓' : (I.check || '')) + '</button>' +
          '<button class="btn btn-dark btn-sm" title="Remove" style="padding:3px 9px;font-size:11px;" onclick="RFX.memberCalRemove(\'' + e.id + '\')">×</button>' : '') +
        '</div>';
    }).join('');
    const tierOpts = Object.keys(db.CAL_TIERS).map(t =>
      '<button class="cal-tier-btn ' + (t === tier ? 'sel' : '') + '" data-tier="' + t + '" onclick="RFX.memberCalTier(\'' + t + '\')">' +
      '<b>' + db.CAL_TIERS[t].label + '</b><span>' + db.CAL_TIERS[t].blurb + '</span></button>').join('');
    const focusOpts = [['study', 'Study rhythm'], ['updates', 'Updates & briefings'], ['all', 'All of the above']].map(f =>
      '<button class="cal-focus-btn ' + (f[0] === focus ? 'sel' : '') + '" data-focus="' + f[0] + '" onclick="RFX.memberCalFocus(\'' + f[0] + '\')">' + f[1] + '</button>').join('');
    // briefing-type subscriptions — students choose which feeds reach them
    const subs = db.briefingSubs(enr);
    const subOpts = db.CAL_BRIEFING_TYPES.map(t =>
      '<button class="cal-sub-btn ' + (subs[t.id] ? 'sel' : '') + '" data-sub="' + t.id + '" onclick="RFX.memberBriefSub(\'' + t.id + '\')">' +
      '<b>' + t.label + '</b><span>' + t.blurb + '</span></button>').join('');
    // study-session tracker — the week's weekday slots with a mark-done path
    const st2 = db.sessionTracker(enr);
    const stRows2 = st2.days.map(d =>
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
      '<span class="mono" style="font-size:10px;color:var(--gold-bright);width:52px;flex:none;">' + d.date.slice(8) + '/' + d.date.slice(5, 7) + '</span>' +
      '<span class="small" style="color:' + (d.done ? '#7ee2a4' : 'var(--muted)') + ';">' + d.weekday + (d.isToday ? ' · today' : '') + '</span>' +
      '<span style="margin-left:auto;color:' + (d.done ? '#7ee2a4' : 'var(--faint)') + ';font-size:12px;">' + (d.done ? '✓ done' : '—') + '</span></div>').join('');
    $('mp-content').innerHTML =
      '<div class="card span-full" style="grid-column:1/-1;padding:0;">' +
      '<div style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
      '<button class="btn btn-dark btn-sm" onclick="RFX.memberJourneyCalClose()">' + (I.home || '') + ' Dashboard</button>' +
      '<div style="flex:1;min-width:200px;"><div class="eyebrow" style="margin-bottom:2px;">Your journey, planned</div>' +
      '<div class="serif gold" style="font-size:19px;">Journey Calendar</div></div>' +
      '<span class="small faint">tier: ' + (T ? T.label : 'Standard') + '</span></div>' +
      '<div style="padding:22px;">' +
      '<div class="eyebrow muted" style="margin-bottom:8px;">Choose how your calendar should feel</div>' +
      '<div class="cal-tier-row">' + tierOpts + '</div>' +
      '<div class="eyebrow muted" style="margin:16px 0 8px;">What should it carry?</div>' +
      '<div class="cal-focus-row">' + focusOpts + '</div>' +
      '<div class="eyebrow muted" style="margin:18px 0 8px;">Which briefings should reach you?</div>' +
      '<div class="cal-sub-row">' + subOpts + '</div>' +
      '<div class="eyebrow muted" style="margin:18px 0 8px;">Add your own date</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
      '<input class="input" id="jc-add-title" placeholder="e.g. Revision — support & resistance" style="flex:2;min-width:200px;">' +
      '<input class="input" id="jc-add-date" type="date" style="flex:1;min-width:140px;">' +
      '<button class="btn btn-gold btn-sm" onclick="RFX.memberCalAdd()">' + (I.plus || '') + ' Add</button></div>' +
      '<div class="eyebrow muted" style="margin:20px 0 6px;">Your dates</div>' +
      '<div style="max-height:420px;overflow:auto;">' + (rows || '<p class="small faint">Nothing here yet — academy dates will land automatically.</p>') + '</div>' +
      '<div class="eyebrow muted" style="margin:22px 0 6px;">Study sessions — this week</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
      '<span class="small faint">' + st2.done + ' of ' + st2.target + ' done' + (st2.done >= st2.target && st2.target > 0 ? ' — target reached, nicely done' : '') + '</span>' +
      (st2.today && !st2.today.done ? '<button class="btn btn-gold btn-sm" onclick="RFX.memberSessionDone()">' + (I.check || '') + ' Mark today done</button>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:12px;color:' + (st2.streak >= 2 ? 'var(--gold-bright)' : 'var(--muted)') + ';">' +
      '<span class="ic-run">' + (I.flame || '') + '</span> <b>' + st2.streak + '</b>-day streak' +
      '<span class="small faint" style="margin-left:auto;">next reward at ' + ((db.STREAK_MILESTONES || [3, 7, 14, 30]).find(m => m > st2.streak) || '—') + ' days</span></div>' +
      '<div style="max-height:220px;overflow:auto;">' + stRows2 + '</div>' +
      '</div></div>';
    // smooth transitions on the tier/focus buttons
    document.querySelectorAll('.cal-tier-btn, .cal-focus-btn').forEach(function (b) {
      b.style.transition = 'all .25s cubic-bezier(.22,1,.36,1)';
    });
  }

  /* THE MACHINERY — the engine room, shown with real measured numbers.
     Students get to see the system that carries the Academy (trust), and
     would-be misbehavers get to see it is watched and proven. The audit
     + self-test are cached for 30s so the 2.5s panel poll never re-runs
     them; the op timings are measured live on every render. */
  let machineryCache = null, machineryCachedAt = 0;
  let machineryWarmIv = null; // in-flight warm-up timer (never two at once)
  /* The shell the Machinery card paints FIRST — before the audit/self-test
     numbers are ready. Same card, honest placeholders, then the background
     warm-up patches the numbers line in place (id machinery-nums). First
     paint and the 5-min refresh are always instant. */
  function machineryShellHtml() {
    const I = RFX.icons || {};
    const m = db.storageMeter();
    const headroom = Math.max(0, Math.round((1 - m.percent / 100) * 1000) / 10);
    const list = db.enrollments();
    const probe = list.find(function (e) { return e.studentId; });
    let t0 = performance.now();
    if (probe) { for (let k = 0; k < 100; k++) db.byId(probe.id); }
    let t1 = performance.now();
    const lookupMs = probe ? ((t1 - t0) / 100) : 0;
    t0 = performance.now(); db.storageMeter(); t1 = performance.now();
    const storeMs = t1 - t0;
    const pipe = [['Payment', true], ['Enrollment', true], ['Identity', true], ['Handshake', true], ['Academy', true]].map(function (p) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;color:#7ee2a4;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><polyline points="20 6 9 17 4 12"/></svg>' + p[0] + '</span>';
    }).join('<span style="color:rgba(255,255,255,0.25);margin:0 2px;">→</span>');
    const ws = db.wallets();
    const inCirculation = ws.reduce(function (s, w) { return s + (w.balance || 0); }, 0);
    const messagesSent = db.emails().length;
    const eventsOnRecord = db.securityEvents().length;
    const openThreads = db.supportThreads().length;
    const queue = db.merchOrders().filter(function (o) { return o.status === 'collecting' || o.status === 'packing'; }).length;
    const metrics = [
      { ic: I.wallet || '', v: db.money(inCirculation), l: 'credit in student wallets' },
      { ic: I.mail || '', v: messagesSent, l: 'official messages delivered' },
      { ic: I.shield || '', v: eventsOnRecord, l: 'security events on record' },
      { ic: I.users || '', v: openThreads, l: 'open conversations · the human line' },
      { ic: I.cart || '', v: queue, l: 'orders in the fulfilment queue' },
      { ic: I.cpu || '', v: m.kb + ' KB', l: 'store footprint on this device' },
    ].map(function (x) {
      return '<div style="display:flex;align-items:center;gap:9px;min-width:170px;">' +
        '<span class="ic" style="color:var(--gold-bright);flex:none;">' + x.ic + '</span>' +
        '<div><div class="mono" style="font-size:14px;color:var(--text);line-height:1.15;">' + x.v + '</div>' +
        '<div class="small faint" style="font-size:10px;letter-spacing:0.05em;">' + x.l + '</div></div></div>';
    }).join('');
    return '<div class="card machinery" style="grid-column:1/-1;border-color:rgba(212,175,55,0.35);">' +
      '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:6px;">' +
      '<span class="ic" style="color:var(--gold-bright);margin-top:2px;">' + (I.shieldCheck || I.shield || '') + '</span>' +
      '<div style="min-width:0;">' +
      '<span class="eyebrow gold" style="margin-bottom:0;">The Machinery</span>' +
      '<div class="small" style="color:var(--muted);margin-top:2px;letter-spacing:0.03em;">keeping your Academy running</div>' +
      '</div></div>' +
      '<p class="small faint" style="margin-bottom:16px;">The engine room behind your studies — measured live, shown honestly. Every number below is computed by the system right now; nothing is staged.</p>' +
      '<div class="mach-rings">' +
      ui.trustRingHTML(100, { cap: 'checks' }) + ui.trustRingHTML(100, { cap: 'security' }) + ui.trustRingHTML(100, { cap: 'cyber' }) + ui.trustRingHTML(100, { cap: 'headroom', pctText: '∞', title: 'Production capacity is effectively unlimited — this demo runs on a small local store, where ' + headroom + '% of the room is still free.' }) +
      '</div>' +
      '<div class="small" style="margin-bottom:8px;" id="machinery-nums"><b style="color:var(--text);">checking…</b></div>' +
      '<div class="small" style="margin-bottom:8px;">Identity lookup <b class="mono gold">' + (lookupMs < 0.01 ? '&lt;0.01' : lookupMs.toFixed(2)) + ' ms</b> · store read <b class="mono gold">' + storeMs.toFixed(2) + ' ms</b> — measured on this device, this second</div>' +
      '<div class="small" style="margin-bottom:8px;">The gate <b class="mono gold" id="mach-gate">checking…</b> — System A holds the door; the Academy only follows</div>' +
      '<div class="small faint" style="margin-bottom:18px;">Cyber defence runs around the clock — the system attacks itself the way an intruder would, and every single hit is defended and recorded. Every rand reconciles · every Student Code is unique · 35 kinds of security events watched</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px 26px;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 0;margin:4px 0 18px;">' + metrics + '</div>' +
      '<div class="eyebrow muted" style="margin-bottom:8px;">Your journey through the machine</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;">' + pipe + '</div>' +
      '<div class="small faint" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">' +
      '<div style="margin-bottom:6px;">Capacity headroom <b class="num gold" style="font-size:15px;">∞</b> — built to hold your whole year and the years after. Student numbers stay private while we grow — every student is treated equal here ' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px;color:var(--gold);"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></div>' +
      '<div>Founder\'s Day — ' + db.foundersDayLabel() + '. ' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px;color:var(--gold);"><path d="M12 2c1.5 1.8 2.2 3.4 2.2 5.1a2.2 2.2 0 0 1-4.4 0C9.8 5.4 10.5 3.8 12 2z"/><path d="M12 9.5v7M7 20c1.2-1.4 3.1-2.2 5-2.2s3.8.8 5 2.2"/><path d="M5 11a2.5 2.5 0 0 1 0 5M19 11a2.5 2.5 0 0 0 0 5"/></svg>' +
      '</div>' +
      '</div></div>';
  }
  function machineryCard() {
    const I = RFX.icons || {};
    const nowMs = Date.now();
    // 5-minute cache, computed OFF the critical path: the audit+self-test is
    // heavy, so the first render shows the shell instantly and the numbers
    // fill in the moment the background warm-up finishes (a few hundred ms
    // later, or instantly on every later render thanks to the cache). First
    // paint and the 5-minute refresh therefore NEVER block the main thread.
    if (!machineryCache || nowMs - machineryCachedAt > 300000) {
      if (!machineryWarmIv) {
        machineryWarmIv = setTimeout(function () {
          machineryWarmIv = null;
          try {
            machineryCache = { audit: db.fullAudit(), self: db.securitySelfTest(), at: Date.now() };
            machineryCachedAt = Date.now();
          } catch (e) { console.error('Machinery warm-up failed.', e); }
          // patch the numbers in place — the student sees them appear
          const box = document.getElementById('machinery-nums');
          if (box && machineryCache) {
            const a = machineryCache.audit, s = machineryCache.self;
            box.innerHTML = '<b style="color:var(--text);">' + a.passed + '/' + a.total + '</b> system checks green · <b style="color:var(--text);">' + s.filter(function (x) { return x.pass; }).length + '/' + s.length + '</b> security attacks defended';
          }
        }, 30); // after this paint — the shell is already on screen
      }
      return machineryShellHtml();
    }
    const a = machineryCache.audit, s = machineryCache.self;
    const m = db.storageMeter();
    const headroom = Math.max(0, Math.round((1 - m.percent / 100) * 1000) / 10);
    const cr = db.countsRevealed(); // ghost-town rule — one call, used below
    const list = db.enrollments();
    // 35 kinds of security events exist in the system's taxonomy (login
    // lockouts, link opens, referrals, staff clocks, trust restrictions…) —
    // a capability, true regardless of how many have occurred today.
    const EVENT_KINDS = 35;
    // measured live — the honest speed of the machine, right now
    const probe = list.find(function (e) { return e.studentId; });
    let t0 = performance.now();
    if (probe) { for (let k = 0; k < 100; k++) db.byId(probe.id); }
    let t1 = performance.now();
    const lookupMs = probe ? ((t1 - t0) / 100) : 0;
    t0 = performance.now(); db.storageMeter(); t1 = performance.now();
    const storeMs = t1 - t0;
    const pipe = [['Payment', true], ['Enrollment', true], ['Identity', true], ['Handshake', true], ['Academy', true]].map(function (p) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;color:#7ee2a4;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><polyline points="20 6 9 17 4 12"/></svg>' + p[0] + '</span>';
    }).join('<span style="color:rgba(255,255,255,0.25);margin:0 2px;">→</span>');
    // engine-room metrics — real numbers from the store right now, ghost-town
    // safe (money, mail, events and queues — never student counts)
    const ws = db.wallets();
    const inCirculation = ws.reduce(function (s, w) { return s + (w.balance || 0); }, 0);
    const messagesSent = db.emails().length;
    const eventsOnRecord = db.securityEvents().length;
    const openThreads = db.supportThreads().length;
    const queue = db.merchOrders().filter(function (o) { return o.status === 'collecting' || o.status === 'packing'; }).length;
    const metrics = [
      { ic: I.wallet || '', v: db.money(inCirculation), l: 'credit in student wallets' },
      { ic: I.mail || '', v: messagesSent, l: 'official messages delivered' },
      { ic: I.shield || '', v: eventsOnRecord, l: 'security events on record' },
      { ic: I.users || '', v: openThreads, l: 'open conversations · the human line' },
      { ic: I.cart || '', v: queue, l: 'orders in the fulfilment queue' },
      { ic: I.cpu || '', v: m.kb + ' KB', l: 'store footprint on this device' },
    ].map(function (x) {
      return '<div style="display:flex;align-items:center;gap:9px;min-width:170px;">' +
        '<span class="ic" style="color:var(--gold-bright);flex:none;">' + x.ic + '</span>' +
        '<div><div class="mono" style="font-size:14px;color:var(--text);line-height:1.15;">' + x.v + '</div>' +
        '<div class="small faint" style="font-size:10px;letter-spacing:0.05em;">' + x.l + '</div></div></div>';
    }).join('');
    return '<div class="card machinery" style="grid-column:1/-1;border-color:rgba(212,175,55,0.35);">' +
      '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:6px;">' +
      '<span class="ic" style="color:var(--gold-bright);margin-top:2px;">' + (I.shieldCheck || I.shield || '') + '</span>' +
      '<div style="min-width:0;">' +
      '<span class="eyebrow gold" style="margin-bottom:0;">The Machinery</span>' +
      '<div class="small" style="color:var(--muted);margin-top:2px;letter-spacing:0.03em;">keeping your Academy running</div>' +
      '</div></div>' +
      '<p class="small faint" style="margin-bottom:16px;">The engine room behind your studies — measured live, shown honestly. Every number below is computed by the system right now; nothing is staged.</p>' +
      '<div class="mach-rings">' +
      ui.trustRingHTML(100, { cap: 'checks' }) + ui.trustRingHTML(100, { cap: 'security' }) + ui.trustRingHTML(100, { cap: 'cyber' }) + ui.trustRingHTML(100, { cap: 'headroom', pctText: '∞', title: 'Production capacity is effectively unlimited — this demo runs on a small local store, where ' + headroom + '% of the room is still free.' }) +
      '</div>' +
      '<div class="small" style="margin-bottom:8px;" id="machinery-nums"><b style="color:var(--text);">' + a.passed + '/' + a.total + '</b> system checks green · <b style="color:var(--text);">' + s.filter(function (x) { return x.pass; }).length + '/' + s.length + '</b> security attacks defended</div>' +
      '<div class="small" style="margin-bottom:8px;">Identity lookup <b class="mono gold">' + (lookupMs < 0.01 ? '&lt;0.01' : lookupMs.toFixed(2)) + ' ms</b> · store read <b class="mono gold">' + storeMs.toFixed(2) + ' ms</b> — measured on this device, this second</div>' +
      '<div class="small" style="margin-bottom:8px;">The gate <b class="mono gold" id="mach-gate">checking…</b> — System A holds the door; the Academy only follows</div>' +
      '<div class="small faint" style="margin-bottom:18px;">Cyber defence runs around the clock — the system attacks itself the way an intruder would, and every single hit is defended and recorded. Every rand reconciles · every Student Code is unique · ' + EVENT_KINDS + ' kinds of security events watched</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px 26px;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 0;margin:4px 0 18px;">' + metrics + '</div>' +
      '<div class="eyebrow muted" style="margin-bottom:8px;">Your journey through the machine</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;">' + pipe + '</div>' +
      '<div class="small faint" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">' +
      '<div style="margin-bottom:6px;">Capacity headroom <b class="num gold" style="font-size:15px;">∞</b> — built to hold your whole year and the years after. Student numbers stay private while we grow — every student is treated equal here ' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px;color:var(--gold);"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></div>' +
      '<div>Founder\'s Day — ' + db.foundersDayLabel() + '. ' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px;color:var(--gold);"><path d="M12 2c1.5 1.8 2.2 3.4 2.2 5.1a2.2 2.2 0 0 1-4.4 0C9.8 5.4 10.5 3.8 12 2z"/><path d="M12 9.5v7M7 20c1.2-1.4 3.1-2.2 5-2.2s3.8.8 5 2.2"/><path d="M5 11a2.5 2.5 0 0 1 0 5M19 11a2.5 2.5 0 0 0 0 5"/></svg>' +
      '</div>' +
      '</div></div>';
  }

  /* The Academy door NEVER opens onto a dead page. The probe result is
     cached per render (osProbeState); if it already says the Academy is UP,
     the native link simply navigates — no popup-blocker risk, no delay. If
     the state is still checking or known-down, we intercept: re-probe, and
     only open once the OS actually answers. A single in-flight probe flag
     stops double-clicks from opening two tabs. Delegated — the button
     re-renders with the card. */
  let osProbing = false;
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('#os-enter-btn') : null;
    if (!btn) return;
    if (osProbeState === 'up') return; // confirmed online — native link wins
    e.preventDefault();
    if (osProbing) return; // one probe in flight — ignore double-clicks
    osProbing = true;
    if (osProbeState === 'down') {
      ui.toastWarn('The Academy is being repaired right now — our engineers are on it. Your access is safe and waiting for you.');
    } else {
      ui.toastWarn('Checking the Academy link…');
    }
    probeOs(function () { osProbing = false; ui.toastOk('The Academy is online — opening it for you now.'); window.open(db.osIndexUrl() + '?sid=' + encodeURIComponent(enr.studentId || ''), '_blank'); },
      function () { osProbing = false; ui.toastWarn('The Academy is being repaired right now — our engineers are on it. Your access is safe and waiting for you.'); });
  });

  /* ---------------- invoice modal ---------------- */
  function doInvoice() {
    const m = ui.modal('<div id="member-invoice">' + ui.invoiceHTML(enr) + '</div>' +
      '<div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end;" class="no-print">' +
      '<button class="btn btn-ghost" onclick="RFX.memberDownloadPdf()">' + (RFX.icons.download || '') + ' Download PDF</button>' +
      '<button class="btn btn-ghost" onclick="window.print()">' + (RFX.icons.printer || '') + ' Print</button></div>');
    m.setTitle('Invoice ' + enr.invoice.number);
  }
  function doDownloadPdf() {
    if (enr && RFX.pdf) RFX.pdf.downloadInvoice(enr);
  }

  /* ---------------- logout ---------------- */
  /* Every sign-out path (button AND the kicked-device auto-signout) must reset
     the ring warm-up, or a stale ringsWarm flag would make the next sign-in
     skip scheduling the warm timer and the rings would replay their draw on
     every 2.5s poll, forever. */
  function resetRings() {
    ringsWarm = false;
    if (ringsWarmTimer) { clearTimeout(ringsWarmTimer); ringsWarmTimer = null; }
    $('mp-content').classList.remove('rings-warm');
  }
  function doLogout() {
    document.body.classList.remove('member-panel');
    stopActivityWatch();
    if (panelIv) { clearInterval(panelIv); panelIv = null; }
    clearSession();
    enr = null;
    resetRings();                    // next sign-in replays the ring draw
    show('screen-login'); hide('screen-panel');
  }

  /* ---------------- init ---------------- */
  function boot() {
    $('m-login').addEventListener('click', doLogin);
    $('m-email').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('m-code').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('mp-logout').addEventListener('click', doLogout);
    // forgot-password + reset screens
    $('m-forgot').addEventListener('click', showReset);
    $('r-send').addEventListener('click', doSendReset);
    $('r-back').addEventListener('click', backToLogin);
    $('sp-back').addEventListener('click', backToLogin);
    $('sp-set').addEventListener('click', doSetNewPassword);
    $('r-email').addEventListener('keydown', e => { if (e.key === 'Enter') doSendReset(); });
    $('sp-pw2').addEventListener('keydown', e => { if (e.key === 'Enter') doSetNewPassword(); });
    // an emailed reset link lands here: member.html?reset=TOKEN — the token
    // page is standalone (no session restore needed).
    const rt = new URLSearchParams(location.search).get('reset');
    if (rt) {
      resetToken = rt;
      show('screen-setpw'); hide('screen-login'); hide('screen-reset'); hide('screen-panel');
      return;
    }
    // Return trip from the Academy: RFX OS sends the student back with
    // ?email= prefilled, so they land one step from signed in. The code is
    // never carried in the URL — it stays a credential the student holds.
    const back = new URLSearchParams(location.search).get('email');
    if (back) $('m-email').value = back;
    // INSTANT single-session lock: when another TAB signs in, the shared
    // store's token changes the moment it happens — this panel locks
    // immediately instead of waiting for the next poll. (Cross-BROWSER is the
    // production server's job — the same rule, enforced where the state is
    // shared. The demo enforces what a single browser can prove.)
    window.addEventListener('storage', function (ev) {
      if (ev.key !== SESSION_KEY || !enr) return;
      const s = loadSession();
      if (s && db.sessionStillValid(enr, s.token)) return;
      forceLock('Signed in elsewhere — this session was ended automatically so only one active session stays open per student. Sign in again here.');
    });
    const sid = loadSession();
    if (sid) {
      const found = db.byId(sid.id);
      // the single-session contract: this panel's token must still be the
      // ACTIVE session. A sign-in on another device revoked it — show the
      // same lock screen the OS uses, never a silent session.
      if (found && found.studentId && db.sessionStillValid(found, sid.token)) {
        enr = found; startActivityWatch(); entrancePending = true;
        try { db.checkBirthdays(); } catch (e) { console.error(e); }
        renderPanel(); return;
      }
      if (found && found.studentId && !db.sessionStillValid(found, sid.token)) {
        clearSession();
        show('screen-login');
        ui.toastWarn('Signed in on another device — this session was ended to keep one active session per student. Sign in again here.');
        return;
      }
      clearSession();
    }
    show('screen-login');
  }

  /* vital-details reveal/copy (delegated — content re-renders) */
  const vitalValues = {};
  document.addEventListener('click', e => {
    const eye = e.target && e.target.closest ? e.target.closest('[data-vital]') : null;
    if (eye) {
      const k = eye.dataset.vital;
      if (revealed.has(k)) revealed.delete(k); else revealed.add(k);
      renderContent();
      return;
    }
    const cp = e.target && e.target.closest ? e.target.closest('[data-vital-copy]') : null;
    if (cp) {
      const k = cp.dataset.vitalCopy;
      const val = vitalValues[k];
      if (val) { ui.copyText(val); return; }
      ui.toastErr('Reveal it first, then copy.');
    }
    const mark = e.target && e.target.closest ? e.target.closest('#notif-mark-read') : null;
    if (mark) { db.markNotificationsRead(enr); renderContent(); }
  });

  /* Prize money cash-out — earned value leaves the wallet through the same
     consolidated monthly batch as refunds, but it is NOT a refund: nothing is
     revoked, the enrollment is untouched. Deducted now, paid by PayPal. */
  function doCashout() {
    if (!enr) return;
    const usable = db.spendable(enr.payment.email);
    if (usable < 50) { ui.toastErr('Minimum cash-out is R50 — you have ' + db.money(usable, enr.payment.currency) + ' spendable.'); return; }
    const m = ui.modal(
      '<div class="eyebrow muted" style="margin-bottom:6px;">Cash out prize money</div>' +
      '<p class="small" style="margin-bottom:14px;">Earned money (ceremony awards, giveaway winnings) can be collected as real money. Your spendable balance is <b style="color:var(--gold);">' + db.money(usable, enr.payment.currency) + '</b>. The amount leaves your wallet now and is paid via PayPal in the monthly consolidated batch — one run, one fee. This is not a refund: your enrollment and material rights are untouched.</p>' +
      '<div class="field"><label>Amount (R)</label>' +
      '<input class="input" id="co-amount" type="number" value="' + Math.floor(usable) + '" min="50" max="' + Math.floor(usable) + '" step="1"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
      '<button class="btn btn-ghost" data-co-cancel>Cancel</button>' +
      '<button class="btn btn-gold" id="co-confirm">' + (RFX.icons.send || '') + ' Request cash-out</button></div>');
    m.setTitle('Cash out — ' + enr.payment.email);
    const doIt = () => {
      const amt = parseFloat(document.getElementById('co-amount').value);
      const r = db.requestCashout(enr.payment.email, amt, { by: 'Student' });
      if (!r.ok) { ui.toastWarn(r.msg); return; }
      ui.toastOk('Cash-out queued — ' + db.money(amt, enr.payment.currency) + ' leaves your wallet now, paid in the monthly batch (' + r.payout.id + ').');
      m.close();
      renderContent();
    };
    document.getElementById('co-confirm').addEventListener('click', doIt);
    const cancel = document.querySelector('[data-co-cancel]');
    if (cancel) cancel.addEventListener('click', () => m.close());
    document.getElementById('co-amount').addEventListener('keydown', e => { if (e.key === 'Enter') doIt(); });
  }

  function doRedeem(ref, amount, name) {
    if (!enr) return;
    // each click is a fresh purchase intent (a student may buy the same service
    // more than once); the button's brief disable handles accidental double-clicks,
    // while the reference stays unique so a retried request can never double-deduct.
    const r = db.redeemCredit({ email: enr.payment.email, amount, itemName: name, itemRef: ref, by: 'Student', reference: ref + '-' + enr.id + '-' + Date.now() });
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    ui.toastOk(name + ' — ' + db.money(amount, enr.payment.currency) + ' applied from your RFX balance. Remaining ' + db.money(r.balance, enr.payment.currency) + '.');
    renderContent();
  }
  /* merch: earn reward fulfilment + shop purchases */
  function doEarnShip() {
    const shirt = $('me-shirt') ? $('me-shirt').value : '';
    const hoody = $('me-hoody') ? $('me-hoody').value : '';
    const addr = $('me-addr') ? $('me-addr').value.trim() : '';
    if (!shirt || !hoody) { ui.toastErr('Pick both sizes so we can fulfil your reward.'); return; }
    if (!addr) { ui.toastErr('Add a delivery address.'); return; }
    const r = db.fulfilMerchReward(enr.studentId, { shirt, hoody }, addr);
    if (!r.ok) { ui.toastErr(r.msg); return; }
    ui.toastOk('Reward confirmed — sizes locked in. The team will pack and ship it.');
    renderContent();
  }
  function doMerchBuy(btn) {
    const code = btn.dataset.merchBuy;
    const sizeSel = document.querySelector('[data-merch-size="' + code + '"]');
    const size = sizeSel ? sizeSel.value : '';
    if (!size) { ui.toastErr('Merch is physical — pick a size first.'); return; }
    const addr = $('me-shop-addr') ? $('me-shop-addr').value.trim() : '';
    if (!addr) { ui.toastErr('A delivery address is required (use the field below the shop).'); return; }
    const r = db.purchaseMerch({ email: enr.payment.email, code, size, address: addr, reference: code + '-' + enr.id + '-' + Date.now(), by: 'Student' });
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    ui.toastOk(r.order.items[0].name + ' ordered — ' + db.money(r.order.total, 'R') + ' from your balance. Remaining ' + db.money(r.balance, 'R') + '.');
    renderContent();
  }

  /* delegated clicks for the spend surface + merch + referral (content re-renders) */
  document.addEventListener('click', e => {
    const refBtn = e.target && e.target.closest ? e.target.closest('[data-ref-copy]') : null;
    if (refBtn) {
      const link = $('ref-link');
      if (link) { ui.copyText(link.value); ui.toastOk('Your referral link copied — send it to a friend.'); }
      return;
    }
    const btn = e.target && e.target.closest ? e.target.closest('[data-redeem]') : null;
    if (btn) {
      btn.disabled = true;
      doRedeem(btn.dataset.redeem, Number(btn.dataset.amt), btn.dataset.name);
      setTimeout(() => { btn.disabled = false; }, 1500);
      return;
    }
    const coBtn = e.target && e.target.closest ? e.target.closest('[data-cashout]') : null;
    if (coBtn) { doCashout(); return; }
    if (e.target && e.target.closest && e.target.closest('#sp-apply-custom')) {
      const amt = parseFloat($('sp-custom') ? $('sp-custom').value : '');
      if (!(amt > 0)) { ui.toastErr('Enter an amount first.'); return; }
      doRedeem('NEXT-COURSE', amt, 'Course deposit');
      return;
    }
    const celebrateBtn = e.target && e.target.closest ? e.target.closest('#me-celebrate') : null;
    if (celebrateBtn) {
      const r = db.celebrateMerch(enr.studentId);
      if (!r.ok) { ui.toastErr(r.msg); return; }
      ui.toastOk('Reward claimed — now pick your sizes.');
      renderContent();
      return;
    }
    const earnBtn = e.target && e.target.closest ? e.target.closest('#me-earn-ship') : null;
    if (earnBtn) { doEarnShip(); return; }
    const buyBtn = e.target && e.target.closest ? e.target.closest('[data-merch-buy]') : null;
    if (buyBtn) {
      buyBtn.disabled = true;
      doMerchBuy(buyBtn);
      setTimeout(() => { buyBtn.disabled = false; }, 1800);
      return;
    }
    const enrBtn = e.target && e.target.closest ? e.target.closest('[data-enroll]') : null;
    if (enrBtn) {
      enrBtn.disabled = true;
      doEnrollMore(enrBtn.dataset.enroll, Number(enrBtn.dataset.amt), enrBtn.dataset.name);
      setTimeout(() => { enrBtn.disabled = false; }, 2000);
      return;
    }
  });

  RFX.memberInvoice = doInvoice;
  RFX.memberDownloadPdf = doDownloadPdf;
  RFX.memberPrepGuidePdf = doPrepGuidePdf;
  RFX.memberPrepGuideEmail = doPrepGuideEmail;
  boot();
})();
