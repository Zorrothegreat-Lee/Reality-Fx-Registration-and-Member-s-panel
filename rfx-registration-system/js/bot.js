/* SARRAH — the RFX support assistant (floating chat widget)
   Answers accounts & member-panel questions with LIVE data where possible.
   Demo: rule-based intents. Production: swap the ask() core for your LLM/agent endpoint. */
(function () {
  'use strict';

  const db = RFX.db, ui = RFX.ui;

  /* ---------------- live student context ---------------- */
  function currentStudent() {
    try {
      const raw = localStorage.getItem('rfx_member_session');
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.id) return null;
      const enr = db.byId(o.id); // the session payload is { id, token } — never the raw string
      return enr || null; // any signed-in state — the per-state branches handle messaging
    } catch (e) { return null; }
  }

  function walletLine(enr) {
    const w = db.getWallet(enr.payment.email);
    const sum = db.walletSummary(enr.payment.email);
    const usable = db.spendable(enr.payment.email);
    return 'Your wallet number is <b>' + (w.walletNo || '—') + '</b>.<br>' +
      'Available balance: <b>' + db.money(sum.balance, 'ZAR') + '</b> — of which <b>' + db.money(usable, 'ZAR') + '</b> is currently spendable (credits expire, awards don\'t).';
  }

  /* ---------------- intent engine ---------------- */
  const GREET = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'howzit', 'hola', 'yo'];

  function ask(q) {
    q = ' ' + String(q || '').toLowerCase() + ' ';
    const enr = currentStudent();
    const has = t => q.indexOf(t) !== -1;

    // greeting
    if (GREET.some(g => q.indexOf(g) !== -1) && !has('balance') && !has('wallet') && !has('invoice')) {
      return { text: 'Hi' + (enr ? ', <b>' + ui.esc(enr.payment.customerName.split(' ')[0]) + '</b>' : '') + '! I\'m Sarrah, the Reality FX assistant. I can tell you about your balance, credits, invoice, status and RFX OS access. What would you like to know?', chips: ['My balance', 'My invoice', 'RFX OS access'] };
    }

    // balance / wallet / credit
    if (has('balance') || has('wallet') || has('credit') || has('money') || has('refund') || has('award') || has('giveaway')) {
      if (!enr) return { text: 'To check your wallet I need you signed in — open <b>My RFX Account</b> and sign in with your email + Student Code. Or, if you\'re a staff member, the Credit & Refunds console is your home.', chips: ['How do I sign in?'] };
      if (has('refund')) return { text: 'Here\'s the Reality FX policy on refunds:<br>• If approval or registration can\'t proceed, we <b>credit your RFX account</b> by default — usable toward another course, a seat transfer or mentorship, with zero transfer fees.<br>• Cash refunds are available but paid via <b>PayPal in our monthly batch</b>.<br>• Your choice of credit vs cash is captured in your registration terms — the Terms &amp; Conditions you accepted cover this.<br><br>' + walletLine(enr), chips: ['My balance', 'What are my credits?'] };
      if (has('award')) return { text: 'Awards (like Best Student of the Year) and giveaway prizes are <b>earned credit</b> — they never expire. They land straight in your wallet with the reason recorded. ' + (RFX.icons && RFX.icons.trophy ? '<span style="vertical-align:middle;color:var(--gold);">' + RFX.icons.trophy + '</span>' : ''), chips: ['My balance'] };
      if (has('expire') || has('expiry') || has('last')) return { text: 'Rule of thumb: <b>refund credits expire after 24 months</b>; awards and giveaway prizes never expire. Your member panel shows every entry with its expiry date.', chips: ['My balance'] };
      return { text: walletLine(enr), chips: ['My invoice', 'What are my credits?'] };
    }

    // invoice
    if (has('invoice') || has('receipt') || has('paid')) {
      if (!enr) return { text: 'Invoices live in <b>My RFX Account</b> — sign in with your email + Student Code and open the Invoice card. You can print or download it as a PDF.', chips: ['How do I sign in?'] };
      return { text: 'Your official invoice is <b>' + enr.invoice.number + '</b>, issued ' + db.fmtDateShort(enr.invoice.issuedAt) + ', for <b>' + ui.esc(enr.payment.course) + '</b> at <b>' + db.money(enr.payment.price, enr.payment.currency) + '</b> — paid in full. Open <b>My RFX Account → Invoice</b> to print or download it as a PDF.', chips: ['My balance', 'RFX OS access'] };
    }

    // sign in help (before OS access so "how do I log in" never gets hijacked)
    if (has('sign in') || has('signin') || has('log in') || has('login') || has('password') || has('forgot') || has('code')) {
      if (!enr) return { text: 'Students sign in to the member panel with the <b>email on your enrollment</b> plus your <b>Student Code</b> (the 6-character code you got at registration — your ID is RFX-xxxxx, your code is different).<br>Forgot it? Your code is revealed on your registration completion screen and it\'s also inside the welcome email in your <b>Mailbox</b>. You can sign in with your <b>Student ID</b> (RFX-xxxxx) instead — the panel accepts either. In production, Firebase\'s "forgot password" is the recovery path.', chips: ['My balance', 'What is my status?'] };
      return { text: 'You\'re signed in already — what you\'re looking for is on your member panel: your <b>Student ID</b> ' + enr.studentId + ' is under Identity, and your sign-in details are what you used to open this panel. In production, Firebase handles passwords — use "forgot password" there if you ever need to.', chips: ['My balance', 'What is my status?'] };
    }

    // RFX OS access
    if (has('rfx os') || has('os access') || has('enter the os') || has('student id') || has('student code') || has('identity')) {
      if (!enr) return { text: 'RFX OS access unlocks once your registration is approved and the handshake with the OS confirms — that\'s the moment your status flips to <b>Active</b>. Sign in to <b>My RFX Account</b> to see your live access state.', chips: ['What is my status?'] };
      if (enr.state === 'ACTIVE') return { text: 'You\'re all set — your identity is <b>' + enr.studentId + '</b> and your status is <b>Active</b>. RFX OS is open to you: click <b>Enter RFX OS</b> on your member panel. (Production: Firebase signs you in with the account details we sent you.)', chips: ['My balance', 'My invoice'] };
      if (enr.state === 'RFX_OS_CONFIRMED' || enr.state === 'SYNCING_WITH_RFX_OS') return { text: 'You\'re approved and your identity is <b>' + enr.studentId + '</b>. The handshake with RFX OS is ' + (enr.state === 'RFX_OS_CONFIRMED' ? 'confirmed' : 'in progress') + ' — your Enter button appears the moment it completes. Usually seconds.', chips: ['What is my status?'] };
      return { text: 'Your registration is in the <b>' + ui.STATE_LABELS[enr.state] + '</b> stage. RFX OS stays locked until approval + handoff confirm. Keep an eye on your member panel — we\'ll email you the moment you\'re active.', chips: ['What is my status?', 'My invoice'] };
    }

    // status / progress
    if (has('status') || has('progress') || has('where') || has('stage') || has('approved')) {
      if (!enr) return { text: 'Your status lives in <b>My RFX Account</b> — sign in with your email + Student Code and the panel shows your live stage on the journey.', chips: ['How do I sign in?'] };
      const label = ui.STATE_LABELS[enr.state] || enr.state;
      const extra = enr.state === 'ACTIVE' ? ' — you\'re fully active, welcome to the Academy!' : ' — the panel tracks your exact position on the journey.';
      return { text: 'Your enrollment <b>' + enr.id + '</b> is at: <b>' + label + '</b>' + extra, chips: ['My balance', 'RFX OS access'] };
    }

    // staff / shifts
    if (has('staff') || has('shift') || has('clock') || has('duty') || has('roster')) {
      const n = db.onDutyCount();
      return { text: 'The reception team runs <b>24/7</b> — right now <b>' + n + ' team member' + (n === 1 ? '' : 's') + ' on duty</b>. Staff clock in/out through the Staff Portal, and an admin can hire new team members there too.', chips: ['My balance', 'My invoice'] };
    }

    // mentorship / seat transfer / spend
    if (has('mentorship') || has('seat') || has('transfer') || has('redeem') || has('spend') || has('course deposit')) {
      if (!enr) return { text: 'You can use your RFX balance toward <b>mentorship sessions, seat transfers and course deposits</b> — sign in to My RFX Account to see the spend options.', chips: ['How do I sign in?'] };
      const usable = db.spendable(enr.payment.email);
      const seat = 'A <b>seat transfer</b> moves your enrollment to <b>one family member</b>. One course = one seat — so if you can\'t continue, the seat (and its value) doesn\'t die, it passes on. Costs R150 for the re-verification and identity re-issue.';
      if (has('seat') || has('transfer')) return { text: seat, chips: ['My balance', 'How do I sign in?'] };
      return { text: 'You currently have <b>' + db.money(usable, 'ZAR') + '</b> spendable. On your member panel you can spend it on:<br>• <b>Mentorship session</b> — R350<br>• <b>Seat transfer</b> — R150<br>• <b>Course deposit</b> — custom amount<br>Each purchase is recorded in your ledger instantly.', chips: ['My balance', 'My invoice'] };
    }

    // human handoff
    if (has('human') || has('person') || has('agent') || has('talk') || has('speak')) {
      if (!enr) return { text: 'Totally fair. Sign in to <b>My RFX Account</b> (email + Student Code) and use the <b>Live support</b> card — a member of the team replies right there in your panel. Every official message the team sends also lands in your <b>Mailbox</b>.', chips: ['How do I sign in?', 'What is my status?'] };
      return { text: 'Totally fair. Use the <b>Live support</b> card on your member panel — type your message there and a member of the team replies right back in that same thread. Everything official also lands in your <b>Mailbox</b>, so you never miss a thing.', chips: ['My balance', 'What is my status?'] };
    }

    // fallback
    return { text: 'I can help with <b>balance &amp; credits</b>, <b>invoices</b>, <b>status &amp; progress</b>, <b>RFX OS access</b>, <b>refunds</b>, <b>mentorship &amp; seat transfers</b> and <b>staff shifts</b>. Try one of these:', chips: ['My balance', 'My invoice', 'What is my status?', 'RFX OS access'] };
  }

  /* ---------------- widget ---------------- */
  function build() {
    const root = document.createElement('div');
    root.id = 'rfx-bot';
    root.innerHTML =
      '<button class="bot-fab" id="bot-fab" aria-label="Chat with Sarrah">' +
      '  <span class="bot-fab-ic">' + (RFX.icons && RFX.icons.inbox) + '</span>' +
      '  <span class="dot ok pulse bot-fab-dot"></span>' +
      '</button>' +
      '<div class="bot-panel" id="bot-panel" hidden>' +
      '  <div class="bot-head">' +
      '    <div class="bot-head-av">' + (RFX.icons && RFX.icons.sparkles) + '</div>' +
      '    <div class="bot-head-t"><b>Sarrah</b><span>RFX assistant · accounts &amp; members · 24/7</span></div>' +
      '    <button class="bot-close" id="bot-close" aria-label="Close chat">' + (RFX.icons && RFX.icons.x) + '</button>' +
      '  </div>' +
      '  <div class="bot-msgs" id="bot-msgs"></div>' +
      '  <div class="bot-chips" id="bot-chips"></div>' +
      '  <form class="bot-input" id="bot-form">' +
      '    <input id="bot-field" placeholder="Ask about your account…" autocomplete="off">' +
      '    <button type="submit" aria-label="Send">' + (RFX.icons && RFX.icons.send) + '</button>' +
      '  </form>' +
      '</div>';

    const fab = root.querySelector('#bot-fab');
    const panel = root.querySelector('#bot-panel');
    const msgs = root.querySelector('#bot-msgs');
    const chips = root.querySelector('#bot-chips');
    const field = root.querySelector('#bot-field');
    const close = root.querySelector('#bot-close');

    function addMsg(html, who) {
      const m = document.createElement('div');
      m.className = 'bot-msg ' + (who === 'me' ? 'me' : 'bot');
      m.innerHTML = html;
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
      return m;
    }
    function addTyping(cb) {
      const m = addMsg('<span class="bot-typing"><i></i><i></i><i></i></span>', 'bot');
      setTimeout(cb, 450 + Math.random() * 450);
    }
    function showChips(list) {
      chips.innerHTML = '';
      (list || []).forEach(t => {
        const c = document.createElement('button');
        c.className = 'bot-chip';
        c.textContent = t;
        c.addEventListener('click', () => { field.value = t; submit(); });
        chips.appendChild(c);
      });
    }
    function submit() {
      const q = field.value.trim();
      if (!q) return;
      addMsg('<b>' + ui.esc(q) + '</b>', 'me');
      field.value = '';
      chips.innerHTML = '';
      addTyping(() => {
        const r = ask(q);
        addMsg(r.text, 'bot');
        showChips(r.chips);
      });
    }
    function open() {
      panel.hidden = false;
      fab.style.display = 'none';
      field.focus();
      if (!msgs.children.length) {
        const enr = currentStudent();
        addMsg('Welcome' + (enr ? ', <b>' + ui.esc(enr.payment.customerName.split(' ')[0]) + '</b>' : '') + '. I\'m Sarrah — accounts, credits, invoices, access. How can I help?', 'bot');
        showChips(['My balance', 'My invoice', 'What is my status?', 'RFX OS access']);
      }
    }
    function closeChat() {
      panel.hidden = true;
      fab.style.display = '';
    }

    fab.addEventListener('click', open);
    close.addEventListener('click', closeChat);
    root.querySelector('#bot-form').addEventListener('submit', e => { e.preventDefault(); submit(); });
    document.body.appendChild(root);
  }

  document.addEventListener('DOMContentLoaded', build);
})();
