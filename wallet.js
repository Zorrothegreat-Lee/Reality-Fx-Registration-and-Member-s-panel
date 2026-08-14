/* Credit & Refunds (wallet.html) — staff resolution ledger */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  function kpis() {
    const ws = db.wallets();
    const totalCredit = ws.reduce((s, w) => s + w.balance, 0);
    const expiring = ws.reduce((s, w) => s + db.walletSummary(w.email).expiringSoon, 0);
    const queued = db.payouts().filter(p => p.status === 'queued');
    const paid = db.payouts().filter(p => p.status === 'paid');
    const I = RFX.icons || {};
    const cards = [
      { ic: I.card, num: db.money(totalCredit, 'R'), lab: 'Credit on RFX accounts' },
      { ic: I.clock, num: db.money(expiring, 'R'), lab: 'Expiring within 60 days' },
      { ic: I.user, num: ws.length, lab: 'RFX accounts' },
      { ic: I.inbox, num: queued.length, lab: 'Refunds & cash-outs queued' },
      { ic: I.send, num: db.money(queued.reduce((s, p) => s + p.amount, 0), 'R'), lab: 'Queued total' },
      { ic: I.checkCircle, num: db.money(paid.reduce((s, p) => s + p.amount, 0), 'R'), lab: 'Paid out (batched)' },
    ];
    document.getElementById('kpis').innerHTML = cards.map(c =>
      '<div class="card kpi"><div class="kpi-top"><span class="kpi-ic">' + c.ic + '</span></div>' +
      '<div class="kpi-num" style="font-size:24px;">' + c.num + '</div><div class="kpi-lab">' + c.lab + '</div></div>'
    ).join('');
  }

  function renderWallets() {
    const ws = db.wallets();
    const box = document.getElementById('wallet-list');
    if (!ws.length) {
      box.innerHTML = '<div class="empty-state"><div class="e-ic">' + (RFX.icons.card || '') + '</div><div class="e-t">No RFX accounts yet</div>' +
        '<p class="small">Every student starts at R0.00. A credit appears here when a resolution is executed.</p></div>';
      return;
    }
    box.innerHTML = ws.map(w =>
      '<div style="display:flex;align-items:center;gap:14px;padding:13px 2px;border-bottom:1px solid var(--border);flex-wrap:wrap;cursor:pointer;" data-email="' + ui.esc(w.email) + '">' +
      '<div style="flex:1;min-width:190px;"><b style="color:var(--text);">' + ui.esc(w.name || w.email) + '</b>' +
      '<div class="small faint">' + ui.esc(w.email) + '</div>' +
      '<div class="mono" style="font-size:11.5px;color:var(--gold-bright);margin-top:3px;">' + w.walletNo + '</div></div>' +
      '<div style="text-align:right;"><span class="serif gold" style="font-size:19px;font-weight:600;">' + db.money(w.balance, w.currency) + '</span>' +
      '<div class="small faint">balance</div></div>' +
      '<span class="btn btn-dark btn-sm">Ledger</span></div>'
    ).join('');
    box.querySelectorAll('[data-email]').forEach(el => el.addEventListener('click', () => openWallet(el.dataset.email)));
  }

  function openWallet(email) {
    const w = db.getWallet(email);
    const warnMs = 60 * 86400 * 1000;
    const nowMs = Date.now();
    const rows = w.ledger.slice().reverse().map(e => {
      let expiry = '';
      if (e.type === 'credit' && e.expiresAt) {
        const diff = new Date(e.expiresAt).getTime() - nowMs;
        expiry = diff <= 0
          ? ' <span class="pill danger" style="font-size:9px;">expired ' + db.fmtDateShort(e.expiresAt) + '</span>'
          : diff < warnMs
            ? ' <span class="pill warn" style="font-size:9px;">expires ' + db.fmtDateShort(e.expiresAt) + '</span>'
            : ' <span class="small faint">expires ' + db.fmtDateShort(e.expiresAt) + '</span>';
      }
      const kind = e.type === 'award'
        ? ' <span class="pill gold" style="font-size:9px;">award · never expires</span>'
        : e.type === 'credit' ? ' <span class="pill ok" style="font-size:9px;">credit</span>'
        : e.type === 'redeem' ? ' <span class="pill info" style="font-size:9px;">spent</span>' : '';
      const signed = e.amount < 0
        ? '<b style="color:#f0a89c;">-' + db.money(Math.abs(e.amount), w.currency) + '</b>'
        : '<b style="color:#7ee2a4;">+' + db.money(e.amount, w.currency) + '</b>';
      return '<li><span class="a-time">' + db.fmtDate(e.at) + '</span><span class="a-txt">' + signed + ' — ' + ui.esc(e.note || '') + ' <span class="small faint">(' + ui.esc(e.ref || '') + ')</span>' + kind + expiry + '</span></li>';
    }).join('');
    const m = ui.modal('<div class="eyebrow muted" style="margin-bottom:6px;">RFX account</div>' +
      '<h3 class="serif" style="font-size:20px;margin-bottom:2px;">' + ui.esc(w.name || w.email) + '</h3>' +
      '<div class="small faint" style="margin-bottom:6px;">' + ui.esc(w.email) + '</div>' +
      '<div class="mono gold" style="font-size:14px;letter-spacing:1px;margin-bottom:16px;">' + w.walletNo + ' <span class="small faint" style="letter-spacing:0;">— wallet number</span></div>' +
      '<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:18px;">' +
      '<span class="serif gold" style="font-size:30px;font-weight:600;">' + db.money(w.balance, w.currency) + '</span>' +
      '<span class="small faint">current balance · refund credits valid 24 months · awards never expire</span></div>' +
      '<div class="eyebrow muted" style="margin-bottom:6px;">Ledger</div><ul class="audit">' +
      (w.ledger.length ? rows : '<li><span class="a-time">—</span><span class="a-txt faint">No activity yet. Balance starts at R0.00.</span></li>') +
      '</ul>');
    m.setTitle('RFX account — ' + ui.esc(w.email));
  }

  /* ================= refund intelligence panel ================= */
  function renderRefundIntel() {
    const box = document.getElementById('refund-intel');
    const refunds = db.refundedIdentities();
    // refund intelligence is about refunds — a prize-money cash-out is not a
    // refund, it is the student's own earned money leaving the wallet
    const queued = db.payouts().filter(p => p.status === 'queued' && p.kind !== 'cashout');
    const flagged = queued.filter(p => p.riskFlagged);
    const I = RFX.icons || {};
    if (!refunds.length && !queued.length) {
      box.innerHTML = '<div class="empty-state" style="padding:18px;"><div class="e-t">No refund history yet</div>' +
        '<p class="small">Every refund request is scored against the identity\'s history — prior refunds, velocity, early requests, pre-registration refunds, payment links. Flags appear here for the moderator to review before the monthly batch is processed.</p></div>';
      return;
    }
    const rows = queued.slice().reverse().map(p => {
      const lvl = p.riskFlagged ? 'danger' : p.riskScore >= 30 ? 'warn' : 'ok';
      const sigs = (p.riskSignals || []).slice(0, 4).map(s => '<span class="small faint">· ' + ui.esc(s.label) + '</span>').join('<br>');
      return '<tr><td class="mono small">' + p.id + '</td>' +
        '<td>' + ui.esc(p.name) + '<div class="small faint">' + ui.esc(p.email) + '</div></td>' +
        '<td class="num">' + db.money(p.amount, p.currency) + '</td>' +
        '<td><span class="pill ' + lvl + '">' + p.riskScore + ' / 100' + (p.riskFlagged ? ' · review' : '') + '</span></td>' +
        '<td class="small" style="color:var(--muted);">' + sigs + '</td></tr>';
    }).join('');
    const history = refunds.slice(0, 10).map(r =>
      '<tr><td class="mono small">' + r.payoutId + '</td>' +
      '<td>' + ui.esc(r.name) + '<div class="small faint">' + ui.esc(r.email) + '</div></td>' +
      '<td class="num">' + db.money(r.amount, 'R') + '</td>' +
      '<td class="small faint">' + db.fmtDateShort(r.at) + '</td>' +
      '<td><span class="pill danger" style="font-size:9px;">refunded · rights revoked</span></td></tr>').join('');
    box.innerHTML =
      (flagged.length ? '<div class="small" style="margin-bottom:12px;padding:11px 14px;border:1px solid rgba(224,96,79,0.45);border-radius:10px;background:var(--danger-dim);color:#f0a89c;">' +
        (I.alert || '') + ' <b>' + flagged.length + ' flagged refund request' + (flagged.length === 1 ? '' : 's') + '</b> in the queue — review before processing the batch. An approved refund revokes all material rights and starts the 30-day identity cooldown.</div>' : '') +
      (queued.length ? '<div class="eyebrow muted" style="margin-bottom:6px;">In the queue (risk-scored)</div>' +
        '<table class="tbl"><thead><tr><th>Ref</th><th>Student</th><th>Amount</th><th>Risk</th><th>Signals</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
      '<div class="eyebrow muted" style="margin:' + (queued.length ? '18px' : '0') + ' 0 6px;">Refund history (rights revoked)</div>' +
      (history.length ? '<table class="tbl"><thead><tr><th>Ref</th><th>Identity</th><th>Amount</th><th>Paid</th><th></th></tr></thead><tbody>' + history + '</tbody></table>'
        : '<p class="small faint">No executed refunds yet — this list grows as batches are processed.</p>');
  }

  function renderPayouts() {
    const ps = db.payouts();
    const box = document.getElementById('payout-list');
    if (!ps.length) {
      box.innerHTML = '<div class="empty-state"><div class="e-ic">' + (RFX.icons.inbox || '') + '</div><div class="e-t">No payouts queued</div>' +
        '<p class="small">When a student chooses a cash refund or requests a prize-money cash-out, it lands here and is paid via PayPal in the monthly consolidated batch.</p></div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr><th>Ref</th><th>Student</th><th>Amount</th><th>Kind</th><th>Rail</th><th>Status</th></tr></thead><tbody>' +
      ps.slice().reverse().map(p => {
        const kindPill = p.kind === 'cashout'
          ? '<span class="pill gold" style="font-size:9px;">cash-out · prize money</span>'
          : '<span class="pill warn" style="font-size:9px;">refund</span>';
        return '<tr><td class="mono small">' + p.id + '</td>' +
        '<td>' + ui.esc(p.name) + '<div class="small faint">' + ui.esc(p.email) + '</div></td>' +
        '<td class="num">' + db.money(p.amount, p.currency) + '</td>' +
        '<td>' + kindPill + (p.riskFlagged ? '<div class="small" style="color:#f0a89c;">flagged · risk ' + p.riskScore + '</div>' : '') + '</td>' +
        '<td><span class="pill info" style="font-size:9px;">' + ui.esc(p.rail || 'paypal') + '</span></td>' +
        '<td>' + (p.status === 'queued' ? '<span class="pill warn">queued</span>' : '<span class="pill ok">paid · ' + ui.esc(p.batchId) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderBatches() {
    const log = db.auditLog();
    const box = document.getElementById('batch-history');
    box.innerHTML = log.length
      ? '<table class="tbl"><thead><tr><th>Batch</th><th>Refunds</th><th>Total</th><th>When</th></tr></thead><tbody>' +
        log.map(b =>
          '<tr><td class="mono">' + b.batchId + '</td><td>' + b.count + '</td><td class="num gold">' + db.money(b.total, 'R') + '</td>' +
          '<td class="small faint">' + db.fmtDate(b.at) + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="empty-state" style="padding:20px;"><div class="e-t">No batches processed yet</div>' +
        '<p class="small">Process the monthly batch to consolidate all queued refunds into a single payout run.</p></div>';
  }

  /* ================= awards & giveaways ================= */
  let awardViaWallet = null; // { email, name, walletNo } when sending by wallet number
  function fillAwardStudents(keepSelection) {
    const sel = document.getElementById('aw-student');
    if (!sel) return;
    // don't clobber a selection the staff member is actively working with (the 3s refresh)
    if (keepSelection !== false && document.activeElement === sel) return;
    const current = sel.value;
    // recipients = students with an established identity (or active), with wallets auto-created on credit
    const pool = db.enrollments().filter(e => e.studentId || e.state === 'ACTIVE');
    sel.innerHTML = pool.length
      ? pool.map(e => '<option value="' + ui.esc(e.payment.email) + '">' + ui.esc(e.payment.customerName) +
        ' · ' + (e.studentId || '—') + ' · ' + db.money(e.payment.price, e.payment.currency) + '</option>').join('')
      : '<option value="">No students with an identity yet — approve someone first</option>';
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  }
  function doResolveWallet() {
    const v = db.validateWalletNumber(document.getElementById('aw-walletno').value);
    const hint = document.getElementById('aw-wallet-hint');
    if (!v.ok) {
      awardViaWallet = null;
      hint.innerHTML = '<span style="color:#f0a89c;">' + ui.esc(v.msg) + '</span>';
      return;
    }
    awardViaWallet = { email: v.wallet.email, name: v.wallet.name || v.wallet.email, walletNo: v.wallet.walletNo };
    hint.innerHTML = '<span style="color:#7ee2a4;">Resolved: <b>' + ui.esc(awardViaWallet.name) + '</b> · ' + awardViaWallet.walletNo + ' · balance ' + db.money(v.wallet.balance, v.wallet.currency) + '</span>';
    // keep the dropdown in sync with the resolved wallet
    const sel = document.getElementById('aw-student');
    if (![...sel.options].some(o => o.value === awardViaWallet.email)) {
      const opt = document.createElement('option');
      opt.value = awardViaWallet.email;
      opt.textContent = awardViaWallet.name + ' (via wallet number)';
      sel.appendChild(opt);
    }
    sel.value = awardViaWallet.email;
  }
  function doAward() {
    const wno = document.getElementById('aw-walletno').value.trim();
    let email = null;
    if (wno) {
      const v = db.validateWalletNumber(wno);
      if (!v.ok) { ui.toastErr(v.msg); return; }
      email = v.wallet.email;
    } else {
      email = document.getElementById('aw-student').value;
    }
    const amount = parseFloat(document.getElementById('aw-amount').value);
    const reference = document.getElementById('aw-ref').value.trim();
    const reason = document.getElementById('aw-reason').value.trim();
    if (!email) { ui.toastErr('Choose a recipient, or resolve a wallet number first.'); return; }
    if (!(amount > 0)) { ui.toastErr('Enter a valid amount.'); return; }
    if (!reference) { ui.toastErr('Every award needs a unique reference — that is what stops double payments.'); return; }
    if (!reason) { ui.toastErr('Add a reason — it is shown to the student and kept in the audit trail.'); return; }
    const r = db.issueAward({ recipients: [{ email, amount }], reason, reference, by: 'Staff', source: 'ceremony' });
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    const w = r.recipients[0];
    ui.toastOk('Awarded ' + db.money(amount, 'R') + ' → ' + w.name + ' (wallet ' + w.walletNo + '). Balance now ' + db.money(w.balance, 'R') + '. Email sent.');
    document.getElementById('aw-walletno').value = '';
    document.getElementById('aw-wallet-hint').textContent = "Type a student's wallet number and we'll verify it (check digit + lookup) before crediting.";
    awardViaWallet = null;
    renderAll();
  }
  function doGiveaway() {
    const btn = document.getElementById('btn-giveaway');
    const title = document.getElementById('gv-title').value.trim() || 'Live ceremony giveaway';
    const amount = parseFloat(document.getElementById('gv-amount').value);
    const count = parseInt(document.getElementById('gv-winners').value, 10) || 1;
    if (!(amount > 0)) { ui.toastErr('Enter a prize amount per winner.'); return; }
    if (!confirm('Run the draw for "' + title + '" — ' + count + ' winner(s) at ' + db.money(amount, 'R') + ' each, drawn at random from active students? This immediately credits the winners.')) return;
    const r = db.runGiveaway({ title, amountEach: amount, winnerCount: count, by: 'Staff' });
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    showGiveawayResult(r);
    renderAll();
    // ceremony-safe: briefly disable the button so a double-click can't run a second draw
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 3000);
  }
  function showGiveawayResult(r) {
    const rows = r.winners.map((w, i) =>
      '<li><span class="a-time">#' + (i + 1) + '</span><span class="a-txt"><b style="color:var(--text);">' + ui.esc(w.name || w.email) + '</b> — ' + ui.esc(w.email) + '<br><span class="mono gold">' + w.walletNo + '</span> · +' + db.money(w.amount, 'R') + ' → balance ' + db.money(w.balance, 'R') + '</span></li>').join('');
    const m = ui.modal('<div class="eyebrow" style="margin-bottom:8px;">Fair draw complete</div>' +
      '<h3 class="serif" style="font-size:22px;margin-bottom:4px;">' + ui.esc(r.title) + '</h3>' +
      '<p class="small" style="margin-bottom:16px;">' + r.reference + ' · drawn from a pool of ' + r.poolSize + ' active students · crypto-random · ' + db.money(r.total, 'R') + ' total credited.</p>' +
      '<ul class="audit">' + rows + '</ul>' +
      '<p class="small faint" style="margin-top:14px;">Every winner was emailed. The draw record (pool size, winners, time) is kept for the audit trail.</p>');
    m.setTitle('Giveaway winners');
  }
  function renderAwards() {
    const box = document.getElementById('award-history');
    // giveaways are already rendered as their own rows — don't double-print them
    const awards = db.awardsList().filter(a => a.source !== 'giveaway');
    const gvs = db.giveaways();
    if (!awards.length && !gvs.length) {
      box.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="e-t">No awards or giveaways yet</div>' +
        '<p class="small">Credit a ceremony award, or run the first giveaway draw — winners are credited instantly and emailed.</p></div>';
      return;
    }
    const awardRows = awards.map(a =>
      '<tr><td class="mono small">' + ui.esc(a.reference) + '</td>' +
      '<td>' + ui.esc(a.reason) + '<div class="small faint">' + (a.source === 'giveaway' ? 'giveaway' : 'ceremony') + ' · ' + db.fmtDateShort(a.at) + '</div></td>' +
      '<td>' + a.recipients.map(rr => ui.esc(rr.name || rr.email)).join('<br>') + '</td>' +
      '<td class="num gold">' + db.money(a.total, 'R') + '</td></tr>').join('');
    const gvRows = gvs.map(g =>
      '<tr><td class="mono small">' + g.id + '</td>' +
      '<td>' + ui.esc(g.title) + '<div class="small faint">draw from ' + g.poolSize + ' active · ' + g.winnerCount + ' winner' + (g.winnerCount === 1 ? '' : 's') + ' · ' + db.fmtDateShort(g.drawnAt) + '</div></td>' +
      '<td>' + g.winners.map(w => ui.esc(w.name || w.email)).join('<br>') + '</td>' +
      '<td class="num gold">' + db.money(g.total, 'R') + '</td></tr>').join('');
    box.innerHTML = '<table class="tbl"><thead><tr><th>Reference</th><th>What</th><th>Recipients</th><th>Total</th></tr></thead><tbody>' + awardRows + gvRows + '</tbody></table>';
  }

  /* ================= package catalog (spend rail) ================= */
  function renderCatalog() {
    const box = document.getElementById('catalog-list');
    const cat = db.getCatalog(); // sorted price descending
    if (!cat.length) {
      box.innerHTML = '<div class="empty-state" style="padding:18px;"><div class="e-t">No spend packages</div>' +
        '<p class="small">Add the first package — the code must match what Lee puts on the website store product.</p></div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr><th>Code</th><th>Package</th><th>Price</th><th></th></tr></thead><tbody>' +
      cat.map(it =>
        '<tr><td class="mono small gold">' + ui.esc(it.code) + '</td>' +
        '<td><b style="color:var(--text);">' + ui.esc(it.name) + '</b>' + (it.note ? '<div class="small faint">' + ui.esc(it.note) + '</div>' : '') + '</td>' +
        '<td class="num">' + db.money(it.price, it.currency || 'R') + '</td>' +
        '<td style="text-align:right;"><button class="btn btn-dark btn-sm" data-cat-del="' + ui.esc(it.code) + '">Remove</button></td></tr>'
      ).join('') + '</tbody></table>';
    box.querySelectorAll('[data-cat-del]').forEach(b => b.addEventListener('click', () => {
      const cat2 = db.getCatalog().filter(x => x.code !== b.dataset.catDel);
      const r = db.saveCatalog(cat2);
      if (!r.ok) ui.toastErr(r.msg); else ui.toastOk('Removed ' + b.dataset.catDel + '.');
      renderCatalog();
    }));
  }
  function doAddCatalog() {
    const code = document.getElementById('cat-code').value.trim();
    const name = document.getElementById('cat-name').value.trim();
    const price = parseFloat(document.getElementById('cat-price').value);
    const note = document.getElementById('cat-note').value.trim();
    if (!code) { ui.toastErr('A code is required.'); return; }
    if (!name) { ui.toastErr('A package name is required.'); return; }
    if (!(price > 0)) { ui.toastErr('A price is required.'); return; }
    const cat = db.getCatalog();
    const existing = cat.find(x => x.code.toUpperCase() === code.toUpperCase());
    if (existing) {
      const r = db.saveCatalog(cat.map(x => x.code.toUpperCase() === code.toUpperCase() ? { code: x.code, name, price, currency: 'R', note } : x));
      if (!r.ok) ui.toastErr(r.msg); else ui.toastOk('Updated ' + code + ' → ' + db.money(price, 'R'));
    } else {
      const r = db.saveCatalog(cat.concat([{ code, name, price, currency: 'R', note }]));
      if (!r.ok) ui.toastErr(r.msg); else ui.toastOk('Added ' + code + ' → ' + db.money(price, 'R') + '. Students can now spend on it.');
    }
    document.getElementById('cat-code').value = '';
    document.getElementById('cat-name').value = '';
    document.getElementById('cat-price').value = '';
    document.getElementById('cat-note').value = '';
    renderCatalog();
  }

  /* ================= merch fulfilment queue ================= */
  function fillMerchStudents(keepSelection) {
    const sel = document.getElementById('mh-student');
    if (!sel) return;
    if (keepSelection !== false && document.activeElement === sel) return;
    const current = sel.value;
    const pool = db.enrollments().filter(e => e.studentId && e.state === 'ACTIVE');
    sel.innerHTML = pool.length
      ? pool.map(e => '<option value="' + ui.esc(e.studentId) + '">' + ui.esc(e.payment.customerName) + ' · ' + e.studentId + '</option>').join('')
      : '<option value="">No active students — approve + handoff someone first</option>';
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  }
  function doClaimMerch() {
    const studentId = document.getElementById('mh-student').value;
    const average = parseFloat(document.getElementById('mh-avg').value);
    let reference = document.getElementById('mh-ref').value.trim();
    if (!studentId) { ui.toastErr('Pick an active student.'); return; }
    if (!(average >= 0 && average <= 100)) { ui.toastErr('Average must be between 0 and 100.'); return; }
    if (!reference) reference = 'ACH-' + studentId + '-' + Date.now();
    const r = db.claimAchievementMerch({ studentId, average, reference, by: 'RFX OS (simulated)' });
    if (!r.ok) { ui.toastWarn(r.msg); return; }
    ui.toastOk('Reward claimed for ' + r.order.name + ' — free tee + hoody queued (' + r.order.id + '). Idempotent: reference ' + reference + ' can never claim twice.');
    renderMerch();
  }
  function renderMerch() {
    const box = document.getElementById('merch-queue');
    const orders = db.merchOrders();
    if (!orders.length) {
      box.innerHTML = '<div class="empty-state" style="padding:18px;"><div class="e-t">No merch orders yet</div>' +
        '<p class="small">Earned rewards (from RFX OS achievement events) and purchases made with credit both land here, then flow collecting → packing → shipped → delivered.</p></div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr><th>Order</th><th>Student</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>' +
      orders.map(o => {
        const items = o.items.map(it => ui.esc(it.name) + (it.size ? ' <span class="small faint">(' + ui.esc(it.size) + ')</span>' : '')).join('<br>');
        const kind = o.kind === 'earned' ? '<span class="pill gold" style="font-size:9px;">earned</span>' : '<span class="pill info" style="font-size:9px;">paid · ' + db.money(o.total, 'R') + '</span>';
        const canAdvance = o.status !== 'delivered';
        return '<tr><td class="mono small">' + o.id + '<div class="small faint">' + db.fmtDateShort(o.at) + '</div></td>' +
          '<td>' + ui.esc(o.name) + '<div class="small faint">' + ui.esc(o.email) + (o.studentId ? ' · ' + o.studentId : '') + '</div></td>' +
          '<td class="small">' + items + kind + (o.address ? '<div class="small faint">→ ' + ui.esc(o.address) + '</div>' : '') + '</td>' +
          '<td><span class="pill ' + (o.status === 'delivered' ? 'ok' : o.status === 'shipped' ? 'info' : 'warn') + '">' + ui.esc(db.MERCH_STATUS_LABELS[o.status] || o.status) + '</span></td>' +
          '<td style="text-align:right;">' + (canAdvance
            ? '<button class="btn btn-dark btn-sm" data-merch-next="' + o.id + '">Next →</button>'
            : '<span class="small ok" style="color:#7ee2a4;">done</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-merch-next]').forEach(b => b.addEventListener('click', () => {
      const r = db.advanceMerch(b.dataset.merchNext);
      if (!r.ok) ui.toastErr(r.msg); else ui.toastOk(r.order.id + ' → ' + db.MERCH_STATUS_LABELS[r.order.status]);
      renderMerch();
    }));
  }

  function processBatch() {
    const queued = db.payouts().filter(p => p.status === 'queued');
    if (!queued.length) { ui.toastWarn('Nothing queued — no batch needed.'); return; }
    if (!confirm('Process ' + queued.length + ' queued refund(s) as one consolidated payout run?')) return;
    const r = db.processPayoutBatch();
    ui.toastOk('Batch ' + r.batchId + ' processed — ' + r.processed + ' refund(s), ' + db.money(r.total, 'R') + ' paid out in one run.');
    renderAll();
  }

  function badges() {
    const mc = document.getElementById('mail-count');
    if (mc) mc.textContent = db.unreadCount();
    const pc = document.getElementById('payout-count');
    if (pc) pc.textContent = db.payouts().filter(p => p.status === 'queued').length;
  }
  /* Referral marketing — attribution intel + the vest/pay engine. */
  function renderReferrals() {
    const box = document.getElementById('referral-intel');
    if (!box) return;
    const I = RFX.icons || {};
    const a = db.referralAnalytics();
    const cfg = db.referralConfig();
    const hasAny = a.totals.sent > 0;
    const rows = a.rows.map(r =>
      '<tr><td><b>' + ui.esc(r.name || r.referrerId) + '</b><div class="small faint">' + ui.esc(r.email) + '</div></td>' +
      '<td class="num">' + r.sent + '</td>' +
      '<td class="num">' + r.paid + '</td>' +
      '<td class="num">' + db.money(r.total, 'R') + '</td>' +
      '<td class="num">' + r.forfeited + '</td>' +
      '<td><span class="pill ' + (r.survivalRate >= 90 ? 'ok' : r.survivalRate >= 70 ? 'warn' : 'danger') + '">' + r.survivalRate + '%</span></td></tr>').join('');
    box.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
      '<button class="btn btn-gold" id="btn-vest">' + (I.checkCircle || '') + ' Vest due commissions</button>' +
      '<button class="btn btn-ghost" id="btn-pay-refs">' + (I.send || I.coins || '') + ' Pay vested into wallets</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">' +
      '<div><span class="serif gold" style="font-size:22px;font-weight:600;">' + a.totals.sent + '</span><div class="small faint">referrals attributed</div></div>' +
      '<div><span class="serif" style="font-size:22px;font-weight:600;color:var(--text);">' + a.totals.accrued + '</span><div class="small faint">accrued (vesting)</div></div>' +
      '<div><span class="serif" style="font-size:22px;font-weight:600;color:var(--text);">' + db.money(a.totals.paid, 'R') + '</span><div class="small faint">commission paid</div></div>' +
      '<div><span class="serif" style="font-size:22px;font-weight:600;color:#f0a89c;">' + a.totals.forfeited + '</span><div class="small faint">forfeited on refund</div></div>' +
      '</div>' +
      (hasAny
        ? '<table class="tbl"><thead><tr><th>Referrer</th><th>Sent</th><th>Paid</th><th>Earned</th><th>Forfeited</th><th>Survival</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<p class="small faint" style="margin-top:10px;">Survival rate = how many of each referrer\'s students stayed fully locked in. A referrer whose network refunds heavily is flagged here — the house never loses. Commissions vest after the ' + (cfg.vestingDays || 30) + '-day refund window and pay into the referrer\'s RFX wallet.</p>'
        : '<p class="small faint">No referrals yet. When a student shares their code and a friend enrolls with it, attribution is captured at enrollment and appears here — this is your marketing-budget intel.</p>');
  }
  function doVest() {
    const r = db.vestReferralCommissions();
    ui.toastOk(r.vested ? r.vested + ' commission' + (r.vested === 1 ? '' : 's') + ' vested (survived the refund window).' : 'Nothing to vest yet — commissions vest after the refund window.');
    renderAll();
  }
  function doPayRefs() {
    const r = db.payReferralCommissions();
    if (r.paid) ui.toastOk(r.paid + ' commission' + (r.paid === 1 ? '' : 's') + ' paid — ' + db.money(r.total, 'R') + ' added to referrer wallets.');
    else ui.toastWarn('No vested commissions to pay. Run "Vest due commissions" first.');
    renderAll();
  }

  /* ================= financial audit (end-of-day tax file) ================= */
  function downloadFile(f) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([f.content], { type: f.mime }));
    a.download = f.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function renderFinancial() {
    const box = document.getElementById('finance-summary');
    if (!box) return;
    const s = db.financialSummary();
    const C = s.currency;
    const item = (label, val, color) =>
      '<div><span class="serif" style="font-size:21px;font-weight:600;color:' + (color || 'var(--text)') + ';">' + val + '</span>' +
      '<div class="small faint">' + label + '</div></div>';
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;">' +
      item('Money received (course payments)', db.money(s.received, C), 'var(--gold-bright)') +
      item('Credit held (credit · awards · referral)', db.money(s.held, C)) +
      item('Staff wallets funded', db.money(s.staffFunded, C)) +
      item('Wallet spend (goods)', db.money(s.spent, C)) +
      item('Cash-outs requested (prize money)', db.money(s.cashoutsQueued, C), 'var(--warn)') +
      item('Refunds paid out', db.money(s.refunded, C), 'var(--danger)') +
      item('Refunds queued', db.money(s.queued, C), 'var(--warn)') +
      '</div><p class="small faint" style="margin-top:12px;">' + s.events + ' money events in the ledger, sourced live from the records — the CSV/JSON export contains every single one, and the email report is addressed to <b style="color:var(--muted);">' + ui.esc(db.getSettings().financeEmail || 'realityfx20@gmail.com') + '</b>.</p>';
  }
  function doFinEmail() {
    const r = db.emailFinancialReport('');
    if (r.ok) ui.toastOk('End-of-day financial audit log emailed to ' + r.to + ' (' + r.events + ' events) — preview it in the Mailbox.');
    renderAll();
  }

  /* ================= staff wallets ================= */
  function methodLabel(m) {
    return { paypal: 'PayPal', bank: 'Bank transfer', zapper: 'Zapper', cash: 'Cash' }[String(m || '').toLowerCase()] || 'PayPal';
  }
  function renderStaffWallets(keepSel) {
    const box = document.getElementById('staff-wallet-list');
    const sel = document.getElementById('sf-staff');
    if (!box || !sel) return;
    if (keepSel !== false && document.activeElement === sel) return;
    const staff = db.staff();
    const ws = db.staffWallets();
    const cur = sel.value;
    sel.innerHTML = staff.length
      ? staff.map(s => '<option value="' + ui.esc(s.id) + '">' + ui.esc(s.name) + ' · ' + s.id + '</option>').join('')
      : '<option value="">No staff yet — hire someone first</option>';
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    // keep the method/payday selects in sync with the chosen member
    const sched = db.staffPayoutSchedule();
    const chosen = staff.find(s => s.id === sel.value);
    if (chosen && chosen.payout) {
      const mSel = document.getElementById('sf-method');
      const pSel = document.getElementById('sf-payday');
      if (mSel && [...mSel.options].some(o => o.value === chosen.payout.method)) mSel.value = chosen.payout.method;
      if (pSel) pSel.value = chosen.payout.payday != null ? String(chosen.payout.payday) : '';
    }
    const hint = document.getElementById('sf-sched-hint');
    if (hint) {
      const row = sched.find(x => x.staffId === sel.value);
      hint.textContent = row ? 'Next scheduled pay: ' + db.fmtDateShort(row.nextPayAt) + (row.dueToday ? ' — due TODAY' : '') : (chosen ? 'No monthly schedule set for ' + chosen.name + '.' : '');
    }
    if (!staff.length) {
      box.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="e-ic">' + (RFX.icons.wallet || '') + '</div><div class="e-t">No staff wallets yet</div>' +
        '<p class="small">Hire a team member, then fund their wallet — it starts at R0.00 like every RFX account.</p></div>';
      return;
    }
    box.innerHTML = staff.map(s => {
      const w = ws.find(x => x.staffId === s.id) || { balance: 0, currency: 'R', walletNo: '—', ledger: [] };
      const row = sched.find(x => x.staffId === s.id);
      const pay = row
        ? '<span class="pill ' + (row.dueToday ? 'gold' : 'info') + '" style="font-size:9px;">' + methodLabel(row.method) + ' · payday ' + row.payday + ' · next ' + db.fmtDateShort(row.nextPayAt) + (row.dueToday ? ' · due today' : '') + '</span>'
        : '<span class="small faint">no monthly schedule</span>';
      return '<div style="display:flex;align-items:center;gap:14px;padding:12px 2px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:180px;"><b style="color:var(--text);">' + ui.esc(s.name) + '</b>' +
        '<div class="small faint">' + ui.esc(s.email) + ' · ' + s.id + '</div>' +
        '<div class="mono" style="font-size:11.5px;color:var(--gold-bright);margin-top:3px;">' + w.walletNo + '</div></div>' +
        '<div style="text-align:center;">' + pay + '</div>' +
        '<div style="text-align:right;"><span class="serif gold" style="font-size:18px;font-weight:600;">' + db.money(w.balance, w.currency) + '</span>' +
        '<div class="small faint">balance</div></div></div>';
    }).join('');
  }
  function renderStaffSchedule() {
    const box = document.getElementById('staff-schedule');
    if (!box) return;
    const sched = db.staffPayoutSchedule();
    if (!sched.length) {
      box.innerHTML = '<p class="small faint">No scheduled payments yet. Pick a monthly payday for a team member above — their next pay date will appear here.</p>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr><th>Team member</th><th>Method</th><th>Payday</th><th>Next scheduled</th></tr></thead><tbody>' +
      sched.map(r =>
        '<tr><td><b style="color:var(--text);">' + ui.esc(r.name) + '</b><div class="small faint">' + ui.esc(r.email) + '</div></td>' +
        '<td><span class="pill info" style="font-size:9px;">' + methodLabel(r.method) + '</span></td>' +
        '<td class="num">' + r.payday + 'th of month</td>' +
        '<td>' + (r.dueToday
          ? '<span class="pill gold">due today</span> · ' + db.fmtDateShort(r.nextPayAt)
          : '<span class="small" style="color:var(--muted);">' + db.fmtDateShort(r.nextPayAt) + '</span>') + '</td></tr>'
      ).join('') + '</tbody></table>';
  }
  function doFundStaff() {
    const staffId = document.getElementById('sf-staff').value;
    const amount = parseFloat(document.getElementById('sf-amount').value);
    const note = document.getElementById('sf-note').value.trim();
    const method = document.getElementById('sf-method').value;
    const payday = document.getElementById('sf-payday').value;
    if (!staffId) { ui.toastErr('Pick a team member first.'); return; }
    if (!(amount > 0)) { ui.toastErr('Enter a valid amount.'); return; }
    if (!note) { ui.toastErr('Add a note — it is shown to the staff member and kept in the audit trail.'); return; }
    // save the deposit method + payday with the member (the payroll calendar) —
    // only AFTER the inputs are validated, so a failed funding never silently
    // rewrites the team member's schedule
    const pay = db.setStaffPayout(staffId, method, payday ? parseInt(payday, 10) : null);
    if (!pay.ok) { ui.toastErr(pay.msg); return; }
    const r = db.fundStaffWallet(staffId, amount, { note, by: 'Finance' });
    if (!r.ok) { ui.toastErr(r.msg); return; }
    ui.toastOk('Funded ' + r.staff.name + ' ' + db.money(amount, 'R') + ' — wallet ' + r.wallet.walletNo + ' · ref ' + r.reference + (payday ? ' · payday set to the ' + payday + 'th' : '') + '. Emailed to them.');
    document.getElementById('sf-note').value = '';
    renderAll();
  }
  function initStaffPaydaySelect() {
    const sel = document.getElementById('sf-payday');
    if (!sel) return;
    sel.innerHTML = '<option value="">No monthly schedule</option>' +
      Array.from({ length: 28 }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + 'th of month</option>').join('');
  }

  function renderAll() { kpis(); renderFinancial(); renderWallets(); renderPayouts(); renderBatches(); renderAwards(); renderRefundIntel(); renderReferrals(); renderCatalog(); renderMerch(); renderStaffWallets(); renderStaffSchedule(); fillAwardStudents(); fillMerchStudents(); badges(); }

  document.getElementById('btn-batch').addEventListener('click', processBatch);
  document.addEventListener('click', e => {
    const vest = e.target && e.target.closest ? e.target.closest('#btn-vest') : null;
    if (vest) { doVest(); return; }
    const pay = e.target && e.target.closest ? e.target.closest('#btn-pay-refs') : null;
    if (pay) { doPayRefs(); return; }
  });
  document.getElementById('btn-award').addEventListener('click', doAward);
  document.getElementById('btn-giveaway').addEventListener('click', doGiveaway);
  document.getElementById('btn-resolve-wallet').addEventListener('click', doResolveWallet);
  document.getElementById('aw-walletno').addEventListener('keydown', e => { if (e.key === 'Enter') doResolveWallet(); });
  document.getElementById('btn-cat-add').addEventListener('click', doAddCatalog);
  document.getElementById('cat-code').addEventListener('keydown', e => { if (e.key === 'Enter') doAddCatalog(); });
  document.getElementById('btn-mh-claim').addEventListener('click', doClaimMerch);
  document.getElementById('mh-avg').addEventListener('keydown', e => { if (e.key === 'Enter') doClaimMerch(); });
  document.getElementById('mh-ref').addEventListener('keydown', e => { if (e.key === 'Enter') doClaimMerch(); });
  document.getElementById('btn-fin-csv').addEventListener('click', () => downloadFile(db.financialExport('csv')));
  document.getElementById('btn-fin-json').addEventListener('click', () => downloadFile(db.financialExport('json')));
  document.getElementById('btn-fin-email').addEventListener('click', doFinEmail);
  document.getElementById('btn-sf-fund').addEventListener('click', doFundStaff);
  document.getElementById('sf-note').addEventListener('keydown', e => { if (e.key === 'Enter') doFundStaff(); });
  initStaffPaydaySelect();
  document.getElementById('sf-staff').addEventListener('change', () => renderStaffWallets(false));
  renderAll();
  setInterval(renderAll, 3000);
})();
