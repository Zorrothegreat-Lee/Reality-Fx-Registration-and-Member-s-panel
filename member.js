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

  /* ---------------- session ---------------- */
  function saveSession(id) { try { localStorage.setItem(SESSION_KEY, id); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  /* ---------------- login ----------------
     Goes through db.memberLogin, which throttles repeated failures and
     locks the account for N minutes after too many wrong attempts. */
  function doLogin() {
    const email = $('m-email').value.trim();
    const code = $('m-code').value.trim();
    if (!email || !code) { ui.toastErr('Enter both your email and your Student Code.'); return; }
    const r = db.memberLogin(email, code);
    if (!r.ok) {
      if (r.locked) {
        ui.toastErr(r.msg);
        show('m-lockout');
        $('m-lockout').textContent = r.msg;
      } else {
        ui.toastErr(r.msg);
      }
      return;
    }
    enr = r.enr;
    saveSession(enr.id);
    hide('m-lockout');
    startActivityWatch();
    renderPanel();
    ui.toastOk('Welcome back, ' + enr.payment.customerName + '.');
  }

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
    ].join('|');
  }
  function renderPanel() {
    show('screen-panel'); hide('screen-login');
    $('mp-name').textContent = enr.payment.customerName;
    $('mp-state').innerHTML = ui.statePill(enr.state);
    const saved = stashForm();
    renderContent();
    restoreForm(saved);
    let sig = panelSignature(enr);
    if (panelIv) clearInterval(panelIv);
    panelIv = setInterval(() => {
      if (!enr) return;
      const cur = db.byId(enr.id) || enr;
      const next = panelSignature(cur);
      if (next !== sig) {
        sig = next;
        enr = cur;
        renderPanel();
      }
    }, 2500);
  }

  function renderContent() {
    const I = RFX.icons || {};
    $('mp-content').innerHTML =
      identityCard() + vitalsCard() + accessCard() + walletCard() + referralCard() + spendCard() + merchCard() + invoiceCard();
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
      '<span class="serif gold" style="font-size:26px;font-weight:600;">' + db.money(usable, w.currency) + '</span>' +
      '<span class="small faint">spendable now (expired credits excluded)</span></div>' +
      '<div style="margin-bottom:6px;">' + rows + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<input class="input" id="sp-custom" type="number" placeholder="Custom amount" style="flex:1;">' +
      '<button class="btn btn-ghost btn-sm" id="sp-apply-custom">Apply to next course</button></div>' +
      '<p class="small faint" style="margin-top:12px;">Every package carries a code that matches the website store — pick what you can afford and it applies instantly. Can’t afford a package yet? It shows exactly how much more you need.</p></div>';
  }

  function identityCard() {
    const I = RFX.icons || {};
    const p = enr.payment;
    return '<div class="card card-gold">' +
      '<div class="eyebrow" style="margin-bottom:8px;">Your identity</div>' +
      '<div class="id-chip">' + (enr.studentId || '—') + '</div>' +
      '<div class="small" style="letter-spacing:0.18em;text-transform:uppercase;color:var(--faint);">Student ID</div>' +
      '<dl class="kv" style="margin-top:14px;">' +
      '<dt>Course</dt><dd>' + ui.esc(p.course) + '</dd>' +
      '<dt>Paid</dt><dd>' + db.money(p.price, p.currency) + ' · <span class="pill ok" style="font-size:9px;">paid</span></dd>' +
      '<dt>Enrolled</dt><dd>' + db.fmtDateShort(enr.createdAt) + '</dd>' +
      (enr.registration && enr.registration.personal && enr.registration.personal.country ? '<dt>Country</dt><dd>' + ui.esc(enr.registration.personal.country) + '</dd>' : '') +
      '</dl></div>';
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

  function accessCard() {
    const I = RFX.icons || {};
    // The Academy entry point (derived once, in db.osIndexUrl). Passing ?sid=
    // lets the Academy greet the student by their identity.
    const osUrl = db.osIndexUrl() + '?sid=' + encodeURIComponent(enr.studentId || '');
    let body;
    if (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED') {
      body = '<div style="text-align:center;padding:6px 0 14px;">' +
        '<div class="big-check" style="width:58px;height:58px;margin:0 auto 14px;"><span class="hero-ic">' + (I.checkCircle || '') + '</span></div>' +
        '<p class="small" style="color:#7ee2a4;font-weight:600;margin-bottom:16px;">Your RFX OS access is ready.</p>' +
        '<a class="btn btn-gold" href="' + osUrl + '" target="_blank" style="width:100%;">' + (I.unlock || '') + ' Enter the Academy</a></div>';
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
    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:12px;">RFX OS access</div>' + body + '</div>';
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
      '<div><span class="serif gold" style="font-size:22px;font-weight:600;">' + db.money(st.paidAmount, 'R') + '</span><div class="small faint">paid to wallet</div></div>' +
      '<div><span class="serif" style="font-size:22px;font-weight:600;color:var(--text);">' + db.money(st.pendingAmount, 'R') + '</span><div class="small faint">pending vesting</div></div>' +
      '<div><span class="serif" style="font-size:22px;font-weight:600;color:var(--text);">' + st.active + '</span><div class="small faint">active referrals</div></div></div>' +
      '<div class="small faint" style="margin-bottom:4px;">Tier ladder — more students, higher split:</div>' + tierRows +
      '<div class="small" style="margin-top:10px;color:var(--muted);">Earnings arrive in your RFX wallet once the student you brought in is <b style="color:var(--text);">fully locked in</b> — they must survive the ' + ((db.getSettings().referral && db.getSettings().referral.vestingDays) || 30) + '-day refund window. If they refund, the commission is forfeited. That\'s how we keep the house always winning.</div>' +
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
    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:10px;">RFX account credit</div>' +
      '<div class="mono gold" style="font-size:14px;letter-spacing:1px;margin-bottom:4px;">' + w.walletNo + ' <span class="small faint" style="letter-spacing:0;">— your wallet number · quote it at ceremonies &amp; giveaways</span></div>' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">' +
      '<span class="serif gold" style="font-size:30px;font-weight:600;">' + db.money(sum.balance, w.currency) + '</span>' +
      '<span class="small faint">balance</span></div>' + expiredLine +
      (sum.expiringSoon > 0 ? '<p class="small" style="color:var(--warn);margin-bottom:10px;"><b>' + db.money(sum.expiringSoon, w.currency) + '</b> expires within 60 days — use it before it lapses.</p>' : '') +
      (db.spendable(enr.payment.email) >= 50
        ? '<button class="btn btn-ghost btn-sm" data-cashout style="margin-top:12px;">' + (I.send || '') + ' Cash out prize money</button>'
        : '') +
      '<ul class="audit" style="margin-top:10px;">' + rows + '</ul></div>';
  }

  function invoiceCard() {
    const I = RFX.icons || {};
    return '<div class="card"><div class="eyebrow muted" style="margin-bottom:10px;">Invoice</div>' +
      '<dl class="kv">' +
      '<dt>Number</dt><dd class="mono">' + enr.invoice.number + '</dd>' +
      '<dt>Issued</dt><dd>' + db.fmtDateShort(enr.invoice.issuedAt) + '</dd>' +
      '<dt>Status</dt><dd><span class="pill ok" style="font-size:9px;">paid</span></dd>' +
      '</dl>' +
      '<button class="btn btn-ghost btn-sm" style="margin-top:14px;width:100%;" onclick="RFX.memberInvoice()">' + (I.receipt || '') + ' View invoice</button></div>';
  }

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
  function doLogout() {
    stopActivityWatch();
    if (panelIv) { clearInterval(panelIv); panelIv = null; }
    clearSession();
    enr = null;
    show('screen-login'); hide('screen-panel');
  }

  /* ---------------- init ---------------- */
  function boot() {
    $('m-login').addEventListener('click', doLogin);
    $('m-email').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('m-code').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('mp-logout').addEventListener('click', doLogout);
    // Return trip from the Academy: RFX OS sends the student back with
    // ?email= prefilled, so they land one step from signed in. The code is
    // never carried in the URL — it stays a credential the student holds.
    const back = new URLSearchParams(location.search).get('email');
    if (back) $('m-email').value = back;
    const sid = loadSession();
    if (sid) {
      const found = db.byId(sid);
      if (found && found.studentId) { enr = found; startActivityWatch(); renderPanel(); return; }
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
    }
  });

  RFX.memberInvoice = doInvoice;
  RFX.memberDownloadPdf = doDownloadPdf;
  boot();
})();
