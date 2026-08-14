/* ============================================================
   REALITY FX — ENROLLMENT & REGISTRATION SYSTEM  (System A)
   js/db.js — data layer
   ------------------------------------------------------------
   This file is the ONLY place that touches persistent state.
   It is written as a small database with a clean API so that,
   in production, the bodies of these functions can be swapped
   for real backend calls (Firebase / REST API) without the
   rest of the app changing.

   State machine (the five pillars):
     PENDING  ->  APPROVED  ->  SYNCING_WITH_RFX_OS  ->  RFX_OS_CONFIRMED  ->  ACTIVE
                       \->  REJECTED
     APPROVED ->  SYNC_FAILED  ->  (automatic retry)  ->  SYNCING_WITH_RFX_OS ...
   ============================================================ */

window.RFX = window.RFX || {};

(function () {
  'use strict';

  const DB_KEY = 'rfx_system_a_db_v1';

  /* Shared demo store — the demo's data normally lives only in the localStorage
     of the browser that created it, so a registration link opened from ANY
     OTHER browser says "not recognised". The preview server (serve_fork.pl)
     exposes this endpoint backed by a single JSON file on the machine, making
     the demo work in every browser that can reach it (localhost only).
     Production replaces this with Lee's Firebase — the call sites never change. */
  const SERVER_STATE_ENDPOINT = '/api/state';
  function serverState() {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', SERVER_STATE_ENDPOINT, false); // sync: load() runs before render — localhost is fast
      x.setRequestHeader('Accept', 'application/json');
      x.send(null);
      if (x.status === 200 && x.responseText) {
        const p = JSON.parse(x.responseText);
        return (p && typeof p === 'object' && Object.keys(p).length) ? p : null;
      }
    } catch (e) { /* no server (file:// or plain static) — fall back to localStorage */ }
    return null;
  }
  function pushToServer() {
    try {
      const x = new XMLHttpRequest();
      x.open('POST', SERVER_STATE_ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(state));
    } catch (e) { /* demo: fire-and-forget */ }
  }
  function clearServerStore() {
    try {
      const x = new XMLHttpRequest();
      x.open('POST', SERVER_STATE_ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(DEFAULTS));
    } catch (e) {}
  }

  /* The bridge never sends a student twice: every handoff carries
     the Student ID as an IDEMPOTENCY KEY. RFX-XXXXX can only ever
     represent one identity, so a retried request can never create
     a duplicate. */
  const IDEMPOTENCY_KEY_FIELD = 'studentId';

  /* ---------------- default settings ---------------- */
  const DEFAULTS = {
    schemaVersion: 8,
    seq: { enrollment: 0, invoice: 0, student: 10481, payout: 0, batch: 0, giveaway: 0, staff: 0, merch: 0, referral: 0 },
    /* Security posture (demo-honest: these are enforced in the browser now;
       production mirrors them server-side — see README “Security posture”).
       maxLoginAttempts / lockoutMinutes  — member-panel login throttling
       verifyCodeAttempts / verifyCodeLockMinutes — email-code brute-force guard
       captchaAttempts — CAPTCHA challenge lifetime (server-verified provider in prod)
       retainSelfies — data minimisation: 'untilDecision' purges the selfie once
       a decision is made (approval or final rejection), keeping only the verdict. */
    security: {
      maxLoginAttempts: 5,
      lockoutMinutes: 15,
      verifyCodeAttempts: 5,
      verifyCodeLockMinutes: 5,
      captchaAttempts: 6,
      retainSelfies: 'untilDecision', // 'untilDecision' | 'keep'
      sessionTimeoutMinutes: 15,     // member panel: auto sign-out after inactivity
    },
    loginAttempts: {},        // email -> { count, lockedUntil }  (throttle map)
    staffLoginAttempts: {},   // staff email -> { count, lockedUntil }
    staff: [],                // staff members (invite-based, admin-created)
    securityEvents: [],       // { at, event, detail } — lockouts, purges, etc.
    rfxOsEndpoint: 'http://127.0.0.1:49270/os/api/handoff', // Lee's system (System B)
    demoMode: true,            // when true, the bridge simulates RFX OS answering
    autoApproveDemo: false,    // demo helper: approve submissions instantly
    homeCountry: 'South Africa', // used to flag cross-border refund considerations
    // What identity details are required at registration.
    // Default: 'off' — Reality FX does NOT collect government ID or passport
    // numbers, ever. AML/KYC rules apply to regulated brokers (like XM), not
    // to educators; collecting national IDs would only add POPIA/GDPR duties
    // and breach risk for zero benefit at course level. The academy verifies
    // lightly (email, selfie, phone, address) and lets RFX OS integrity
    // monitoring handle post-entry abuse.
    registrationRequirements: {
      idNumber: 'off', // 'required' | 'optional' | 'off' — 'off' hides the field entirely
      phone: 'required',
      selfie: 'required',
      address: 'required',
    },
    course: {
      name: 'Reality Academy — Professional Program',
      price: 3510,
      currency: 'R',
      paymentMethods: ['Instant EFT', 'Card (Visa / Mastercard)', 'PayPal'],
    },
    agreements: [
      { id: 'tcs', name: 'Reality FX Course Terms & Conditions', version: '2.1' },
      { id: 'fup', name: 'Reality FX Fair Usage Policy', version: '1.4' },
      { id: 'privacy', name: 'Reality FX Privacy Notice', version: '1.2' },
      { id: 'refund', name: 'Refund & Credit Policy', version: '2.1' },
      { id: 'protection', name: 'Content Protection & Trusted Printing', version: '1.0' },
      { id: 'referral', name: 'Referral & Marketing Policy', version: '1.0' },
    ],
    // Resolution machinery: every student starts with an RFX account at R0.00.
    // When a refundable event occurs (e.g. a rejected registration), the student
    // chooses credit or cash; staff execute; cash refunds drain through a
    // consolidated monthly batch so transfer fees are paid once, not per student.
    wallets: [],
    staffWallets: [],   // staff RFX wallets — an admin funds them (salary/allowance); ledgered + audited
    payouts: [],
    auditLog: [],
    // The finance address that receives the end-of-day financial audit log —
    // every money event: payments received, credits held, refunds out, awards,
    // referral commissions, wallet spend, staff funding.
    financeEmail: 'realityfx20@gmail.com',
    credit: { validityMonths: 24, warnWithinDays: 60 },  // RFX credits expire; warn before they do
    // Referral marketing — students share a code, the academy tracks where every
    // student comes from (marketing-budget intel). Commission is earned the way
    // the founder thinks about money: it ACCRUES when the referred student goes
    // ACTIVE, VESTS only after they survive the refund window (a refund forfeits
    // it), and the referrer must be an ACTIVE student. Single-level only — the
    // family tree is tracked for analytics and responsibility, but payouts stay
    // one level deep so the program can never become a pyramid.
    referral: {
      enabled: true,
      tiers: [
        { min: 0, rate: 15 },   // 1-2 active referrals  → 15%  (R527 on full price)
        { min: 3, rate: 20 },   // 3-5                    → 20%
        { min: 6, rate: 25 },   // 6-9                    → 25%
        { min: 10, rate: 30 },  // 10+                    → 30%
      ],
      vestingDays: 30,  // commission vests once the referred student survives this long as ACTIVE without refunding
      clawbackDays: 90, // a referred student banned within this window claws the commission back
    },
    reapplication: { maxAttempts: 2, windowDays: 7 },   // fixable rejections: N corrections within X days
    // Refund intelligence — refunds are signals, not transactions. Every request
    // is fingerprint-scored against the identity's history (prior refunds, velocity,
    // early refunds, pre-registration refunds, payment links). Flags are review
    // triggers, never auto-verdicts. An executed refund revokes all material rights
    // and puts the identity on a cooldown before it can re-enroll.
    refund: {
      cooldownDays: 30,        // after an executed refund, this identity cannot re-enroll for N days
      riskThreshold: 60,       // score >= this flags the request for moderator review
      velocityDays: 90,        // window for counting rapid refunds
      velocityCount: 2,        // >= this many refunds in the window = velocity flag
      earlyDays: 7,            // refund requested within this many days of enrollment
      statement: 'Approved refunds revoke all rights and ownership of Reality FX course material, immediately terminate RFX OS access, and start a 30-day period during which the refunding identity may not re-enroll or re-apply. This is stated in the Refund & Credit Policy accepted at registration.',
    },
    // Package catalog for spending RFX credit. Each package has a code that Lee
    // mirrors on the website store (the store is the home of products; this is
    // the spend rail). Students pick from a dropdown sorted by price ascending;
    // they can only pay when their spendable balance covers the price.
    catalog: [
      { code: 'RFX-UPGRADE-02', name: 'Reality Academy — Advanced Program', price: 6900, currency: 'R', note: 'Upgrade to the Advanced Program' },
      { code: 'RFX-UPGRADE-01', name: 'Reality Academy — Professional Program', price: 3510, currency: 'R', note: 'Upgrade to the Professional Program' },
      { code: 'RFX-MENTOR-01', name: 'Mentorship session (1 hour)', price: 350, currency: 'R', note: 'One-on-one live mentoring with a senior trader' },
      { code: 'RFX-SEAT-01', name: 'Seat transfer to a family member', price: 150, currency: 'R', note: 'One course = one seat. If you can\'t continue, pass your seat to one family member instead of losing it' },
      // Merch — physical goods, so purchases need size + address and flow through
      // the fulfillment queue (not just the wallet ledger). kind:'merch' marks them.
      { code: 'RFX-MERCH-TEE', name: 'Reality FX T-shirt', price: 250, currency: 'R', kind: 'merch', sizes: ['S', 'M', 'L', 'XL', 'XXL'], note: 'Black tee with the gold RFX crest' },
      { code: 'RFX-MERCH-SWEAT', name: 'Reality FX Sweatpants', price: 320, currency: 'R', kind: 'merch', sizes: ['S', 'M', 'L', 'XL', 'XXL'], note: 'Matching gold-trim sweatpants — complete the look' },
      { code: 'RFX-MERCH-HOODY', name: 'Reality FX Hoody', price: 450, currency: 'R', kind: 'merch', sizes: ['S', 'M', 'L', 'XL', 'XXL'], note: 'Embroidered gold crest hoody' },
      { code: 'RFX-MERCH-COMBO', name: 'T-shirt + Hoody combo', price: 600, currency: 'R', kind: 'merch', sizes: ['S', 'M', 'L', 'XL', 'XXL'], note: 'Both, for the full look' },
    ],
    // Merch fulfilment. Earned merch (80%+ average, signalled by RFX OS) is a
    // REWARD — a fulfilment obligation, never credit. Bought merch is a
    // transaction on the spend rail. Both share the same queue.
    merch: {
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      achievementThreshold: 80, // average % that earns the free tee + hoody
      orders: [],                // { id, kind, email, name, items[], total, status, address, at, history[] }
      claims: {},                // achievement reference -> order id (idempotency: one claim per reference)
    },
  };

  let state = load();

  /* ---------------- persistence ---------------- */
  function load() {
    try {
      // Shared demo store first (any browser), localStorage as the offline layer.
      const server = serverState();
      const raw = server ? JSON.stringify(server) : localStorage.getItem(DB_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const parsed = JSON.parse(raw);
      // merge defaults so new fields never break old saves
      const merged = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)), parsed);
      merged.seq = Object.assign({}, DEFAULTS.seq, parsed.seq || {});
      merged.course = Object.assign({}, DEFAULTS.course, parsed.course || {});
      merged.credit = Object.assign({}, DEFAULTS.credit, parsed.credit || {});
      merged.reapplication = Object.assign({}, DEFAULTS.reapplication, parsed.reapplication || {});
      merged.registrationRequirements = Object.assign({}, DEFAULTS.registrationRequirements, parsed.registrationRequirements || {});
      merged.agreements = parsed.agreements || DEFAULTS.agreements;
      merged.security = Object.assign({}, DEFAULTS.security, parsed.security || {});
      merged.loginAttempts = parsed.loginAttempts || {};
      merged.securityEvents = parsed.securityEvents || [];
      merged.catalog = Array.isArray(parsed.catalog) ? parsed.catalog : DEFAULTS.catalog;
      // v2 → v3 migration: Reality FX no longer collects government IDs at all.
      // One-time forced upgrade so old 'optional' saves also stop asking.
      if (merged.schemaVersion < 3) {
        merged.registrationRequirements = Object.assign({}, merged.registrationRequirements || {}, { idNumber: 'off' });
        merged.schemaVersion = 3;
      }
      if (merged.schemaVersion < 4) merged.schemaVersion = 4; // security layer added
      if (merged.schemaVersion < 5) {
        // v5: merch — append the merch catalog items to existing saves (by code)
        const have = new Set((merged.catalog || []).map(c => c.code));
        const missing = DEFAULTS.catalog.filter(c => c.kind === 'merch' && !have.has(c.code));
        if (missing.length) merged.catalog = (merged.catalog || []).concat(missing);
        merged.merch = Object.assign({}, DEFAULTS.merch, parsed.merch || {});
        merged.schemaVersion = 5;
      }
      if (merged.schemaVersion < 6) {
        // v6: new merch items (sweatpants) — re-run the append-by-code for safety
        const have = new Set((merged.catalog || []).map(c => c.code));
        const missing = DEFAULTS.catalog.filter(c => c.kind === 'merch' && !have.has(c.code));
        if (missing.length) merged.catalog = (merged.catalog || []).concat(missing);
        merged.schemaVersion = 6;
      }
      if (merged.schemaVersion < 7) {
        // v7: Content Protection & Trusted Printing agreement — append if missing
        const have = new Set((merged.agreements || []).map(a => a.id));
        const missing = DEFAULTS.agreements.filter(a => !have.has(a.id));
        if (missing.length) merged.agreements = (merged.agreements || []).concat(missing);
        merged.schemaVersion = 7;
      }
      if (merged.schemaVersion < 8) {
        // v8: Referral & Marketing Policy agreement + referral settings
        const have = new Set((merged.agreements || []).map(a => a.id));
        const missing = DEFAULTS.agreements.filter(a => !have.has(a.id));
        if (missing.length) merged.agreements = (merged.agreements || []).concat(missing);
        merged.referral = Object.assign({}, DEFAULTS.referral, parsed.referral || {});
        merged.seq.referral = (parsed.seq && parsed.seq.referral) || 0;
        merged.schemaVersion = 8;
      }
      return merged;
    } catch (e) {
      console.error('RFX db: failed to load, starting fresh.', e);
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function save() {
    state.rev = (state.rev || 0) + 1; // multi-tab: newest write always wins
    try { localStorage.setItem(DB_KEY, JSON.stringify(state)); }
    catch (e) { console.error('RFX db: failed to save.', e); }
    pushToServer(); // shared demo store — the link then works from any browser
  }

  /* Multi-tab safety — two tabs (e.g. Staff Console + member panel) share
     localStorage but not memory. Without this, whichever tab saves last
     silently clobbers the other's writes. On any write from ANOTHER tab we
     adopt the fresher state and nudge pages to re-render; the rev counter
     guarantees we only ever accept a NEWER revision, never an older one.
     (Production seam: Firestore realtime listeners replace this entirely.) */
  window.addEventListener('storage', function (e) {
    if (e.key !== DB_KEY || !e.newValue) return;
    try {
      const fresh = load(); // re-merge defaults + migrations from the stored bytes
      if ((fresh.rev || 0) > (state.rev || 0)) {
        state = fresh;
        window.dispatchEvent(new CustomEvent('rfx:sync', { detail: { rev: fresh.rev } }));
      }
    } catch (err) { console.error('RFX db: multi-tab sync failed.', err); }
  });

  /* ============================================================
     STAFF — invited team members, shifts & on-duty coverage
     ------------------------------------------------------------
     Students register; staff are HIRED. So staff accounts are
     admin-created with a one-time invite link — never self-serve.
     The invite lets the new team member set their own credential
     (demo: a staff code; production: Firebase Auth + custom claim).
     Shifts give the 24/7 promise a real backbone: clock in/out,
     day/night shift types, and a live on-duty roster.
     ============================================================ */
  const STAFF_ROLES = { admin: 'Admin', reception: 'Reception', approver: 'Approver', finance: 'Finance' };

  function nextStaffId() {
    state.seq.staff = (state.seq.staff || 0) + 1;
    return 'STF-' + String(state.seq.staff).padStart(4, '0');
  }

  function staff() { return (state.staff || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); }
  function staffById(id) { return (state.staff || []).find(s => s.id === id); }
  function staffByEmail(email) { return (state.staff || []).find(s => s.email === String(email || '').trim().toLowerCase()); }

  function makeInviteLink(s) {
    const base = location.href.split('/').slice(0, -1).join('/');
    return base + '/staff.html?invite=' + s.inviteToken;
  }
  function staffInviteEmail(s) {
    const link = makeInviteLink(s);
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(s.name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Welcome to the Reality FX team as <b>' + STAFF_ROLES[s.role] + '</b>. ' +
      'To set up your staff access, open the invite below — it is <b>one-time use</b> and expires in <b>7 days</b>.</p>' +
      '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + link + '" style="display:inline-block;background:linear-gradient(135deg,#f0d98c,#d4af37 45%,#a8842a);color:#241a05;' +
      'text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:13px 30px;border-radius:10px;font-size:14px;">' +
      'Set up my staff access</a></div>' +
      '<p style="font-family:monospace;font-size:11px;color:#999;word-break:break-all;">Or paste: ' + link + '</p>' + footerHtml();
  }

  function createStaff(opts) {
    const name = String(opts.name || '').trim();
    const emailAddr = String(opts.email || '').trim().toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr)) return { ok: false, msg: 'A name and a valid email are required.' };
    if (staffByEmail(emailAddr)) return { ok: false, msg: 'A staff member with that email already exists.' };
    const s = {
      id: nextStaffId(),
      name, email: emailAddr,
      role: STAFF_ROLES[opts.role] ? opts.role : 'reception',
      invitedAt: now(),
      inviteToken: makeToken(),
      inviteExpiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      activatedAt: null,
      staffCode: null,
      createdBy: opts.by || 'Reality FX Admin',
      shifts: [],
      createdAt: now(),
    };
    state.staff.push(s);
    secEvent('STAFF_INVITED', s.id + ' · ' + s.name + ' · ' + STAFF_ROLES[s.role] + ' invited by ' + (opts.by || 'admin'));
    email('staff-invite', emailAddr, 'Welcome to the Reality FX team — ' + s.name, staffInviteEmail(s));
    save();
    return { ok: true, staff: s, inviteLink: makeInviteLink(s) };
  }

  function validateStaffInvite(token) {
    // a used invite has its token nulled on activation, so also match by "activated staff who
    // was invited with this token" to report the honest reason instead of "not recognised"
    let s = (state.staff || []).find(x => x.inviteToken === token);
    if (!s) s = (state.staff || []).find(x => x.activatedToken === token);
    if (!s) return { ok: false, msg: 'That invite link is not recognised.' };
    if (s.activatedAt) return { ok: false, msg: 'This invite has already been used — sign in with your staff code instead.' };
    if (new Date(s.inviteExpiresAt) < new Date()) return { ok: false, msg: 'This invite has expired — ask an admin to issue a new one.' };
    return { ok: true, staff: s };
  }

  function activateStaff(token, code) {
    const v = validateStaffInvite(token);
    if (!v.ok) return v;
    code = String(code || '').trim();
    if (code.length < 6) return { ok: false, msg: 'Choose a staff code of at least 6 characters.' };
    v.staff.activatedAt = now();
    v.staff.staffCode = code; // demo credential — production is Firebase Auth + custom claim
    v.staff.activatedToken = v.staff.inviteToken; // remember the consumed token so re-visits report honestly
    v.staff.inviteToken = null; // consume the one-time invite
    secEvent('STAFF_ACTIVATED', v.staff.id + ' · ' + v.staff.name + ' set their staff credential');
    save();
    return { ok: true, staff: v.staff };
  }

  function staffLogin(email, code) {
    email = String(email || '').trim().toLowerCase();
    const sec = state.security || {};
    const max = sec.maxLoginAttempts || 5;
    const lockMin = sec.lockoutMinutes || 15;
    state.staffLoginAttempts = state.staffLoginAttempts || {};
    const rec = state.staffLoginAttempts[email] || { count: 0, lockedUntil: null };
    if (rec.lockedUntil && new Date(rec.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(rec.lockedUntil) - new Date()) / 60000);
      return { ok: false, locked: true, msg: 'Too many failed attempts — locked for ' + mins + ' more minute' + (mins === 1 ? '' : 's') + '. Contact an admin.' };
    }
    const s = staffByEmail(email);
    if (s && s.activatedAt && s.staffCode === String(code || '').trim()) {
      delete state.staffLoginAttempts[email];
      secEvent('STAFF_LOGIN', s.id + ' · ' + s.name + ' signed in');
      save();
      return { ok: true, staff: s };
    }
    rec.count = (rec.count || 0) + 1;
    const left = max - rec.count;
    if (left <= 0) {
      rec.lockedUntil = new Date(Date.now() + lockMin * 60000).toISOString();
      rec.count = 0;
      secEvent('STAFF_LOCKOUT', email + ' locked for ' + lockMin + ' min after repeated failures');
      state.staffLoginAttempts[email] = rec;
      save();
      return { ok: false, locked: true, msg: 'Too many failed attempts — locked for ' + lockMin + ' minutes. Contact an admin.' };
    }
    state.staffLoginAttempts[email] = rec;
    save();
    return { ok: false, locked: false, msg: 'No match — check your email and staff code. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' };
  }

  function clockIn(staffId, type) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    if (s.shifts.some(sh => !sh.out)) return { ok: false, msg: 'You are already clocked in — clock out first.' };
    s.shifts.push({ in: now(), out: null, type: type === 'night' ? 'night' : 'day' });
    secEvent('STAFF_CLOCK_IN', s.id + ' · ' + s.name + ' clocked in (' + (type === 'night' ? 'night' : 'day') + ' shift)');
    save();
    return { ok: true, shift: s.shifts[s.shifts.length - 1] };
  }
  function clockOut(staffId) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    const open = (s.shifts || []).find(sh => !sh.out);
    if (!open) return { ok: false, msg: 'You are not clocked in.' };
    open.out = now();
    secEvent('STAFF_CLOCK_OUT', s.id + ' · ' + s.name + ' clocked out');
    save();
    return { ok: true, shift: open };
  }
  function onDutyStaff() { return (state.staff || []).filter(s => s.shifts && s.shifts.some(sh => !sh.out)); }
  function onDutyCount() { return onDutyStaff().length; }
  function currentShift(staffId) {
    const s = staffById(staffId);
    return s ? (s.shifts || []).find(sh => !sh.out) || null : null;
  }

  /* ---------------- id generators ---------------- */
  function nextId(seqName, prefix, pad) {
    state.seq[seqName] = (state.seq[seqName] || 0) + 1;
    return prefix + String(state.seq[seqName]).padStart(pad, '0');
  }

  function nextStudentId() {
    state.seq.student += 1;
    return 'RFX-' + String(state.seq.student).padStart(5, '0');
  }

  function makeReferralCode() {
    // short, shareable, human-typable code — no ambiguous chars
    const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += alpha[Math.floor(Math.random() * alpha.length)];
    return 'RFX-' + c;
  }

  function makeStudentCode() {
    // 6-character code from an unambiguous alphabet (no 0/O, 1/I)
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  function makeToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function makeVerifyCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function now() { return new Date().toISOString(); }

  function audit(enrollment, event, detail) {
    if (!enrollment.audit) enrollment.audit = [];
    enrollment.audit.push({ at: now(), event, detail: detail || '' });
  }

  /* Security events (lockouts, purge runs, throttling…) go to a dedicated
     store the moderator can review — separate from per-enrollment audit. */
  function secEvent(event, detail) {
    state.securityEvents = state.securityEvents || [];
    state.securityEvents.push({ at: now(), event, detail: detail || '' });
    save();
  }
  function securityEvents(limit) {
    return (state.securityEvents || []).slice().reverse().slice(0, limit || 30);
  }

  /* ---------------- emails ---------------- */
  function email(kind, to, subject, html) {
    state.emails = state.emails || [];
    const mail = { id: nextId('email', 'EM-', 4), kind, to, subject, html, sentAt: now(), read: false };
    state.emails.unshift(mail);
    save();
    return mail;
  }
  function emails() { return (state.emails || []).slice(); }
  function markEmailRead(id) {
    const m = (state.emails || []).find(e => e.id === id);
    if (m) { m.read = true; save(); }
  }
  function unreadCount() { return (state.emails || []).filter(e => !e.read).length; }
  function clearEmails() { state.emails = []; save(); }

  /* ---------------- settings ---------------- */
  function getSettings() { return state; }

  /* The Academy entry URL: derived from the configured handoff endpoint so
     every gate (member panel, completion screen) points at the same place.
     Accepts either the API form (…/api/handoff) or a page URL directly,
     and strips any trailing slash before appending the page. */
  function osIndexUrl() {
    let ep = String(state.rfxOsEndpoint || 'http://127.0.0.1:49270/os/api/handoff').trim();
    if (ep.indexOf('/api/') !== -1) ep = ep.split('/api/')[0];
    ep = ep.replace(/\/+$/, '');
    if (/\.html?($|[?#])/.test(ep)) return ep;          // already a page URL
    return ep + '/index.html';
  }
  function updateSettings(patch) {
    state = Object.assign({}, state, patch);
    save();
  }

  /* ---------------- package catalog (spend rail) ----------------
     The store on the website owns products; this catalog is the list of
     spendable items with the codes Lee mirrors on those products. Sorted
     by price ascending for the student dropdown (affordable first). */
  function getCatalog() {
    return (state.catalog || []).slice().sort((a, b) => (a.price || 0) - (b.price || 0));
  }
  function saveCatalog(items) {
    if (!Array.isArray(items)) return { ok: false, msg: 'Catalog must be a list of packages.' };
    const cleaned = items.filter(it => it && String(it.code || '').trim() && Number(it.price) > 0);
    const codes = new Set();
    for (const it of cleaned) {
      const code = String(it.code).trim().toUpperCase();
      if (codes.has(code)) return { ok: false, msg: 'Duplicate code ' + code + ' — every package needs a unique code.' };
      codes.add(code);
    }
    state.catalog = cleaned.map(it => ({
      code: String(it.code).trim().toUpperCase(),
      name: String(it.name || '').trim(),
      price: Number(it.price),
      currency: it.currency || 'R',
      note: String(it.note || '').trim(),
      kind: it.kind === 'merch' ? 'merch' : undefined,
      sizes: it.kind === 'merch' ? (it.sizes && it.sizes.length ? it.sizes : DEFAULTS.merch.sizes) : undefined,
    }));
    secEvent('CATALOG_UPDATED', state.catalog.length + ' spend packages configured');
    save();
    return { ok: true, catalog: state.catalog };
  }

  /* ============================================================
     RFX ACCOUNT CREDIT (Wallet) & CONSOLIDATED REFUND PAYOUTS
     ------------------------------------------------------------
     Every student has an RFX account starting at 0.00. On a refundable
     event the student picks: credit (instant, fee-free, revenue stays in
     the business) or cash refund (queued into a monthly consolidated
     batch so cross-border transfer fees are paid once, not per student).
     ============================================================ */
  function getWallet(email) {
    state.wallets = state.wallets || [];
    email = (email || '').trim().toLowerCase();
    let w = state.wallets.find(x => x.email === email);
    if (!w) {
      // Every wallet gets a permanent unique number (W-XXXXXXXXX with a Luhn
      // check digit) so staff can reference and send by number, and typos are
      // caught before money moves — the student's RFX account number.
      w = { email, name: '', balance: 0, currency: 'R', ledger: [], walletNo: makeWalletNo() };
      state.wallets.push(w);
      save();
    } else {
      ensureWalletNo(w); // backfill older saves
    }
    return w;
  }
  function wallets() {
    let changed = false;
    (state.wallets || []).forEach(w => { if (w && !w.walletNo) { w.walletNo = makeWalletNo(); changed = true; } });
    if (changed) save(); // persist backfilled numbers, not just in memory
    return (state.wallets || []).slice().sort((a, b) => b.balance - a.balance);
  }

  /* ---------------- wallet numbers ----------------
     W- + 8 random digits + a Luhn check digit (9 digits total), like a bank
     account number. walletByNumber validates the check digit and resolves the
     wallet; sending money by number means a mis-typed number fails loudly. */
  function luhnDigit(str) {
    // operates on the raw digit string so leading zeros are never lost
    const digits = String(str).split('').reverse();
    let s = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = parseInt(digits[i], 10);
      if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
      s += d;
    }
    return (10 - (s % 10)) % 10;
  }
  function makeWalletNo() {
    const base = Math.floor(10000000 + Math.random() * 90000000); // 8 digits
    return 'W-' + base + luhnDigit(base);
  }
  function ensureWalletNo(w) {
    if (w && !w.walletNo) w.walletNo = makeWalletNo();
  }
  function validateWalletNumber(num) {
    const clean = String(num || '').trim().toUpperCase().replace(/^W-?/, '');
    if (!/^\d{9}$/.test(clean)) return { ok: false, msg: 'Wallet numbers are W- followed by 9 digits (e.g. W-48291704).' };
    if (parseInt(clean[8], 10) !== luhnDigit(clean.slice(0, 8))) return { ok: false, msg: 'That wallet number fails its check digit — please re-read it. (Typos are caught before money moves.)' };
    const w = (state.wallets || []).find(x => x.walletNo === 'W-' + clean);
    return w ? { ok: true, wallet: w } : { ok: false, msg: 'No RFX wallet exists with that number yet.' };
  }
  function walletBalance(email) { return getWallet(email).balance; }

  /* ============================================================
     STAFF WALLETS — the team has RFX money too.
     ------------------------------------------------------------
     Staff are paid the same way students are credited: a wallet
     number, a ledger, a balance. Only finance staff (via the
     finance page) can fund one, and every funding is ledgered,
     security-logged, emailed to the staff member, and idempotent
     by an optional reference — the same reference can never pay
     twice, the standard we enforce everywhere money moves. */
  function staffWalletFor(staffId) {
    state.staffWallets = state.staffWallets || [];
    let w = state.staffWallets.find(x => x.staffId === staffId);
    if (!w) {
      const s = staffById(staffId);
      w = {
        staffId, holder: 'staff',
        email: s ? s.email : staffId,
        name: s ? s.name : staffId,
        balance: 0, currency: 'R', ledger: [], walletNo: makeWalletNo(),
      };
      state.staffWallets.push(w);
      save();
    }
    return w;
  }
  function staffWallets() {
    state.staffWallets = state.staffWallets || [];
    return state.staffWallets.slice().sort((a, b) => b.balance - a.balance);
  }
  function fundStaffWallet(staffId, amount, opts) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    amount = Number(amount);
    if (!(isFinite(amount) && amount > 0)) return { ok: false, msg: 'Enter a valid amount.' };
    const note = String((opts && opts.note) || '').trim();
    if (!note) return { ok: false, msg: 'Add a note — it is shown to the staff member and kept in the audit trail.' };
    const by = (opts && opts.by) || 'Reality FX Finance';
    const ref = String((opts && opts.reference) || '').trim() || ('FND-' + Date.now());
    const w = staffWalletFor(staffId);
    if ((w.ledger || []).some(e => e.reference && e.reference === ref)) return { ok: false, msg: 'Reference ' + ref + ' was already paid — never pay the same funding twice.' };
    w.balance += amount;
    w.ledger.push({ at: now(), type: 'staff-fund', amount, note, reference: ref, by });
    secEvent('STAFF_WALLET_FUNDED', s.id + ' · ' + s.name + ' funded ' + money(amount, w.currency) + ' by ' + by + ' (ref ' + ref + ')');
    email('staff-fund', s.email, 'Reality FX — funds added to your staff wallet', staffFundEmail(s, w, amount, ref));
    save();
    return { ok: true, staff: s, wallet: w, reference: ref };
  }
  function staffFundEmail(s, w, amount, ref) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(s.name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Funds have been added to your Reality FX staff wallet. This is your RFX money — it is shown in your Staff Portal.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<tr><td style="padding:6px 0;color:#888;">Amount added</td><td style="text-align:right;font-weight:700;color:#1d7a33;">+' + money(amount, w.currency) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Your staff wallet</td><td style="text-align:right;font-family:monospace;">' + w.walletNo + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">New balance</td><td style="text-align:right;font-weight:600;">' + money(w.balance, w.currency) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Reference</td><td style="text-align:right;font-family:monospace;">' + ref + '</td></tr>' +
      '</table>' + footerHtml();
  }

  /* Staff payout settings — how and when the team is paid.
     method: paypal | bank | zapper | cash (the deposit rail finance uses)
     payday: 1-28 (day of month) — the monthly payroll calendar. */
  function setStaffPayout(staffId, method, payday) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    const m = String(method || '').toLowerCase();
    const valid = ['paypal', 'bank', 'zapper', 'cash'];
    if (m && valid.indexOf(m) === -1) return { ok: false, msg: 'Choose a valid deposit method: ' + valid.join(', ') + '.' };
    const d = payday == null ? null : parseInt(payday, 10);
    if (d != null && !(d >= 1 && d <= 28)) return { ok: false, msg: 'Payday must be a day of the month between 1 and 28.' };
    s.payout = { method: m || 'paypal', payday: d, setAt: now() };
    save();
    return { ok: true, staff: s };
  }

  /* Next scheduled pay date for a payday (day of month). Rolls to the next
     month when today's date has passed. Returns ISO date or null. */
  function nextPayDate(payday, from) {
    if (!(payday >= 1 && payday <= 28)) return null;
    const base = from ? new Date(from) : new Date();
    const cand = new Date(base.getFullYear(), base.getMonth(), payday);
    if (cand.getTime() < Date.now()) cand.setMonth(cand.getMonth() + 1);
    return cand.toISOString();
  }

  /* Payroll schedule — every staff member with a payday, their next pay date,
     and whether it is due today. Sorted by next pay date. */
  function staffPayoutSchedule() {
    const out = (state.staff || [])
      .filter(s => s.payout && s.payout.payday)
      .map(s => {
        const next = nextPayDate(s.payout.payday);
        const isDue = Boolean(next && new Date(next).toDateString() === new Date().toDateString());
        return { staffId: s.id, name: s.name, email: s.email, method: (s.payout && s.payout.method) || 'paypal', payday: s.payout.payday, nextPayAt: next, dueToday: isDue };
      })
      .sort((a, b) => String(a.nextPayAt).localeCompare(String(b.nextPayAt)));
    return out;
  }

  /* ============================================================
     FINANCIAL AUDIT — every money event in one flat ledger.
     ------------------------------------------------------------
     The end-of-day tax/audit file. One row per event, sourced from
     the live records (never a separate bookkeeping copy that could
     drift): course payments received, credits held, awards, referral
     commissions, wallet spend, staff funding, and cash refunds out.
     Exportable as CSV / JSON and emailed to the finance address. */
  function financialLedger() {
    const rows = [];
    (state.enrollments || []).forEach(e => rows.push({
      at: e.payment.paidAt || e.createdAt, kind: 'payment', dir: 'in', amount: e.payment.price,
      currency: e.payment.currency || 'R', party: e.payment.customerName,
      detail: 'Course payment — ' + (e.payment.course || ''), ref: (e.invoice && e.invoice.number) || e.id,
    }));
    (state.wallets || []).forEach(w => (w.ledger || []).forEach(en => rows.push({
      at: en.at, kind: en.type, dir: (en.amount || 0) >= 0 ? 'in' : 'out', amount: Math.abs(en.amount || 0),
      currency: w.currency || 'R', party: w.name || w.email, detail: en.note || '', ref: en.ref || '',
    })));
    (state.staffWallets || []).forEach(w => (w.ledger || []).forEach(en => rows.push({
      at: en.at, kind: 'staff-fund', dir: 'in', amount: Math.abs(en.amount || 0),
      currency: w.currency || 'R', party: w.name || w.staffId, detail: en.note || '', ref: en.reference || '',
    })));
    (state.payouts || []).forEach(p => {
      // cash-outs are already in the wallet ledger above (the wallet was
      // deducted at request time) — adding them again here would double-count
      if (p.kind === 'cashout') return;
      rows.push({
        at: p.paidAt || p.at, kind: p.status === 'paid' ? 'refund-paid' : 'refund-queued', dir: 'out',
        amount: p.amount, currency: p.currency || 'R', party: p.name,
        detail: 'Cash refund ' + (p.batchId ? '(batch ' + p.batchId + ')' : '(queued)'), ref: p.id,
      });
    });
    return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  function financialSummary() {
    const L = financialLedger();
    const sumIn = kinds => L.filter(r => kinds.indexOf(r.kind) !== -1 && r.dir === 'in').reduce((s, r) => s + r.amount, 0);
    const sumOut = kinds => L.filter(r => kinds.indexOf(r.kind) !== -1 && r.dir === 'out').reduce((s, r) => s + r.amount, 0);
    return {
      received: sumIn(['payment']),
      // held = credits + awards + commissions granted, minus clawbacks, minus
      // what left the wallet (redeems spent on goods, cash-outs queued) — the
      // true current liability, so the audit file reconciles against balances
      held: sumIn(['credit', 'award', 'referral']) - sumOut(['referral', 'redeem', 'cashout']),
      staffFunded: sumIn(['staff-fund']),
      spent: sumOut(['redeem']),
      cashoutsQueued: sumOut(['cashout']),
      refunded: sumOut(['refund-paid']),
      queued: sumOut(['refund-queued']),
      events: L.length,
      currency: state.course.currency,
    };
  }
  function financialExport(format) {
    const L = financialLedger();
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const head = 'timestamp,kind,direction,amount,currency,party,detail,reference';
      const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const body = L.map(r => [r.at, r.kind, r.dir, (Math.round(r.amount * 100) / 100).toFixed(2), r.currency, q(r.party), q(r.detail), q(r.ref)].join(',')).join('\n');
      return { filename: 'realityfx-financial-audit-' + date + '.csv', content: '\ufeff' + head + '\n' + body, mime: 'text/csv' };
    }
    return { filename: 'realityfx-financial-audit-' + date + '.json', content: JSON.stringify({ generatedAt: now(), summary: financialSummary(), ledger: L }, null, 2), mime: 'application/json' };
  }
  function emailFinancialReport(to) {
    const addr = String(to || '').trim() || state.financeEmail || 'realityfx20@gmail.com';
    const s = financialSummary();
    const recent = financialLedger().slice().reverse().slice(0, 300);
    const td = 'padding:5px 7px;font-size:11.5px;word-wrap:break-word;overflow-wrap:anywhere;vertical-align:top;';
    const rows = recent.length ? recent.map(r =>
      '<tr><td style="' + td + 'white-space:nowrap;color:#888;">' + fmtDate(r.at) + '</td>' +
      '<td style="' + td + '">' + escHtml(r.kind) + '</td>' +
      '<td style="' + td + 'text-align:center;">' + (r.dir === 'in' ? '▲ in' : '▼ out') + '</td>' +
      '<td style="' + td + 'text-align:right;font-weight:600;white-space:nowrap;">' + (r.dir === 'in' ? '' : '-') + money(r.amount, r.currency) + '</td>' +
      '<td style="' + td + '">' + escHtml(r.party) + '</td>' +
      '<td style="' + td + 'color:#666;">' + escHtml(r.detail) + '</td>' +
      '<td style="' + td + 'font-family:monospace;">' + escHtml(r.ref) + '</td></tr>'
    ).join('') : '<tr><td colspan="7" style="padding:10px;color:#999;">No financial activity recorded yet.</td></tr>';
    const t = (label, val) => '<tr><td style="padding:6px 0;color:#888;">' + label + '</td><td style="text-align:right;font-weight:600;">' + val + '</td></tr>';
    const html = brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Here is the end-of-day financial audit log. Every money event — attempts, received, sent, held — is listed below. This is the automated record for tax and audit purposes.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;margin-bottom:14px;">' +
      t('Course payments received', money(s.received, s.currency)) +
      t('Credit / awards / referral held', money(s.held, s.currency)) +
      t('Staff wallets funded', money(s.staffFunded, s.currency)) +
      t('Wallet spend (goods)', money(s.spent, s.currency)) +
      t('Cash-outs requested (wallet deductions)', money(s.cashoutsQueued, s.currency)) +
      t('Refunds paid out', money(s.refunded, s.currency)) +
      t('Refunds queued (pending batch)', money(s.queued, s.currency)) +
      '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">' + s.events + ' money events in this ledger (newest 300 shown).</p>' +
      '<div style="overflow-x:auto;"><table style="width:100%;table-layout:fixed;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;color:#333;">' +
      '<colgroup><col style="width:14%;"><col style="width:11%;"><col style="width:7%;"><col style="width:12%;"><col style="width:16%;"><col style="width:25%;"><col style="width:15%;"></colgroup>' +
      '<tr style="background:#f5f1e6;"><th style="padding:6px 7px;text-align:left;font-size:10px;letter-spacing:1px;">When</th><th style="padding:6px 7px;text-align:left;">Kind</th><th style="padding:6px 7px;">Dir</th><th style="padding:6px 7px;text-align:right;">Amount</th><th style="padding:6px 7px;text-align:left;">Party</th><th style="padding:6px 7px;text-align:left;">Detail</th><th style="padding:6px 7px;text-align:left;">Reference</th></tr>' +
      rows + '</table></div>' + footerHtml();
    email('finance-report', addr, 'Reality FX — End-of-day financial audit log', html);
    save();
    return { ok: true, to: addr, events: s.events };
  }

  /* The student records their preference on the rejected screen. Once a
     resolution has been EXECUTED (credit issued or refund queued), the choice
     is locked — switching after the money moved would be a double payout. */
  function recordResolutionChoice(enr, choice) {
    if (choice !== 'credit' && choice !== 'refund') return;
    if (enr.resolution && enr.resolution.executedAt) {
      return { ok: false, msg: 'This enrollment is already resolved — the choice cannot be changed after execution.' };
    }
    enr.resolution = Object.assign({}, enr.resolution || {}, { choice, choiceAt: now() });
    audit(enr, 'RESOLUTION_CHOICE', 'Student chose ' + (choice === 'credit' ? 'RFX account credit' : 'cash refund'));
    save();
    return { ok: true };
  }

  /* Staff execute the choice. EITHER execution permanently locks the
     enrollment — the guards key on executedAt alone, so a credit can never
     be followed by a refund (or vice versa) on the same enrollment. */
  function issueCredit(enr, amount, by) {
    const r = enr.resolution || {};
    if (r.executedAt) return { ok: false, msg: 'This enrollment is already resolved — credit or refund was already executed for it.' };
    const w = getWallet(enr.payment.email);
    w.name = enr.payment.customerName;
    amount = Number(amount) || enr.payment.price;
    // RFX credits carry an expiry date (default 24 months) — stated in the policy
    // the student accepted. The wallet flags balances nearing expiry.
    const validity = (state.credit && state.credit.validityMonths) || 24;
    const exp = new Date();
    exp.setMonth(exp.getMonth() + validity);
    const expiresAt = exp.toISOString();
    w.balance += amount;
    w.ledger.push({ at: now(), type: 'credit', amount, ref: enr.id, note: 'Rejected enrollment ' + enr.id + ' — credit', expiresAt });
    enr.resolution = Object.assign({}, r, {
      method: 'credit', amount, executedAt: now(), executedBy: by || 'Staff', expiresAt,
    });
    audit(enr, 'CREDIT_ISSUED', money(amount, w.currency) + ' credited to RFX account (' + w.email + '). Balance ' + money(w.balance, w.currency) + '. Expires ' + fmtDateShort(expiresAt));
    email('credit', w.email, 'Your RFX account has been credited — ' + money(amount, w.currency), creditEmail(enr, w, amount));
    save();
    return { ok: true, balance: w.balance, expiresAt };
  }

  /* Balance summary incl. what is expiring soon / already expired. */
  function walletSummary(email) {
    const w = getWallet(email);
    const warnMs = ((state.credit && state.credit.warnWithinDays) || 60) * 86400 * 1000;
    const nowMs = Date.now();
    let expiringSoon = 0;
    let expired = 0;
    (w.ledger || []).forEach(e => {
      if (e.type !== 'credit' || !e.expiresAt) return;
      const diff = new Date(e.expiresAt).getTime() - nowMs;
      if (diff <= 0) expired += e.amount;
      else if (diff < warnMs) expiringSoon += e.amount;
    });
    return { email, balance: w.balance, currency: w.currency, expiringSoon, expired };
  }

  function queueRefund(enr, amount, by) {
    const r = enr.resolution || {};
    if (r.executedAt) return { ok: false, msg: 'This enrollment is already resolved — credit or refund was already executed for it.' };
    state.payouts = state.payouts || [];
    amount = Number(amount) || enr.payment.price;
    // REFUND INTELLIGENCE — score the request before it ever reaches the queue.
    const risk = refundRiskScore(enr);
    const fprint = identityKeys(enr);
    const payout = {
      id: nextId('payout', 'PO-', 5),
      at: now(), amount, currency: enr.payment.currency,
      email: enr.payment.email, name: enr.payment.customerName,
      phone: fprint.phone, method: fprint.method,
      studentId: enr.studentId || enr.id,
      enrollmentId: enr.id,
      // Cash refunds ride PayPal's Payouts rail — international, no bank
      // details needed from the student, easy reversals. Demo simulates it.
      rail: 'paypal',
      status: 'queued', batchId: null, paidAt: null,
      // Intelligence attach — visible to the moderator, never an auto-verdict
      riskScore: risk.score, riskSignals: risk.signals, riskFlagged: risk.flagged,
    };
    state.payouts.push(payout);
    enr.resolution = Object.assign({}, r, {
      method: 'refund', amount, executedAt: now(), executedBy: by || 'Staff', payoutId: payout.id,
      riskScore: risk.score, riskSignals: risk.signals, riskFlagged: risk.flagged,
    });
    audit(enr, 'REFUND_QUEUED', money(amount, payout.currency) + ' added to consolidated payout queue (' + payout.id + ') · risk score ' + risk.score + (risk.flagged ? ' · FLAGGED for review' : ''));
    secEvent('REFUND_REQUESTED', enr.id + ' · ' + money(amount, payout.currency) + ' · risk ' + risk.score + (risk.flagged ? ' · FLAGGED' : ''));
    email('refund', payout.email, 'Your Reality FX refund is queued', refundQueuedEmail(enr, payout));
    save();
    return { ok: true, payout, risk };
  }

  function payouts() { return (state.payouts || []).slice().sort((a, b) => (a.at || '').localeCompare(b.at || '')); }
  function queuedPayoutTotal() { return (state.payouts || []).filter(p => p.status === 'queued').reduce((s, p) => s + p.amount, 0); }

  /* ============================================================
     REFUND INTELLIGENCE — the layer that remembers who refunded
     ------------------------------------------------------------
     A refund is a signal, not a transaction. Every request is scored
     against the identity's full history before staff ever see it:
       • fingerprint = email + normalized name + phone + payment method
       • prior refunds by this identity
       • velocity (N refunds within a window)
       • early refund (requested right after purchase)
       • pre-registration refund (never even registered)
       • payment-link reuse across refunded enrollments
     Scores are flags for the moderator — never auto-verdicts (the same
     philosophy as the integrity monitor). An executed refund REVOKES
     material rights and starts a cooldown: the identity can't re-enroll
     until the window passes.
     ============================================================ */
  function identityKeys(enr) {
    const p = enr.payment || {};
    const reg = enr.registration || {};
    const idn = reg.identity || {};
    return {
      email: String(p.email || '').trim().toLowerCase(),
      name: String(p.customerName || '').trim().toLowerCase().replace(/\s+/g, ' '),
      phone: String(idn.phone || p.phone || '').trim().replace(/[^+\d]/g, ''),
      method: String(p.paymentMethod || '').trim().toLowerCase(),
    };
  }
  function keysMatch(a, b) {
    if (a.email && b.email && a.email === b.email) return true;
    if (a.phone && b.phone && a.phone === b.phone) return true;
    // same name AND same payment method is a strong link even with a fresh email
    if (a.name && b.name && a.method && b.method && a.name === b.name && a.method === b.method) return true;
    return false;
  }
  function linkedIdentities(enr) {
    const keys = identityKeys(enr);
    return (state.enrollments || []).filter(e => e.id !== enr.id && keysMatch(keys, identityKeys(e)));
  }
  function refundedIdentities(limit) {
    // every executed refund, with the identity fingerprint of that enrollment
    return (state.payouts || [])
      .filter(p => p.kind !== 'cashout' && (p.status === 'paid' || (p.refundedEnrollment)))
      .map(p => ({ payoutId: p.id, email: p.email, name: p.name, at: p.paidAt || p.at, amount: p.amount, studentId: p.studentId }))
      .slice().sort((a, b) => (a.at || '').localeCompare(b.at || '')).reverse()
      .slice(0, limit || 200);
  }
  /* Core: score a refund request 0-100 with named, reviewable signals. */
  function refundRiskScore(enr) {
    const cfg = state.refund || {};
    const keys = identityKeys(enr);
    const linked = linkedIdentities(enr);
    const signals = [];
    let score = 0;
    // 1) prior refunds by this identity (strongest signal) — payouts now carry
    //    the full fingerprint (email, name, phone, method), so a fresh email +
    //    fresh name still links back through the phone number.
    const priorRefunds = (state.payouts || []).filter(p => {
      return keysMatch({
        email: String(p.email || '').toLowerCase(),
        name: String(p.name || '').toLowerCase().replace(/\s+/g, ' '),
        phone: String(p.phone || '').replace(/[^+\d]/g, ''),
        method: String(p.method || '').toLowerCase(),
      }, keys);
    });
    if (priorRefunds.length) {
      const add = Math.min(45, 15 * priorRefunds.length);
      score += add;
      signals.push({ severity: 'high', label: priorRefunds.length + ' prior refund' + (priorRefunds.length === 1 ? '' : 's') + ' from this identity (' + priorRefunds.map(r => r.id).join(', ') + ')' });
    }
    // 2) refunded identity re-enrolling and refunding AGAIN — the textbook
    //    abuse pattern: the cooldown flag proves a prior refund on this identity.
    if (enr.cooldownFlag) {
      score += 25;
      signals.push({ severity: 'high', label: 'Refunded identity re-enrolled — cooldown in force until ' + fmtDateShort(enr.cooldownFlag.until) });
    }
    // 3) velocity: N+ refunds in the window across linked identities
    const win = new Date(Date.now() - (cfg.velocityDays || 90) * 86400 * 1000);
    const recent = priorRefunds.filter(p => new Date(p.at) > win);
    if (recent.length >= (cfg.velocityCount || 2)) {
      score += 25;
      signals.push({ severity: 'high', label: 'Refund velocity — ' + recent.length + ' refunds in the last ' + (cfg.velocityDays || 90) + ' days' });
    }
    // 4) early refund: requested within N days of purchase
    const bought = new Date(enr.payment.paidAt || enr.createdAt);
    if (Date.now() - bought.getTime() < (cfg.earlyDays || 7) * 86400 * 1000) {
      score += 15;
      signals.push({ severity: 'medium', label: 'Requested within ' + (cfg.earlyDays || 7) + ' days of purchase — possible consume-then-refund' });
    }
    // 5) pre-registration refund: never completed registration
    if (!(enr.registration && enr.registration.submittedAt)) {
      score += 10;
      signals.push({ severity: 'medium', label: 'Requested before registration was ever submitted' });
    }
    // 6) payment-link reuse: linked identities that already refunded
    const linkedRefunded = linked.filter(l => {
      const lk = identityKeys(l);
      return (state.payouts || []).some(p => keysMatch({
        email: String(p.email || '').toLowerCase(),
        name: String(p.name || '').toLowerCase().replace(/\s+/g, ' '),
        phone: String(p.phone || '').replace(/[^+\d]/g, ''),
        method: String(p.method || '').toLowerCase(),
      }, lk));
    });
    if (linkedRefunded.length) {
      score += 10;
      signals.push({ severity: 'medium', label: 'Linked enrollment' + (linkedRefunded.length === 1 ? '' : 's') + ' already refunded — identity linkage detected' });
    }
    // 7) same-day multiple enrollments from one identity
    if (linked.length) {
      signals.push({ severity: 'info', label: linked.length + ' linked enrollment' + (linked.length === 1 ? '' : 's') + ' found for this identity (' + linked.map(l => l.id).join(', ') + ')' });
    }
    return { score: Math.min(100, score), signals, linked: linked.length, flagged: score >= (cfg.riskThreshold || 60) };
  }

  /* The statement students see whenever a refund is chosen — serious, stated. */
  function refundStatement() {
    return (state.refund && state.refund.statement) || 'Approved refunds revoke all material rights and start a 30-day re-enrollment cooldown.';
  }

  /* Monthly consolidated batch: one payout run, one fee, one audit entry. */
  function processPayoutBatch() {
    const queued = (state.payouts || []).filter(p => p.status === 'queued');
    if (!queued.length) return { processed: 0 };
    state.seq.batch = (state.seq.batch || 0) + 1;
    const batchId = 'BATCH-' + String(state.seq.batch).padStart(4, '0');
    const total = queued.reduce((s, p) => s + p.amount, 0);
    const nowIso = now();
    const cooldownMs = ((state.refund && state.refund.cooldownDays) || 30) * 86400 * 1000;
    const revoked = [];
    queued.forEach(p => {
      p.status = 'paid'; p.paidAt = nowIso; p.batchId = batchId;
      // Prize-money cash-outs were already deducted from the wallet at request
      // time — paying them is pure payout, with ZERO enrollment side effects.
      // Never let one fall through to the refund/revocation logic below.
      if (p.kind === 'cashout') return;
      // REFUNDED + revocation + identity cooldown — the material rights die here.
      // Match the EXACT enrollment that queued the refund (p.enrollmentId), never
      // a first-match-by-email — repeat emails are normal in the cooldown world.
      const enr = (state.enrollments || []).find(e => e.id === p.enrollmentId)
        || (state.enrollments || []).find(e => e.studentId === p.studentId);
      if (enr) {
        // the refunded student's referrer never earned this commission — money
        // subject to change was not yet theirs (and any vested amount is
        // clawed back on the next vest run)
        forfeitReferral(enr, 'referred student refunded');
        enr.state = 'REFUNDED';
        enr.progress = enr.progress || {};
        enr.progress.refunded = true;
        enr.resolution = Object.assign({}, enr.resolution || {}, {
          refundedAt: nowIso,
          materialRevoked: true,
          reapplyEligibleAt: new Date(Date.now() + cooldownMs).toISOString(),
        });
        audit(enr, 'REFUND_EXECUTED', 'Refund paid in batch ' + batchId + ' — all material rights revoked. Identity re-enrollment blocked until ' + fmtDateShort(enr.resolution.reapplyEligibleAt));
        revoked.push(p.email);
      }
    });
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ at: nowIso, batchId, count: queued.length, total, note: 'Consolidated payout batch processed via PayPal Payouts (one transfer run — demo simulates the API)' + (revoked.length ? ' · ' + revoked.length + ' enrollment(s) moved to REFUNDED with material rights revoked' : '') });
    secEvent('REFUND_BATCH', batchId + ' — ' + queued.length + ' refund(s) paid, ' + money(total, 'R') + ' · rights revoked for ' + revoked.length);
    save();
    return { processed: queued.length, batchId, total, revoked: revoked.length };
  }
  function auditLog() { return (state.auditLog || []).slice().reverse(); }

  /* ============================================================
     AWARDS & GIVEAWAYS — the wallet as the academy's value centre
     ------------------------------------------------------------
     Prize money (ceremony awards like Head Boy / Head Girl, giveaway
     pots) lands directly in student RFX wallets. Three rules keep
     this sound:
       1. Award money does NOT expire (unlike refund credits) — it is
          earned, not compensation.
       2. Every award is idempotent: a unique reference means the
          money moves exactly once, no matter how many times the
          ceremony record is re-submitted.
       3. Giveaway draws are provably fair: a crypto-random shuffle
          over a defined eligible pool, with the pool size and winners
          recorded in the draw record for the audit trail.
     ============================================================ */
  function awardEmail(w, amount, opts) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(w.name || w.email) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Congratulations — you are a winner at Reality FX.</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<b>' + escHtml(opts.reason || 'Academy award') + '</b><br/>' +
      '<span style="font-size:22px;color:#a8842a;font-weight:700;">' + money(amount, w.currency) + '</span> credited to your RFX account' +
      '<br/><b>Wallet:</b> ' + w.walletNo + ' · <b>New balance:</b> ' + money(w.balance, w.currency) + '</div>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444;margin-top:16px;">Prize money never expires — it stays in your wallet and can be applied to any Reality FX course, mentorship, or transferred to a family member\'s seat.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Reference: ' + escHtml(opts.reference || '') + '</p>' + footerHtml();
  }

  /* Credit prize money to one or more students. Idempotent on `reference`. */
  function issueAward(opts) {
    const ref = String(opts.reference || '').trim();
    if (!ref) return { ok: false, msg: 'Every award needs a unique reference — that is what stops a double payment.' };
    state.awards = state.awards || {};
    if (state.awards[ref]) return { ok: false, already: true, msg: 'Award ' + ref + ' was already paid. The money moves exactly once — re-submitting is a no-op.' };
    const recipients = (opts.recipients || []).filter(r => r && r.email && Number(r.amount) > 0);
    if (!recipients.length) return { ok: false, msg: 'No valid recipients.' };
    const credited = [];
    recipients.forEach(r => {
      const w = getWallet(r.email);
      const enr = (state.enrollments || []).find(e => e.payment.email === r.email);
      if (!w.name && enr) w.name = enr.payment.customerName;
      const amount = Number(r.amount);
      w.balance += amount;
      // awards never expire — they are earned, not compensation
      w.ledger.push({ at: now(), type: 'award', amount, ref, note: opts.reason || 'Academy award', source: opts.source || 'ceremony' });
      credited.push({ email: r.email, name: w.name, amount, walletNo: w.walletNo, balance: w.balance });
      if (enr) audit(enr, 'AWARD_CREDITED', money(amount, w.currency) + ' · ' + (opts.reason || 'Award') + ' (ref ' + ref + ')');
      email('award', r.email, 'You won ' + money(amount, w.currency) + ' — Reality FX', awardEmail(w, amount, opts));
    });
    const total = credited.reduce((s, c) => s + c.amount, 0);
    state.awards[ref] = { reference: ref, at: now(), by: opts.by || 'Staff', reason: opts.reason || 'Academy award', source: opts.source || 'ceremony', total, recipients: credited };
    secEvent('AWARD_PAID', ref + ' — ' + credited.length + ' recipient(s), ' + money(total, 'R') + ' credited to student wallets');
    save();
    return { ok: true, reference: ref, recipients: credited, total };
  }

  /* Fair giveaway draw: crypto-random shuffle over the ACTIVE pool. */
  function runGiveaway(opts) {
    const count = Math.max(1, parseInt(opts.winnerCount, 10) || 1);
    const amount = Number(opts.amountEach);
    if (!(amount > 0)) return { ok: false, msg: 'Enter a prize amount per winner.' };
    const pool = (state.enrollments || []).filter(e => e.state === 'ACTIVE' && e.payment && e.payment.email);
    if (pool.length < count) return { ok: false, msg: 'Only ' + pool.length + ' active student(s) — a draw of ' + count + ' needs at least that many. Activate more students first.' };
    const shuffled = pool.slice();
    const rnd = new Uint32Array(shuffled.length);
    crypto.getRandomValues(rnd);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
    }
    const winners = shuffled.slice(0, count);
    state.seq.giveaway = (state.seq.giveaway || 0) + 1;
    const reference = 'GIVEAWAY-' + String(state.seq.giveaway).padStart(4, '0');
    const title = (opts.title || 'Reality FX giveaway').trim();
    const res = issueAward({
      recipients: winners.map(w => ({ email: w.payment.email, amount })),
      reason: title, reference, by: opts.by || 'Staff', source: 'giveaway',
    });
    if (!res.ok) return res;
    state.giveaways = state.giveaways || [];
    state.giveaways.push({
      id: reference, title, amountEach: amount, winnerCount: count,
      poolSize: pool.length, drawnAt: now(), by: opts.by || 'Staff',
      winners: res.recipients, total: res.total,
    });
    save();
    return { ok: true, reference, title, winners: res.recipients, poolSize: pool.length, total: res.total };
  }
  function giveaways() { return (state.giveaways || []).slice().reverse(); }
  function awardsList() {
    return Object.keys(state.awards || {}).map(k => state.awards[k])
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }

  /* ============================================================
     REFERRAL MARKETING — where every student comes from, and how
     students earn by growing the academy.
     ------------------------------------------------------------
     The founder's rule — "money subject to change isn't yours yet"
     — is the whole engine:

       1. ACCRUE   the referred student goes ACTIVE       → commission tracked
       2. VEST     they survive the refund window         → commission payable
       3. FORFEIT  they refund / never activate           → commission dies
       4. CLAWBACK they are banned within clawbackDays    → paid commission returns

     Single-level payout (the family tree is tracked for analytics
     and responsibility, but only direct referrals earn) so the
     program can never drift into pyramid territory.
     ============================================================ */
  function referralConfig() { return state.referral || {}; }

  /* Tier = rate for the referrer's CURRENT active-referral count. */
  function referralTier(activeCount) {
    const tiers = (state.referral && state.referral.tiers) || [{ min: 0, rate: 15 }];
    let rate = tiers[0].rate;
    tiers.forEach(t => { if (activeCount >= t.min) rate = t.rate; });
    return { rate, activeCount };
  }

  /* Every referral record for a referrer (as the referrer sees it). */
  function referralRecords(referrerId) {
    const id = referrerId;
    return (state.referrals || []).filter(r => r.referrerId === id).slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }

  /* The family tree beneath a referrer — every enrollment that came in
     through their code, one level deep (plus their own referredBy link). */
  function referralNetwork(referrerId) {
    return (state.enrollments || [])
      .filter(e => e.referredBy && (e.referredBy.referredBy === referrerId))
      .map(e => ({ id: e.id, studentId: e.studentId, name: e.payment.customerName, email: e.payment.email, state: e.state, code: e.referralCode, at: e.createdAt }));
  }

  /* One-line summary for the member panel + SRM. */
  function referralStats(referrerId) {
    const recs = referralRecords(referrerId);
    const count = s => recs.filter(r => r.status === s).length;
    const sum = s => recs.filter(r => r.status === s).reduce((t, r) => t + r.amount, 0);
    const activeRefs = recs.filter(r => r.status === 'accrued' || r.status === 'vested' || r.status === 'paid').length;
    const tier = referralTier(activeRefs);
    const tierUpAt = nextTierAt(activeRefs);
    return {
      sent: recs.length,
      active: activeRefs,
      accrued: count('accrued'),
      vested: count('vested'),
      paid: count('paid'),
      forfeited: count('forfeited'),
      pendingAmount: sum('accrued') + sum('vested'),
      paidAmount: sum('paid'),
      totalEarned: sum('accrued') + sum('vested') + sum('paid'),
      rate: tier.rate,
      nextRate: tierUpAt ? referralTier(tierUpAt).rate : tier.rate,
      tierUpAt,
    };
  }
  function nextTierAt(activeCount) {
    const tiers = (state.referral && state.referral.tiers) || [];
    for (let i = 0; i < tiers.length; i++) {
      if (activeCount < tiers[i].min) return tiers[i].min;
    }
    return null;
  }

  /* ACCRUE — called when the referred student reaches ACTIVE. Creates the
     commission record with the referrer's current tier rate. Idempotent by
     referred student: one referral = one commission, forever. */
  function accrueReferralCommission(referredEnr) {
    const ref = state.referral || {};
    if (ref.enabled === false) return { ok: false, msg: 'Referral programme is off.' };
    const attr = referredEnr.referredBy;
    if (!attr) return { ok: false, msg: 'No referral attribution.' };
    // Attribution may have been frozen as the enrollment id (before the referrer
    // was approved) or as the student id — resolve by either, never silently
    // lose a commission because the referrer's ID changed between the two.
    const referrer = (state.enrollments || []).find(e => e.id === attr.referredBy || e.studentId === attr.referredBy);
    if (!referrer) return { ok: false, msg: 'Referrer not found.' };
    if (referrer.state !== 'ACTIVE') return { ok: false, msg: 'Referrer is not an ACTIVE student — commission not accrued.' };
    state.referrals = state.referrals || [];
    if ((state.referrals || []).some(r => r.referredEnrId === referredEnr.id)) return { ok: false, already: true, msg: 'Commission already exists for this referral.' };
    const activeCount = state.referrals.filter(r => r.referrerId === (referrer.studentId || referrer.id) && (r.status === 'accrued' || r.status === 'vested' || r.status === 'paid')).length;
    const { rate } = referralTier(activeCount);
    const amount = Math.round(referredEnr.payment.price * rate) / 100;
    const rec = {
      id: 'REF-' + String((state.seq.referral || 0) + 1).padStart(4, '0'),
      referrerId: referrer.studentId || referrer.id,
      referrerEmail: referrer.payment.email,
      referredEnrId: referredEnr.id,
      referredStudentId: referredEnr.studentId || null,
      referredName: referredEnr.payment.customerName,
      referredEmail: referredEnr.payment.email,
      course: referredEnr.payment.course,
      price: referredEnr.payment.price,
      rate, amount,
      status: 'accrued',
      at: now(),
      vestedAt: null, paidAt: null, forfeitedAt: null, reason: null,
    };
    state.seq.referral = (state.seq.referral || 0) + 1;
    state.referrals.push(rec);
    audit(referredEnr, 'REFERRAL_ACCRUED', rec.id + ' — ' + money(amount, referredEnr.payment.currency) + ' commission accrued for ' + (referrer.payment.customerName) + ' at ' + rate + '% (vests after ' + ((state.referral && state.referral.vestingDays) || 30) + ' days, forfeits on refund)');
    secEvent('REFERRAL_ACCRUED', rec.id + ' · ' + money(amount, referredEnr.payment.currency) + ' → ' + referrer.payment.email);
    save();
    return { ok: true, record: rec };
  }

  /* VEST — a batch: any accrued commission whose referred student has been
     ACTIVE for the vesting window (and did not refund) becomes payable.
     Returns how many vested. */
  function vestReferralCommissions() {
    const ref = state.referral || {};
    const days = ref.vestingDays || 30;
    const windowMs = days * 86400 * 1000;
    const nowMs = Date.now();
    let n = 0;
    (state.referrals || []).forEach(r => {
      if (r.status !== 'accrued') return;
      const referred = (state.enrollments || []).find(e => e.id === r.referredEnrId);
      if (!referred) { r.status = 'forfeited'; r.reason = 'referred student record removed'; r.forfeitedAt = now(); return; }
      // a refund at ANY point kills the commission — money subject to change
      if (referred.state === 'REFUNDED' || (referred.resolution && referred.resolution.materialRevoked)) {
        r.status = 'forfeited'; r.reason = 'referred student refunded'; r.forfeitedAt = now(); return;
      }
      const activeAt = referred.progress && referred.progress.activeAt ? new Date(referred.progress.activeAt).getTime() : null;
      if (!activeAt) return; // not actually active yet — keep waiting
      if (nowMs - activeAt >= windowMs) {
        r.status = 'vested'; r.vestedAt = now();
        audit(referred, 'REFERRAL_VESTED', r.id + ' — ' + money(r.amount, referred.payment.currency) + ' commission vested (survived the ' + days + '-day refund window)');
        n++;
      }
    });
    if (n) secEvent('REFERRALS_VESTED', n + ' commission' + (n === 1 ? '' : 's') + ' vested');
    save();
    return { vested: n };
  }

  /* PAY — pay all vested commissions into referrer wallets, idempotently
     (each record is marked paid in the same save). */
  function payReferralCommissions() {
    const vested = (state.referrals || []).filter(r => r.status === 'vested');
    if (!vested.length) return { paid: 0 };
    const credited = [];
    vested.forEach(r => {
      const w = getWallet(r.referrerEmail);
      if (!w.name) {
        const ref = (state.enrollments || []).find(e => (e.studentId || e.id) === r.referrerId);
        if (ref) w.name = ref.payment.customerName;
      }
      w.balance += r.amount;
      w.ledger.push({ at: now(), type: 'referral', amount: r.amount, ref: r.id, note: 'Referral commission · ' + r.referredName + ' · ' + r.rate + '% tier' });
      r.status = 'paid'; r.paidAt = now();
      credited.push({ email: r.referrerEmail, amount: r.amount, ref: r.id });
      email('referral', r.referrerEmail, 'Your Reality FX referral commission is in', referralEmail(r));
    });
    const total = credited.reduce((s, c) => s + c.amount, 0);
    secEvent('REFERRALS_PAID', credited.length + ' commission' + (credited.length === 1 ? '' : 's') + ' paid, ' + money(total, 'R'));
    save();
    return { paid: credited.length, total, credited };
  }

  /* FORFEIT — a single referral dies (used when a referred student refunds). */
  function forfeitReferral(referredEnr, reason) {
    const rec = (state.referrals || []).find(r => r.referredEnrId === referredEnr.id && (r.status === 'accrued' || r.status === 'vested'));
    if (!rec) return { ok: false, msg: 'No active commission on this referral.' };
    rec.status = 'forfeited';
    rec.forfeitedAt = now();
    rec.reason = reason || 'referred student refunded';
    audit(referredEnr, 'REFERRAL_FORFEITED', rec.id + ' — ' + money(rec.amount, referredEnr.payment.currency) + ' commission forfeited (' + rec.reason + ') — money subject to change is not yet earned');
    secEvent('REFERRAL_FORFEITED', rec.id + ' · ' + rec.reason);
    save();
    return { ok: true, record: rec };
  }

  /* CLAWBACK — a referred student is banned within the clawback window: any
     commission already paid is deducted back from the referrer's wallet.
     Idempotent: a record is marked clawedAt the first time, so a second call
     never deducts the same commission twice. The ledger records exactly what
     was actually recovered (never more than the wallet holds). */
  function clawbackReferral(referredEnr, reason) {
    const rec = (state.referrals || []).find(r => r.referredEnrId === referredEnr.id);
    if (!rec) return { ok: false, msg: 'No referral record.' };
    if (rec.clawedAt) return { ok: true, clawed: 0, msg: 'Already clawed back.' };
    if (rec.status === 'paid' && rec.paidAt) {
      const w = getWallet(rec.referrerEmail);
      const paid = new Date(rec.paidAt).getTime();
      const clawMs = ((state.referral && state.referral.clawbackDays) || 90) * 86400 * 1000;
      if (Date.now() - paid < clawMs) {
        const recovered = Math.min(rec.amount, w.balance);
        w.balance = Math.max(0, w.balance - recovered);
        if (recovered > 0) {
          w.ledger.push({ at: now(), type: 'clawback', amount: -recovered, ref: rec.id, note: 'Clawback · ' + (reason || 'referred student banned') });
          audit(referredEnr, 'REFERRAL_CLAWBACK', rec.id + ' — ' + money(recovered, referredEnr.payment.currency) + ' recovered from referrer wallet (' + (reason || 'banned') + ')');
          secEvent('REFERRAL_CLAWBACK', rec.id + ' · ' + money(recovered, referredEnr.payment.currency) + ' recovered');
        }
        rec.clawedAt = now();
        rec.clawedAmount = recovered;
        save();
        return { ok: true, clawed: recovered, msg: recovered < rec.amount ? 'Partially recovered — referrer wallet had insufficient funds.' : undefined };
      }
    }
    return { ok: true, clawed: 0 };
  }

  /* Staff analytics — where the marketing budget should go. */
  function referralAnalytics() {
    const recs = state.referrals || [];
    const byRef = {};
    recs.forEach(r => {
      byRef[r.referrerId] = byRef[r.referrerId] || { referrerId: r.referrerId, email: r.referrerEmail, sent: 0, accrued: 0, vested: 0, paid: 0, forfeited: 0, total: 0 };
      const b = byRef[r.referrerId];
      b.sent++;
      if (r.status === 'accrued') b.accrued++;
      if (r.status === 'vested') b.vested++;
      if (r.status === 'paid') { b.paid++; b.total += r.amount; }
      if (r.status === 'forfeited') b.forfeited++;
    });
    const rows = Object.keys(byRef).map(k => {
      const b = byRef[k];
      const enr = (state.enrollments || []).find(e => (e.studentId || e.id) === k);
      return Object.assign({ name: enr ? enr.payment.customerName : k }, b, {
        // a referrer's reliability = how many of their referrals survived
        survivalRate: b.sent ? Math.round(((b.sent - b.forfeited) / b.sent) * 100) : 100,
      });
    }).sort((a, b) => b.total - a.total || b.sent - a.sent);
    const totals = {
      sent: recs.length,
      accrued: recs.filter(r => r.status === 'accrued').length,
      vested: recs.filter(r => r.status === 'vested').length,
      paid: recs.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0),
      forfeited: recs.filter(r => r.status === 'forfeited').length,
    };
    return { rows, totals };
  }

  function referralEmail(rec) {
    const name = rec.referredName || 'a friend';
    return '<div style="font-family:Arial,sans-serif;background:#0d0d0c;color:#fff;padding:30px;">' +
      '<div style="max-width:520px;margin:0 auto;">' +
      brandHtml() +
      '<h2 style="color:#f0d98c;font-family:Georgia,serif;">Your referral commission is in</h2>' +
      '<p style="color:#a7a7a7;">' + escHtml(name) + '\'s enrolment has fully locked in — they survived the refund window, so the money is no longer subject to change. <b style="color:#fff;">' + money(rec.amount, 'R') + '</b> has been added to your RFX account at your ' + rec.rate + '% tier.</p>' +
      '<p style="color:#6f6f6b;font-size:12px;">Keep sharing your code — the more students you bring, the higher your tier climbs (up to 30%).</p>' +
      footerHtml() + '</div></div>';
  }

  /* ============================================================
     REDEMPTION — spending the wallet (the spend rail)
     ------------------------------------------------------------
     The wallet is a payment method, not a store. The website store
     (and academy services like mentorship / seat transfers) deduct
     from it through this single idempotent rail:
       redeemCredit({ email, amount, itemName, itemRef, by })
     Rules:
       - Only NON-EXPIRED value is spendable (expired refund credits
         are not real money).
       - A unique transaction reference means a purchase can never
         double-deduct (same idempotency religion as the OS bridge).
       - Spend is ledgered, audited, emailed and security-logged.
     ============================================================ */
  function spendable(email) {
    const w = getWallet(email);
    const nowMs = Date.now();
    let expiredHeld = 0;
    (w.ledger || []).forEach(e => {
      if (e.type === 'credit' && e.expiresAt && new Date(e.expiresAt).getTime() <= nowMs) expiredHeld += e.amount;
    });
    return Math.max(0, w.balance - expiredHeld);
  }

  function redeemCredit(opts) {
    const mail = String(opts.email || '').trim().toLowerCase();
    const amount = Number(opts.amount);
    if (!mail || !(amount > 0)) return { ok: false, msg: 'A recipient email and a positive amount are required.' };
    const w = getWallet(mail);
    const usable = spendable(mail);
    if (amount > usable) {
      return { ok: false, msg: 'Not enough spendable credit — this wallet has ' + money(usable, w.currency) + ' available (expired credits are not spendable).' };
    }
    // idempotency: the store's order reference can only ever redeem once
    const reference = String(opts.reference || '').trim() || ('REDEEM-' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'));
    if (reference && state.redemptions && state.redemptions[reference]) {
      return { ok: false, already: true, msg: 'Redemption ' + reference + ' was already applied — a purchase can never deduct twice.' };
    }
    state.redemptions = state.redemptions || {};
    const itemName = opts.itemName || 'Reality FX service';
    w.balance = Math.max(0, w.balance - amount);
    w.ledger.push({ at: now(), type: 'redeem', amount: -amount, ref: reference, note: itemName });
    state.redemptions[reference] = { reference, at: now(), email: mail, amount, itemName, itemRef: opts.itemRef || '', by: opts.by || 'Student', balance: w.balance };
    const enr = (state.enrollments || []).find(e => e.payment.email === mail);
    if (enr) audit(enr, 'CREDIT_REDEEMED', money(amount, w.currency) + ' applied to ' + itemName + ' (ref ' + reference + ')');
    secEvent('CREDIT_REDEEMED', reference + ' — ' + money(amount, w.currency) + ' spent on ' + itemName + ' · ' + mail);
    email('redeem', mail, 'Your Reality FX credit was applied — ' + money(amount, w.currency), redeemEmail(w, amount, itemName, reference));
    save();
    return { ok: true, reference, balance: w.balance, spendable: spendable(mail) };
  }

  /* Cash-out rail — prize money (awards, giveaway winnings) can be collected
     as real money. Same consolidated monthly batch as refunds (one PayPal
     Payouts run, one fee), but it NEVER revokes material rights or touches
     the student's enrollment — it is their own earned money leaving the
     wallet, not a purchase reversal. Deducted from the wallet the moment the
     request is queued (money is either in the wallet or in the batch, never
     both), ledgered, audited, emailed, idempotent by reference. */
  function requestCashout(mailAddr, amount, opts) {
    const mail = String(mailAddr || '').trim().toLowerCase();
    amount = Number(amount);
    if (!mail || !(amount > 0)) return { ok: false, msg: 'An email and a positive amount are required.' };
    const w = getWallet(mail);
    const usable = spendable(mail);
    if (amount > usable) {
      return { ok: false, msg: 'Not enough spendable balance — this wallet has ' + money(usable, w.currency) + ' available.' };
    }
    if (amount < 50) return { ok: false, msg: 'Minimum cash-out is ' + money(50, w.currency) + ' — small balances are better kept as credit.' };
    const reference = String((opts && opts.reference) || '').trim() || ('CASHOUT-' + Date.now());
    state.redemptions = state.redemptions || {};
    if (state.redemptions[reference]) return { ok: false, already: true, msg: 'Cash-out ' + reference + ' was already requested — it can never be requested twice.' };
    state.redemptions[reference] = { reference, at: now(), email: mail, amount, itemName: 'Cash-out request', by: (opts && opts.by) || 'Student' };
    const enr = (state.enrollments || []).find(e => e.payment.email === mail);
    const risk = enr ? refundRiskScore(enr) : { score: 0, signals: [], flagged: false };
    state.payouts = state.payouts || [];
    const payout = {
      id: nextId('payout', 'PO-', 5),
      at: now(), amount, currency: w.currency,
      email: mail, name: w.name || mail,
      // NO studentId, NO enrollmentId: a cash-out is NOT a refund — the batch
      // must never match it back to an enrollment and revoke anything
      studentId: null,
      enrollmentId: null,
      kind: 'cashout',
      rail: 'paypal', status: 'queued', batchId: null, paidAt: null,
      riskScore: risk.score, riskSignals: risk.signals, riskFlagged: risk.flagged,
    };
    state.payouts.push(payout);
    w.balance = Math.max(0, w.balance - amount);
    w.ledger.push({ at: now(), type: 'cashout', amount: -amount, ref: reference, note: 'Cash-out request — ' + payout.id });
    if (enr) audit(enr, 'CASHOUT_QUEUED', money(amount, w.currency) + ' cash-out queued (' + payout.id + ') · risk ' + risk.score);
    secEvent('CASHOUT_QUEUED', reference + ' — ' + money(amount, w.currency) + ' · ' + mail + ' · risk ' + risk.score);
    email('cashout', mail, 'Your Reality FX cash-out is queued',
      brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(w.name || mail) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your cash-out of <b>' + money(amount, w.currency) + '</b> is queued and will be paid in the monthly consolidated batch via PayPal Payouts. Your wallet balance was reduced by this amount.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<tr><td style="padding:6px 0;color:#888;">Cash-out reference</td><td style="text-align:right;font-family:monospace;">' + reference + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Wallet balance now</td><td style="text-align:right;font-weight:600;">' + money(w.balance, w.currency) + '</td></tr></table>' + footerHtml());
    save();
    return { ok: true, payout, reference, balance: w.balance };
  }

  function redeemEmail(w, amount, itemName, reference) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(w.name || w.email) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your RFX account credit was applied to <b>' + escHtml(itemName) + '</b>.</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      'Amount applied: <b style="color:#a8842a;font-size:17px;">' + money(amount, w.currency) + '</b><br/>' +
      'Remaining balance: ' + money(w.balance, w.currency) + '<br/>Reference: ' + escHtml(reference) + '</div>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Thank you — Reality FX.</p>' + footerHtml();
  }

  /* ============================================================
     MERCH — earned rewards & merch purchases (shared fulfilment queue)
     ------------------------------------------------------------
     Two very different objects, one queue:
       • EARNED (free tee + hoody for 80%+ average) — a REWARD, signalled by
         RFX OS as a bridge achievement event. Idempotent by reference: one
         claim per achievement, ever. It is a fulfilment obligation, never
         credit — it cannot expire or be converted to cash.
       • PURCHASED (with wallet credit) — a normal transaction on the spend
         rail, but physical goods need size + address, so it becomes an order.
     Both land in state.merch.orders and flow through the fulfilment workflow:
         collecting -> packing -> shipped -> delivered
     ============================================================ */
  const MERCH_STATUSES = ['collecting', 'packing', 'shipped', 'delivered'];
  const MERCH_STATUS_LABELS = { collecting: 'Collecting size / address', packing: 'Packing', shipped: 'Shipped', delivered: 'Delivered' };

  function nextMerchId() {
    state.seq.merch = (state.seq.merch || 0) + 1;
    return 'MERCH-' + String(state.seq.merch).padStart(4, '0');
  }

  function merchOrders() {
    return (state.merch && state.merch.orders || []).slice().sort((a, b) => (a.at || '').localeCompare(b.at || '')).reverse();
  }
  function merchByEmail(email) {
    const m = String(email || '').trim().toLowerCase();
    return (state.merch && state.merch.orders || []).filter(o => o.email === m);
  }
  function merchAchievementFor(studentId) {
    // newest outstanding earned order first — a multi-season student fulfils the latest reward
    return (state.merch && state.merch.orders || [])
      .filter(o => o.kind === 'earned' && o.studentId === studentId && !o.deliveredAt)
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      .pop() || null;
  }

  function merchEmail(w, order, subject) {
    const lines = order.items.map(it => '• ' + escHtml(it.name) + (it.size ? ' (size ' + escHtml(it.size) + ')' : '')).join('<br/>');
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(order.name || w.name || w.email) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">' + escHtml(subject) + '</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      'Order <b>' + order.id + '</b><br/>' + lines +
      (order.total > 0 ? '<br/>Paid from RFX balance: <b style="color:#a8842a;">' + money(order.total, 'R') + '</b>' : '<br/>Status: <b>Earned — free reward</b>') +
      '</div>' + footerHtml();
  }

  /* EARNED — bridge event from RFX OS: "this student averaged >= threshold".
     Idempotent by reference so a hiccupped request can never double-claim. */
  function claimAchievementMerch(opts) {
    const reference = String(opts.reference || '').trim();
    const studentId = String(opts.studentId || '').trim();
    const average = Number(opts.average);
    if (!reference || !studentId || !(average >= 0)) return { ok: false, msg: 'An achievement needs a reference, a Student ID and an average.' };
    state.merch = state.merch || { orders: [], claims: {} };
    state.merch.claims = state.merch.claims || {};
    if (state.merch.claims[reference]) {
      return { ok: false, already: true, msg: 'Achievement ' + reference + ' was already claimed — the reward is one-time.' };
    }
    const enr = (state.enrollments || []).find(e => e.studentId === studentId);
    if (!enr) return { ok: false, msg: 'No student with ID ' + studentId + ' — the achievement cannot attach to an unknown identity.' };
    const threshold = (state.merch.achievementThreshold != null) ? state.merch.achievementThreshold : 80;
    if (average < threshold) {
      return { ok: false, msg: 'Average ' + average + '% is below the ' + threshold + '% threshold — no reward earned.' };
    }
    const w = getWallet(enr.payment.email);
    const items = [
      { code: 'RFX-MERCH-TEE', name: 'Reality FX T-shirt', size: null, price: 0 },
      { code: 'RFX-MERCH-HOODY', name: 'Reality FX Hoody', size: null, price: 0 },
    ];
    const order = {
      id: nextMerchId(),
      kind: 'earned',
      email: enr.payment.email,
      studentId,
      name: w.name || enr.payment.customerName,
      items,
      total: 0,
      status: 'collecting',
      address: null,
      reference,
      average,
      at: now(),
      history: [{ at: now(), status: 'collecting', note: 'Achievement ' + reference + ' — average ' + average + '%' }],
    };
    state.merch.orders.push(order);
    state.merch.claims[reference] = order.id;
    audit(enr, 'MERCH_EARNED', 'Reward earned — average ' + average + '% (ref ' + reference + '). Free tee + hoody queued for fulfilment.');
    secEvent('MERCH_EARNED', reference + ' — ' + studentId + ' earned the 80%+ reward');
    email('merch-earned', enr.payment.email, 'You earned the Reality FX reward — ' + enr.payment.customerName, merchEmail(w, order, 'Congratulations — you earned the Reality FX tee + hoody reward.'));
    save();
    return { ok: true, order };
  }

  /* PURCHASED — the student buys merch with wallet credit. Uses the spend
     rail for the money and creates a fulfilment order for the goods. */
  function purchaseMerch(opts) {
    const mail = String(opts.email || '').trim().toLowerCase();
    const code = String(opts.code || '').trim().toUpperCase();
    const size = String(opts.size || '').trim();
    const address = String(opts.address || '').trim();
    const item = (state.catalog || []).find(x => x.kind === 'merch' && x.code === code);
    if (!item) return { ok: false, msg: 'Unknown merch code ' + code + ' — the catalog is the price source of truth.' };
    const w = getWallet(mail);
    if (!size || !address) return { ok: false, msg: 'Merch is physical — a size and a delivery address are required.' };
    const reference = String(opts.reference || '').trim() || ('MERCH-' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'));
    // Money moves FIRST, order second. redeemCredit saves on success; if the
    // redeem fails we return before ever creating the order — a failed
    // purchase can never leave a ghost order in the queue (a save inside the
    // redeem, e.g. creating a new wallet, must never persist an order that
    // didn't actually happen).
    const redeem = redeemCredit({ email: mail, amount: item.price, itemName: item.name, itemRef: code, reference, by: opts.by || 'Student' });
    if (!redeem.ok) return redeem;
    const order = {
      id: nextMerchId(),
      kind: 'purchased',
      email: mail,
      studentId: null,
      name: w.name || w.email,
      items: [{ code, name: item.name, size, price: item.price }],
      total: item.price,
      status: 'collecting',
      address,
      reference,
      at: now(),
      history: [{ at: now(), status: 'collecting', note: 'Paid ' + money(item.price, 'R') + ' from RFX balance' }],
    };
    state.merch.orders.push(order);
    const enr = (state.enrollments || []).find(e => e.payment.email === mail);
    if (enr) audit(enr, 'MERCH_ORDERED', item.name + ' (size ' + size + ') · ' + money(item.price, 'R') + ' · ' + order.id);
    secEvent('MERCH_ORDERED', order.id + ' — ' + item.name + ' · ' + mail + ' · ' + money(item.price, 'R'));
    email('merch-order', mail, 'Your Reality FX merch order — ' + item.name, merchEmail(w, order, 'Your merch order ' + order.id + ' is confirmed and moving to fulfilment.'));
    save();
    return { ok: true, order, balance: redeem.balance };
  }

  /* The student locks in sizes + address on their earned reward. */
  function fulfilMerchReward(studentId, sizes, address) {
    const order = merchAchievementFor(studentId);
    if (!order) return { ok: false, msg: 'No pending reward to fulfil for this student.' };
    if (!sizes || !sizes.shirt || !sizes.hoody) return { ok: false, msg: 'Both sizes are required.' };
    if (!String(address || '').trim()) return { ok: false, msg: 'A delivery address is required.' };
    order.items[0].size = sizes.shirt;
    order.items[1].size = sizes.hoody;
    order.address = String(address).trim();
    secEvent('MERCH_REWARD_FULFILLED', order.id + ' — sizes locked (' + sizes.shirt + '/' + sizes.hoody + '), address set');
    save();
    return { ok: true, order };
  }

  /* The student acknowledges their earned reward — the celebration plays once,
     then the size pickers appear. Marking it seen is a pure UI flag. */
  function celebrateMerch(studentId) {
    const order = merchAchievementFor(studentId);
    if (!order) return { ok: false, msg: 'No earned reward to celebrate.' };
    order.celebratedAt = now();
    save();
    return { ok: true, order };
  }

  /* Fulfilment workflow: collecting -> packing -> shipped -> delivered. */
  function advanceMerch(orderId) {
    const order = (state.merch && state.merch.orders || []).find(o => o.id === orderId);
    if (!order) return { ok: false, msg: 'No merch order ' + orderId + '.' };
    const idx = MERCH_STATUSES.indexOf(order.status);
    if (idx === -1 || idx === MERCH_STATUSES.length - 1) return { ok: false, msg: order.id + ' is already ' + (MERCH_STATUS_LABELS[order.status] || order.status) + '.' };
    const next = MERCH_STATUSES[idx + 1];
    order.status = next;
    if (next === 'delivered') order.deliveredAt = now();
    order.history.push({ at: now(), status: next, note: '' });
    if (next === 'shipped') {
      email('merch-shipped', order.email, 'Your Reality FX merch is on the way — ' + order.id, merchEmail(getWallet(order.email), order, 'Good news — order ' + order.id + ' has shipped.'));
    }
    secEvent('MERCH_STATUS', order.id + ' → ' + next);
    save();
    return { ok: true, order };
  }

  /* ============================================================
     RE-APPLICATION — fixable rejections get a second chance
     ------------------------------------------------------------
     Staff mark a rejection as FIXABLE (student may correct + re-apply
     within N days, up to M attempts) or FINAL (resolution only). Most
     rejections are fixable — a blurry selfie or a typo shouldn't force
     a refund. The full rejection history is kept for the audit trail.
     ============================================================ */
  function canReapply(enr) {
    if (!enr || enr.state !== 'REJECTED') return { ok: false, reason: 'Only rejected registrations can re-apply.' };
    const reg = enr.registration || {};
    const last = reg.decision || {};
    // an executed resolution (credit issued / refund queued) closes re-application:
    // the money already moved, so the identity can't also re-enter as a student
    if (enr.resolution && enr.resolution.executedAt) {
      return { ok: false, reason: 'This enrollment has already been resolved — re-application is closed after a credit or refund is executed.' };
    }
    if (last.fixable === false) return { ok: false, reason: 'This rejection is final — Reality FX will not accept a re-application.' };
    const cfg = state.reapplication || {};
    const max = cfg.maxAttempts || 2;
    if ((reg.reapplyCount || 0) >= max) return { ok: false, reason: 'The maximum number of re-application attempts has been reached.' };
    // the window runs from the last rejection (or the first re-apply) for windowDays
    const winMs = (cfg.windowDays || 7) * 86400 * 1000;
    const anchor = reg.reapplyBy ? new Date(reg.reapplyBy) : (last.at ? new Date(new Date(last.at).getTime() + winMs) : null);
    if (anchor && anchor.getTime() < Date.now()) return { ok: false, reason: 'The re-application window has closed.' };
    return { ok: true, attemptsLeft: max - (reg.reapplyCount || 0), reapplyBy: anchor ? anchor.toISOString() : null };
  }

  function reapply(enr) {
    const c = canReapply(enr);
    if (!c.ok) return c;
    const reg = enr.registration;
    const cfg = state.reapplication || {};
    reg.reapplyCount = (reg.reapplyCount || 0) + 1;
    reg.reappliedAt = now();
    reg.reapplyBy = new Date(Date.now() + (cfg.windowDays || 7) * 86400 * 1000).toISOString();
    // reopen the registration for corrections
    reg.submittedAt = null;
    reg.tokenUsedAt = null;
    reg.emailVerifiedAt = null;
    reg.captchaPassedAt = null;
    reg.verifyCode = makeVerifyCode();
    // clear any brute-force lock state so the reopened flow starts fresh
    reg.codeAttempts = 0;
    reg.codeLockedUntil = null;
    reg.captchaAttempts = 0;
    // The rejection was already recorded in reg.rejections by approve(); we only
    // clear the current decision so the panel reflects the reopened state.
    reg.decision = null;
    enr.state = 'PENDING';
    audit(enr, 'RE_APPLIED', 'Re-application attempt ' + reg.reapplyCount + ' — registration reopened for corrections');
    email('reapply', enr.payment.email, 'Your Reality FX re-application is open — ' + enr.payment.customerName, reapplyEmail(enr));
    save();
    return { ok: true };
  }

  function reapplyEmail(enr) {
    const reg = enr.registration || {};
    const lastReason = reg.rejections && reg.rejections.length
      ? reg.rejections[reg.rejections.length - 1].reason
      : 'the details provided could not be matched to your payment record';
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Good news — your registration can be corrected. Your secure link is open again and you may fix the following and re-submit:</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:14px 18px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' + escHtml(lastReason) + '</div>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444;margin-top:16px;">Re-application attempt <b>' + (reg.reapplyCount || 1) + '</b> — your payment stays with Reality FX throughout. Use the same link you received by email.</p>' + footerHtml();
  }

  function creditEmail(enr, wallet, amount) {
    const expiry = enr.resolution && enr.resolution.expiresAt;
    const expiryLine = expiry
      ? '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444;margin-top:16px;">This credit is valid until <b>' + fmtDateShort(expiry) + '</b> (' + ((state.credit && state.credit.validityMonths) || 24) + ' months from issue), as stated in the Refund &amp; Credit Policy you accepted at registration. It can be applied to another course, transferred to a family member\'s seat, or used toward mentorship sessions.</p>'
      : '';
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">We are sorry your registration for the Reality Academy could not be approved. ' +
      'As you chose, <b>' + money(amount, wallet.currency) + '</b> has been added to your <b>RFX account</b> — fee-free and available immediately.</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<b>RFX account balance:</b> <span style="font-size:17px;color:#a8842a;font-weight:700;">' + money(wallet.balance, wallet.currency) + '</span>' +
      (expiry ? '<br/><b>Valid until:</b> ' + fmtDateShort(expiry) : '') + '</div>' + expiryLine +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Reality FX · Refund &amp; Credit Policy v2.1</p>' + footerHtml();
  }

  function refundQueuedEmail(enr, payout) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">As you chose, your <b>' + money(payout.amount, payout.currency) + '</b> refund has been queued (reference <b class="mono">' + payout.id + '</b>).</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Cash refunds are paid through <b>PayPal</b> — international, fast, and no bank details required. They are processed in one consolidated batch each month to keep transfer costs to an absolute minimum. ' +
      'Where a fee applies, it is deducted from the refund as stated in the Refund &amp; Credit Policy v2.0 you accepted at registration.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Thank you for your understanding — Reality FX.</p>' + footerHtml();
  }

  /* ---------------- enrollments ---------------- */
  function enrollments() { return (state.enrollments || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
  function byId(id) { return (state.enrollments || []).find(e => e.id === id); }
  function byToken(token) { return (state.enrollments || []).find(e => e.registration && e.registration.token === token); }

  /* ------------------------------------------------------------
     PILLAR 1 — PURCHASE
     The payment system reports a confirmed sale. NO manual typing.
     ------------------------------------------------------------ */
  /* Trusted printing — an EARNED entitlement, never a default.
     Every OS page is watermarked and print is blacked out by default (see
     FOR-LEE 9.6). Printing course material is granted only to students who
     have earned the organisation's trust — granted by staff, not by being
     clever. The flag rides the handoff payload so the OS enforces it at the
     backend, not the frontend. */
  function printTrust(enr) {
    return (enr.printTrust && enr.printTrust.level) || 'standard';
  }
  function grantPrintTrust(enr, by, note) {
    enr.printTrust = {
      level: 'trusted',
      grantedAt: now(),
      grantedBy: by || 'Moderator',
      note: note || 'Earned trust — granted print access',
    };
    audit(enr, 'PRINT_TRUST_GRANTED', (by || 'Moderator') + ' granted print access (' + (note || 'earned trust') + ')');
    secEvent('PRINT_TRUST_GRANTED', (enr.studentId || enr.id) + ' — print access granted');
    save();
    return enr.printTrust;
  }
  function revokePrintTrust(enr, by, note) {
    const had = enr.printTrust;
    enr.printTrust = {
      level: 'standard',
      revokedAt: now(),
      revokedBy: by || 'Moderator',
      note: note || 'Trust revoked — print access withdrawn',
    };
    audit(enr, 'PRINT_TRUST_REVOKED', (by || 'Moderator') + ' revoked print access (' + (note || 'trust withdrawn') + ')' + (had && had.level === 'trusted' ? ' — previously granted ' + fmtDateShort(had.grantedAt) : ''));
    secEvent('PRINT_TRUST_REVOKED', (enr.studentId || enr.id) + ' — print access revoked');
    save();
    return enr.printTrust;
  }

  /* Identity-level cooldown: has this email/name/phone refunded recently?
     Returns null (clear) or { until, daysLeft, priorRefund }. */
  function refundCooldown(payment) {
    const email = String(payment.email || '').trim().toLowerCase();
    const name = String(payment.customerName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const phone = String((payment.phone) || '').replace(/[^+\d]/g, '');
    const cooldownMs = ((state.refund && state.refund.cooldownDays) || 30) * 86400 * 1000;
    // find the most recent executed refund matching this identity — a fresh
    // email + fresh name still links through the phone number.
    const paid = (state.payouts || [])
      .filter(p => p.status === 'paid' && (
        String(p.email || '').toLowerCase() === email ||
        String(p.name || '').toLowerCase().replace(/\s+/g, ' ') === name ||
        (phone && String(p.phone || '').replace(/[^+\d]/g, '') === phone)
      ))
      .sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
    if (!paid.length) return null;
    const last = paid[0];
    const until = new Date(new Date(last.paidAt).getTime() + cooldownMs);
    if (until.getTime() <= Date.now()) return null; // window passed
    return { until: until.toISOString(), daysLeft: Math.ceil((until.getTime() - Date.now()) / 86400000), priorRefund: last.id };
  }

  function createEnrollment(payment) {
    state.enrollments = state.enrollments || [];
    // PAYMENT-WEBHOOK IDEMPOTENCY — a retried payment confirmation (network
    // hiccup on the store side) must never create a second enrollment, second
    // invoice, or second registration link. The transaction ID is the
    // payment's own unique key: if we've already enrolled it, return the
    // existing record — the caller (admin UI / store webhook) treats it as
    // "already have this one", exactly like the OS bridge does with Student IDs.
    const txn = String(payment.transactionId || '').trim();
    if (txn) {
      const existing = (state.enrollments || []).find(e => e.payment.transactionId === txn);
      if (existing) return existing;
    }
    const id = nextId('enrollment', 'ENR-', 4);
    // Intelligence: if this identity is on a refund cooldown, flag the new
    // enrollment for the moderator — never silently accept, never hard-block
    // (a legitimate second chance must remain possible, reviewed).
    const cooldown = refundCooldown(payment);

    // REFERRAL ATTRIBUTION — where this student came from, captured at the
    // very first touchpoint (the ?ref= code on the website store). The code
    // resolves to an ACTIVE student; self-referral is refused; unknown codes
    // simply mean organic traffic. Attribution feeds the marketing-budget
    // decisions AND the commission engine.
    const refCode = String(payment.referralCode || '').trim().toUpperCase();
    const refLink = refCode ? (state.enrollments || []).find(e => e.referralCode === refCode) : null;
    const selfRef = refLink && (String(refLink.payment.email || '').toLowerCase() === String(payment.email || '').toLowerCase()
      || (payment.phone && refLink.payment.phone && String(refLink.payment.phone).replace(/[^+\d]/g, '') === String(payment.phone).replace(/[^+\d]/g, '')));
    const attribution = refLink && !selfRef ? {
      referredBy: refLink.studentId || refLink.id,
      referredByName: refLink.payment.customerName,
      code: refCode,
      at: now(),
    } : null;
    if (refCode && selfRef) secEvent('REFERRAL_SELF_REFUSED', 'Self-referral attempt refused · ' + payment.email);
    if (refCode && !refLink) secEvent('REFERRAL_UNKNOWN_CODE', 'Unknown referral code ' + refCode + ' · ' + payment.email);

    const enr = {
      id,
      cooldownFlag: cooldown ? { at: now(), ...cooldown } : null,
      referralCode: makeReferralCode(),   // this student's own shareable code
      referredBy: attribution,            // who brought this student in (or null = organic)
      studentId: null,            // generated at approval (Pillar 3)
      studentCode: null,
      createdAt: now(),
      state: 'PENDING',
      payment: {
        customerName: (payment.customerName || '').trim(),
        email: (payment.email || '').trim().toLowerCase(),
        course: payment.course || state.course.name,
        // price must be a positive number — a negative or NaN price would let
        // a refund or credit move money the wrong way. Fall back to the course
        // price rather than accept bad input.
        price: (function () {
          const p = Number(payment.price);
          return (isFinite(p) && p > 0) ? p : state.course.price;
        })(),
        currency: payment.currency || state.course.currency,
        transactionId: txn || 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
        paymentMethod: payment.paymentMethod || state.course.paymentMethods[0],
        // phone is optional at purchase (collected formally at registration),
        // but when present it strengthens the refund fingerprint immediately
        phone: String(payment.phone || '').trim(),
        paidAt: payment.paidAt || now(),
      },
      invoice: {
        number: 'INV-' + new Date().getFullYear() + '-' + String(state.seq.invoice + 1).padStart(4, '0'),
        issuedAt: now(),
        status: 'PAID',
      },
      registration: null,         // created when the student completes registration
      handoff: { attempts: [], confirmedAt: null, lastError: null },
      audit: [],
      // Pillar progress flags (filled in as the journey advances)
      progress: {
        purchase: true,
        invoiceEmail: false,
        registrationEmail: false,
        registrationSubmitted: false,
        approved: false,
        handoffConfirmed: false,
        active: false,
      },
    };
    state.seq.invoice += 1; // reserve the invoice number we just displayed
    state.enrollments.push(enr);
    audit(enr, 'ENROLLMENT_CREATED', 'Paid enrollment created from payment confirmation ' + enr.payment.transactionId);
    save();
    return enr;
  }

  /* ------------------------------------------------------------
     PILLAR 2 — REGISTRATION (invite)
     Invoice email, then registration email with a secure link.
     ------------------------------------------------------------ */
  function sendInviteEmails(enr) {
    const base = location.href.split('/').slice(0, -1).join('/');
    const regLink = base + '/register.html?token=' + enr.registration.token;

    // 1) INVOICE EMAIL
    const invHtml = renderInvoiceEmail(enr);
    email('invoice', enr.payment.email, 'Reality FX — Invoice ' + enr.invoice.number + ' (Paid)', invHtml);
    enr.progress.invoiceEmail = true;
    audit(enr, 'INVOICE_EMAIL_SENT', 'Invoice ' + enr.invoice.number + ' sent to ' + enr.payment.email);

    // 2) REGISTRATION EMAIL (sent immediately after, per spec)
    const regHtml = renderRegistrationEmail(enr, regLink);
    email('registration', enr.payment.email, 'Complete your Reality FX registration — ' + enr.payment.customerName, regHtml);
    enr.progress.registrationEmail = true;
    audit(enr, 'REGISTRATION_EMAIL_SENT', 'Secure registration link sent to ' + enr.payment.email);
    save();
  }

  function createRegistrationInvite(enr, hours) {
    // Default 7 days; a demo pass can shorten it (e.g. 24 hours). The lifetime
    // is stored on the record so a resend keeps it instead of silently extending.
    const h = (typeof hours === 'number' && hours > 0) ? hours : 168;
    enr.registration = {
      token: makeToken(),
      tokenCreatedAt: now(),
      tokenExpiresAt: new Date(Date.now() + h * 3600 * 1000).toISOString(),
      tokenHours: h,
      tokenUsedAt: null,
      submittedAt: null,
      personal: null,
      emailVerifiedAt: null,
      verifyCode: makeVerifyCode(), // demo only — a real system emails this code
      captchaPassedAt: null,
      identity: null,
      selfieDataUrl: null,
      agreements: [],       // { id, name, version, acceptedAt }
      decision: null,       // { verdict: 'APPROVED'|'REJECTED', at, by, reason }
    };
    audit(enr, 'REGISTRATION_INVITE_CREATED', 'Secure link generated (expires ' + new Date(enr.registration.tokenExpiresAt).toLocaleString() + ')');
    save();
  }

  function resendRegistrationEmail(enr) {
    if (!enr.registration) createRegistrationInvite(enr);
    // refresh the token so any leaked link is invalidated (single-use, rotating)
    enr.registration.token = makeToken();
    enr.registration.tokenCreatedAt = now();
    const th = enr.registration.tokenHours || 168; // keep the original lifetime (7 days, or the demo pass's 24h)
    enr.registration.tokenExpiresAt = new Date(Date.now() + th * 3600 * 1000).toISOString();
    audit(enr, 'REGISTRATION_LINK_RESENT', 'New secure link issued (previous invalidated)');
    // resend ONLY the registration email — the invoice was already issued once
    const base = location.href.split('/').slice(0, -1).join('/');
    const regLink = base + '/register.html?token=' + enr.registration.token;
    const regHtml = renderRegistrationEmail(enr, regLink);
    email('registration', enr.payment.email, 'Complete your Reality FX registration — ' + enr.payment.customerName, regHtml);
    save();
    return enr.registration.token;
  }

  /* Registration-link validation (Pillar 2 gate).
     Order matters: an identity that was already established (approved / active / submitted)
     is never blocked by a later expiry — the student always sees their real status. */
  function validateLink(token) {
    const enr = byToken(token);
    if (!enr) return { ok: false, code: 'NOT_FOUND', msg: 'This registration link is not recognised.' };
    if (enr.state === 'REJECTED') return { ok: false, code: 'REJECTED', msg: 'This registration was not approved.' };
    if (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED') return { ok: true, code: 'ACTIVE', msg: '' };
    if (enr.state === 'APPROVED') return { ok: true, code: 'APPROVED', msg: '' };
    if (enr.registration.submittedAt) return { ok: true, code: 'SUBMITTED', msg: '' };
    if (new Date(enr.registration.tokenExpiresAt) < new Date()) return { ok: false, code: 'EXPIRED', msg: 'This link has expired. Contact Reality FX to issue a new one.' };
    return { ok: true, code: 'OK', msg: '' };
  }

  function markTokenUsed(enr) {
    enr.registration.tokenUsedAt = now();
    save();
  }

  /* Link-open tracking — recorded once, the first time the student's
     registration link is opened. This powers the funnel analytics (who
     opened their email, who registered, how long it took them) and the
     security log. In production the email provider also reports opens;
     this is the System A side of the record. */
  function markLinkOpened(enr) {
    const reg = enr.registration || {};
    if (!reg.firstOpenedAt) {
      reg.firstOpenedAt = now();
      secEvent('REG_LINK_OPENED', enr.id + ' · ' + enr.payment.email + ' — registration link first opened');
      save();
    }
    return reg.firstOpenedAt;
  }

  /* Registration funnel — every enrollment with a registration invite, its
     path through the pipeline, and how long students take to register. */
  function regStats() {
    const all = (state.enrollments || []).filter(e => e.registration && e.registration.token);
    const opened = all.filter(e => e.registration.firstOpenedAt);
    const submitted = all.filter(e => e.registration.submittedAt);
    const approved = all.filter(e => e.studentId || e.state === 'APPROVED' || e.state === 'ACTIVE' || e.state === 'RFX_OS_CONFIRMED');
    const durations = submitted.map(e => e.registration.durationMs).filter(n => typeof n === 'number' && n >= 0);
    const avg = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
    return {
      sent: all.length, opened: opened.length, openedPct: all.length ? Math.round((opened.length / all.length) * 100) : 0,
      submitted: submitted.length, approved: approved.length,
      avgDurationMs: avg,
      p50DurationMs: durations.length ? durations.slice().sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
    };
  }

  /* Registration steps persist as the student goes */
  function savePersonal(enr, personal) {
    enr.registration.personal = personal;
    save();
  }
  function markEmailVerified(enr) {
    enr.registration.emailVerifiedAt = now();
    audit(enr, 'EMAIL_VERIFIED', 'Email ' + enr.payment.email + ' verified');
    save();
  }
  /* Email-code verification — brute-force guarded. A limited number of wrong
     attempts locks the code; the student must request a fresh one (resend).
     In production this code is emailed; here it is stored so the demo mailbox
     can show it — but the guard below is real and would be enforced server-side. */
  function checkVerifyCode(enr, code) {
    const reg = enr.registration;
    const sec = state.security || {};
    const max = sec.verifyCodeAttempts || 5;
    const lockMin = sec.verifyCodeLockMinutes || 5;
    reg.codeAttempts = reg.codeAttempts || 0;
    // locked? (even a correct code is refused until a fresh one is sent)
    if (reg.codeLockedUntil && new Date(reg.codeLockedUntil) > new Date()) {
      return { ok: false, locked: true, msg: 'Too many attempts — the code is locked. Request a new code and try again.' };
    }
    if (String(reg.verifyCode) === String(code).trim()) {
      reg.codeAttempts = 0;
      reg.codeLockedUntil = null;
      markEmailVerified(enr);
      return { ok: true, locked: false, msg: '' };
    }
    reg.codeAttempts += 1;
    const left = max - reg.codeAttempts;
    if (left <= 0) {
      reg.codeLockedUntil = new Date(Date.now() + lockMin * 60000).toISOString();
      reg.codeAttempts = 0;
      secEvent('VERIFY_CODE_LOCKED', enr.payment.email + ' · ' + enr.id + ' — locked for ' + lockMin + ' min after repeated wrong codes');
      save();
      return { ok: false, locked: true, msg: 'Too many wrong attempts — the code is locked for ' + lockMin + ' minutes. Request a new code.' };
    }
    save();
    return { ok: false, locked: false, attemptsLeft: left, msg: 'Incorrect code. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before the code locks.' };
  }

  /* Regenerate the email code — also clears any attempt count / lockout. */
  function resendVerifyCode(enr) {
    enr.registration.verifyCode = makeVerifyCode();
    enr.registration.codeAttempts = 0;
    enr.registration.codeLockedUntil = null;
    audit(enr, 'VERIFY_CODE_RESENT', 'New verification code sent to ' + enr.payment.email);
    save();
    email('verify', enr.payment.email, 'Your Reality FX verification code',
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your verification code is:</p>' +
      '<div style="font-family:monospace;font-size:30px;letter-spacing:8px;color:#a8842a;margin:10px 0;">' + enr.registration.verifyCode + '</div>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">This code is valid for one verification and locks after repeated wrong entries. If you did not request it, ignore this email.</p>');
    return enr.registration.verifyCode;
  }

  /* CAPTCHA challenge lifetime. The challenge itself is client-rendered in the
     demo (a production build swaps in a server-verified provider); we still
     count attempts so a bot can't brute-force the on-screen challenge. */
  function registerCaptchaAttempt(enr) {
    const reg = enr.registration;
    const max = (state.security && state.security.captchaAttempts) || 6;
    reg.captchaAttempts = reg.captchaAttempts || 0;
    reg.captchaAttempts += 1;
    const locked = reg.captchaAttempts >= max;
    if (locked) {
      reg.captchaAttempts = 0;
      save();
      return { locked: true, msg: 'Challenge expired after too many attempts — a fresh one has been generated.' };
    }
    save();
    return { locked: false, attemptsLeft: max - reg.captchaAttempts };
  }
  function markCaptchaPassed(enr) {
    enr.registration.captchaPassedAt = now();
    save();
  }
  function saveIdentity(enr, identity, selfieDataUrl) {
    enr.registration.identity = identity;
    enr.registration.selfieDataUrl = selfieDataUrl || null;
    save();
  }
  function acceptAgreements(enr, acceptedIds) {
    const agreed = [];
    state.agreements.forEach(a => {
      if (acceptedIds.indexOf(a.id) !== -1) {
        agreed.push({ id: a.id, name: a.name, version: a.version, acceptedAt: now() });
      }
    });
    enr.registration.agreements = agreed;
    save();
    return agreed;
  }

  /* Submission — everything recorded, exact agreement versions + time.
     The single-use link is consumed HERE, at submission — not at first
     click — so an in-progress registration survives a refresh. */
  function submitRegistration(enr) {
    enr.registration.submittedAt = now();
    if (!enr.registration.tokenUsedAt) enr.registration.tokenUsedAt = now();
    // time-to-register: first link open → submission (the funnel metric)
    if (enr.registration.firstOpenedAt) {
      enr.registration.durationMs = Date.parse(enr.registration.submittedAt) - Date.parse(enr.registration.firstOpenedAt);
    }
    enr.progress.registrationSubmitted = true;
    audit(enr, 'REGISTRATION_SUBMITTED', 'Registration submitted for verification');
    if (state.autoApproveDemo) {
      approve(enr, { verdict: 'APPROVED', by: 'AUTO (demo)' });
    }
    save();
  }

  /* ------------------------------------------------------------
     PILLAR 3 — APPROVAL (automated verification + human decision)
     The system checks everything; the moderator makes the call.
     ------------------------------------------------------------ */
  function verificationChecklist(enr) {
    const reg = enr.registration || {};
    return {
      paidEnrollment: Boolean(enr.payment && enr.payment.transactionId),
      linkValidUnused: Boolean(reg.token && (reg.submittedAt || (!reg.tokenUsedAt && new Date(reg.tokenExpiresAt) > new Date()))),
      personalComplete: Boolean(reg.personal && reg.personal.fullName && reg.personal.dob && reg.personal.country) && Boolean(enr.payment.email),
      emailVerified: Boolean(reg.emailVerifiedAt),
      humanVerified: Boolean(reg.captchaPassedAt),
      identityComplete: (function () {
        const req = state.registrationRequirements || {};
        const idOk = req.idNumber !== 'required' || Boolean(reg.identity && reg.identity.idNumber);
        const phoneOk = req.phone !== 'required' || Boolean(reg.identity && reg.identity.phone);
        const selfieOk = req.selfie !== 'required' || Boolean(reg.selfieDataUrl || reg.selfieVerifiedAt);
        const addrOk = req.address !== 'required' || Boolean(reg.identity && reg.identity.address);
        return Boolean(reg.identity) && phoneOk && selfieOk && addrOk && idOk;
      })(),
      agreementsSigned: Boolean(reg.agreements && reg.agreements.length === state.agreements.length),
      submitted: Boolean(reg.submittedAt),
    };
  }
  function checksPass(enr) {
    const c = verificationChecklist(enr);
    return Object.keys(c).every(k => c[k]);
  }

  function approve(enr, decision) {
    if (enr.state === 'REJECTED' && decision.verdict !== 'REJECTED') return; // a rejection is only reopened via re-apply
    const verdict = decision.verdict === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    if (verdict === 'APPROVED') {
      if (!enr.studentId) {
        enr.studentId = nextStudentId();
        enr.studentCode = makeStudentCode();
        audit(enr, 'IDENTITY_CREATED', 'Student ID ' + enr.studentId + ' and Student Code generated');
      }
      enr.state = 'APPROVED';
      enr.progress.approved = true;
    } else {
      enr.state = 'REJECTED';
      enr.registration.rejections = enr.registration.rejections || [];
    }
    enr.registration.decision = {
      verdict,
      at: now(),
      by: decision.by || 'Moderator',
      reason: decision.reason || (verdict === 'REJECTED' ? 'No reason provided.' : ''),
      // FIXABLE = the student may correct and re-apply (default). FINAL = resolution only.
      fixable: decision.fixable !== false,
    };
    if (verdict === 'REJECTED') enr.registration.rejections.push(enr.registration.decision);
    audit(enr, verdict === 'APPROVED' ? 'APPROVED' : 'REJECTED', (decision.by || 'Moderator') + ' — ' + (decision.reason || '') + (verdict === 'REJECTED' ? ' [' + (decision.fixable !== false ? 'fixable' : 'final') + ']' : ''));
    applySelfieRetention(enr, verdict, decision.fixable !== false);
    save();
    return enr;
  }

  /* Data minimisation: once a decision exists (approval, or a FINAL rejection)
     the verification selfie is deleted — only the verdict is retained. Fixable
     rejections keep it so the student's re-application can restore their photo.
     The checklist treats a purged selfie as still verified via selfieVerifiedAt. */
  function applySelfieRetention(enr, verdict, fixable) {
    const sec = state.security || {};
    if (sec.retainSelfies !== 'untilDecision') return;
    const reg = enr.registration;
    if (!reg || !reg.selfieDataUrl) return;
    if (verdict === 'APPROVED' || (verdict === 'REJECTED' && fixable === false)) {
      reg.selfieVerifiedAt = reg.selfieVerifiedAt || now();
      reg.selfieDataUrl = null;
      audit(enr, 'SELFIE_PURGED', 'Verification selfie deleted after ' + verdict.toLowerCase() + ' decision — only the verdict retained (data minimisation)');
    }
  }

  /* Staff view: how much personal data is still held, active lockouts, recent events. */
  function securityStatus() {
    const enrs = state.enrollments || [];
    const retainedSelfies = enrs.filter(e => e.registration && e.registration.selfieDataUrl).length;
    const decided = enrs.filter(e => e.registration && (e.registration.selfieVerifiedAt || e.registration.decision)).length;
    const lockedLogins = Object.keys(state.loginAttempts || {}).filter(k => {
      const r = state.loginAttempts[k];
      return r && r.lockedUntil && new Date(r.lockedUntil) > new Date();
    }).length;
    return { retainedSelfies, decided, lockedLogins, events: securityEvents(12) };
  }

  /* Live security self-test — the staff can PROVE the guards fire.
     Each check exercises the real enforcement code (not a mock), then
     cleans up its scratch record so real students are never touched.
     Returns one result per guard: { name, pass, detail }. */
  function securitySelfTest() {
    const out = [];
    const sec = state.security || {};
    const maxLogin = sec.maxLoginAttempts || 5;
    const maxCode = sec.verifyCodeAttempts || 5;
    // snapshot audit/events/seq so the self-test can restore them exactly —
    // the test must never leave traces in the real records or burn ID numbers
    const al0 = (state.auditLog || []).length;
    const ev0 = (state.securityEvents || []).length;
    const seq0 = JSON.parse(JSON.stringify(state.seq || {}));
    // pre-clean any stale SELFTEST records a crashed prior run may have left —
    // transaction-id idempotency would otherwise return the old record on rerun
    // and skew the guards (e.g. an already-approved scratch failing the purge test)
    state.enrollments = (state.enrollments || []).filter(e => e.payment.transactionId !== 'SELFTEST' && e.payment.transactionId !== 'SELFTEST2');
    // scratch enrollment for the login-lockout test (removed afterwards)
    const scratch = createEnrollment({
      customerName: 'SELFTEST', email: 'selftest@realityfx.local', price: 1,
      course: state.course.name, transactionId: 'SELFTEST', currency: 'R',
    });
    scratch.registration = {
      token: 'SELFTEST-TOKEN', verified: false, captchaPassed: true,
      submittedAt: now(), codeAttempts: 0, codeLockedUntil: null, verifyCode: '111111',
      personal: { fullName: 'SELFTEST', email: 'selftest@realityfx.local' },
    };
    save();
    // 1) member-panel login lockout
    let loginLocked = false;
    for (let i = 0; i < maxLogin + 1; i++) {
      const r = memberLogin('selftest@realityfx.local', 'WRONG' + i);
      if (r.locked) { loginLocked = true; break; }
    }
    out.push({ name: 'Member login lockout', pass: loginLocked,
      detail: loginLocked ? 'Refused after ' + (maxLogin + 1) + ' wrong attempts (locked ' + (sec.lockoutMinutes || 15) + ' min).' : 'Lockout did NOT engage.' });
    // clear the scratch login throttle
    delete state.loginAttempts['selftest@realityfx.local'];
    // 2) email verify-code brute-force guard
    let codeLocked = false;
    for (let i = 0; i < maxCode + 1; i++) {
      const r = checkVerifyCode(scratch, '00000' + i);
      if (r.locked) { codeLocked = true; break; }
    }
    out.push({ name: 'Verify-code brute-force guard', pass: codeLocked,
      detail: codeLocked ? 'Code locked after ' + (maxCode + 1) + ' wrong entries (new code required).' : 'Guard did NOT engage.' });
    // 3) registration-link expiry — needs a FRESH, never-used link (a link
    //    that already submitted shows the student's real status instead,
    //    which is correct: expiry never hides an established identity)
    const fresh = createEnrollment({
      customerName: 'SELFTEST', email: 'selftest2@realityfx.local', price: 1,
      course: state.course.name, transactionId: 'SELFTEST2', currency: 'R',
    });
    fresh.registration = { token: 'SELFTEST-TOKEN-2', verified: false, captchaPassed: true,
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      personal: { fullName: 'SELFTEST', email: 'selftest2@realityfx.local' } };
    save();
    const exp = validateLink('SELFTEST-TOKEN-2');
    out.push({ name: 'Expired link rejected', pass: exp.code === 'EXPIRED',
      detail: exp.code === 'EXPIRED' ? 'An expired registration link is refused and the student is told to request a new one.' : 'Expired link was NOT refused (' + exp.code + ').' });
    // 4) data minimisation: selfie purge on approval
    scratch.registration.selfieDataUrl = 'data:image/png;base64,SELFTEST'; // tiny fake
    approve(scratch, { verdict: 'APPROVED', by: 'Self-test' });
    const purged = !scratch.registration.selfieDataUrl;
    out.push({ name: 'Selfie purge after decision', pass: purged,
      detail: purged ? 'Verification selfie deleted the moment approval was recorded (only the verdict is kept).' : 'Selfie was NOT purged.' });
    // cleanup: remove scratch enrollments, then truncate audit/events back to
    // their pre-test lengths and restore the sequence — zero residue, zero drift
    state.enrollments = (state.enrollments || []).filter(e => e.id !== scratch.id && e.id !== fresh.id);
    state.auditLog = (state.auditLog || []).slice(0, al0);
    state.securityEvents = (state.securityEvents || []).slice(0, ev0);
    state.seq = seq0;
    delete state.loginAttempts['selftest@realityfx.local'];
    delete state.loginAttempts['selftest2@realityfx.local'];
    save();
    return out;
  }

  /* Storage capacity meter — how much of the browser store the system holds,
     and what that means in students. Answers "can it remember 30 students"
     with real numbers instead of a guess. */
  function storageMeter() {
    const raw = localStorage.getItem(DB_KEY) || '';
    const bytes = raw.length;
    const enrCount = (state.enrollments || []).length;
    // localStorage quota is per-origin; Chrome/Edge typically allow ~5MB of
    // UTF-16-ish data (measured bytes here are the serialized JSON length).
    const quota = 5 * 1024 * 1024; // honest, conservative estimate
    // nominal per-student footprint when the store is empty (measured from
    // a fully-registered student) so headroom still reads meaningfully
    const nominal = 1433; // ≈1.4 KB per registered student, measured
    const perStudent = enrCount ? Math.round(bytes / enrCount) : nominal;
    const headroomBytes = Math.max(0, quota - bytes);
    const headroomStudents = Math.floor(headroomBytes / perStudent);
    return {
      bytes, kb: Math.round(bytes / 1024), mb: (bytes / 1048576).toFixed(2),
      percent: Math.min(100, Math.round((bytes / quota) * 1000) / 10),
      enrollments: enrCount, perStudentKB: perStudent ? (perStudent / 1024).toFixed(1) : '0',
      headroomStudents, quotaMB: 5,
    };
  }

  /* Staff data-hygiene: purge retained selfies whose decision is final — i.e.
     approved, or a FINAL rejection. Fixable-rejected selfies are left alone
     because the re-application flow restores them for the student's correction. */
  function purgeRetainedSelfies() {
    const enrs = state.enrollments || [];
    let n = 0;
    enrs.forEach(e => {
      const reg = e.registration;
      if (!reg || !reg.selfieDataUrl || !reg.decision) return;
      const d = reg.decision;
      const final = d.verdict === 'APPROVED' || d.verdict === 'REJECTED' && d.fixable === false;
      if (final) {
        reg.selfieVerifiedAt = reg.selfieVerifiedAt || now();
        reg.selfieDataUrl = null;
        n++;
      }
    });
    if (n) secEvent('SELFIES_PURGED', n + ' retained verification selfie' + (n === 1 ? '' : 's') + ' deleted (data-hygiene run)');
    save();
    return n;
  }

  /* ------------------------------------------------------------
     PILLARS 4 & 5 — HANDSHAKE + CONFIRMATION
     The bridge logic lives in bridge.js; these helpers update
     the record so the bridge stays simple.
     ------------------------------------------------------------ */
  function transition(enr, toState) {
    enr.state = toState;
    if (toState === 'RFX_OS_CONFIRMED') { enr.handoff.confirmedAt = now(); enr.progress.handoffConfirmed = true; }
    if (toState === 'ACTIVE') {
      enr.progress.active = true;
      enr.progress.activeAt = now();
      // REFERRAL ACCRUAL — the moment the student is fully in, their referrer's
      // commission starts counting (but only vests after the refund window).
      accrueReferralCommission(enr);
    }
    save();
  }

  function noteHandoffAttempt(enr, entry) {
    enr.handoff.attempts.push(Object.assign({ at: now() }, entry));
    if (entry.error) enr.handoff.lastError = entry.error;
    save();
  }

  /* Member-panel login: email + Student Code (or Student ID). Codes are
     shown once on the completion screen, so possession of the code is the
     lightweight credential here (production: Firebase password auth).
     Throttled: repeated failures lock the account for N minutes and are
     logged as security events. */
  function findStudentByCode(email, code) {
    email = (email || '').trim().toLowerCase();
    code = String(code || '').trim().toUpperCase().replace(/^RFX-?/, '');
    if (!email || !code) return null;
    return (state.enrollments || []).find(e => {
      const c1 = e.studentCode ? e.studentCode.toUpperCase().replace(/^RFX-?/, '') : '';
      const c2 = e.studentId ? e.studentId.toUpperCase().replace(/^RFX-?/, '') : '';
      return e.payment.email === email && (c1 === code || c2 === code);
    }) || null;
  }

  function memberLogin(email, code) {
    email = (email || '').trim().toLowerCase();
    code = String(code || '').trim().toUpperCase().replace(/^RFX-?/, '');
    if (!email || !code) return { ok: false, msg: 'Enter both your email and your Student Code.' };
    const sec = state.security || {};
    const max = sec.maxLoginAttempts || 5;
    const lockMin = sec.lockoutMinutes || 15;
    state.loginAttempts = state.loginAttempts || {};
    const rec = state.loginAttempts[email] || { count: 0, lockedUntil: null };
    // locked? refuse even correct credentials until the window passes
    if (rec.lockedUntil && new Date(rec.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(rec.lockedUntil) - new Date()) / 60000);
      return { ok: false, locked: true, msg: 'Too many failed sign-in attempts. This account is locked for ' + mins + ' more minute' + (mins === 1 ? '' : 's') + ' — try again later, or contact Reality FX.' };
    }
    const found = findStudentByCode(email, code);
    if (found && found.studentId) {
      delete state.loginAttempts[email]; // success clears the throttle record
      secEvent('MEMBER_LOGIN', 'Sign-in succeeded · ' + found.studentId + ' · ' + email);
      save();
      return { ok: true, enr: found };
    }
    rec.count = (rec.count || 0) + 1;
    const left = max - rec.count;
    if (left <= 0) {
      rec.lockedUntil = new Date(Date.now() + lockMin * 60000).toISOString();
      rec.count = 0;
      secEvent('LOGIN_LOCKOUT', email + ' locked for ' + lockMin + ' min after ' + max + ' failed sign-in attempts');
      state.loginAttempts[email] = rec;
      save();
      return { ok: false, locked: true, msg: 'Too many failed sign-in attempts — this account is locked for ' + lockMin + ' minutes. Contact Reality FX if this is you.' };
    }
    state.loginAttempts[email] = rec;
    secEvent('LOGIN_FAILED', email + ' · wrong code (' + left + ' attempt' + (left === 1 ? '' : 's') + ' left)');
    save();
    return { ok: false, locked: false, attemptsLeft: left, msg: 'No match found. Check the email on your enrollment and the exact code from your completion screen. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before this account locks.' };
  }

  /* ---------------- formatting helpers ---------------- */
  function money(amount, currency) {
    return (currency || 'R') + Number(amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDateShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ---------------- email templates ---------------- */
  function brandHtml() {
    return '<div style="border-bottom:2px solid #d4af37;padding-bottom:14px;margin-bottom:20px;font-family:Georgia,serif;color:#080808;">' +
      '<span style="font-size:22px;font-weight:700;">Reality FX</span>' +
      ' <span style="font-size:13px;font-style:italic;color:#a8842a;">Registrar</span>' +
      '<div style="font-size:10px;letter-spacing:3px;color:#8a8a8a;font-family:Arial,sans-serif;">ENROLLMENT · REGISTRATION · IDENTITY</div></div>';
  }
  function footerHtml() {
    return '<div style="margin-top:26px;padding-top:14px;border-top:1px dashed #c9b37a;font-size:11px;color:#8a8a8a;font-family:Arial,sans-serif;">' +
      'This is an automated message from the Reality FX Registrar. Do not reply to this email.<br/>' +
      'Reality FX · realityfx20@gmail.com · realityfx.netlify.app</div>';
  }

  // All user-supplied values are HTML-escaped before entering email bodies.
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderInvoiceEmail(enr) {
    const p = enr.payment;
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(p.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Thank you for your purchase. Your official invoice is below. ' +
      'Your course has been <b>fully paid</b> — a separate email will follow with your secure registration link.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<tr><td style="padding:6px 0;color:#888;">Invoice number</td><td style="text-align:right;font-weight:600;">' + enr.invoice.number + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Invoice date</td><td style="text-align:right;">' + fmtDateShort(enr.invoice.issuedAt) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Status</td><td style="text-align:right;color:#1d7a33;font-weight:700;">PAID</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Course</td><td style="text-align:right;">' + escHtml(p.course) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Transaction</td><td style="text-align:right;font-family:monospace;">' + escHtml(p.transactionId) + '</td></tr>' +
      '<tr><td style="padding:10px 0;border-top:1px solid #ddd;font-weight:700;">Total paid</td><td style="text-align:right;border-top:1px solid #ddd;font-weight:700;color:#a8842a;font-size:16px;">' + money(p.price, p.currency) + '</td></tr>' +
      '</table>' + footerHtml();
  }

  function renderRegistrationEmail(enr, link) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your purchase is confirmed. One final step: establish your official ' +
      '<b>Reality FX student identity</b>.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Click the button below to complete your registration. You will be asked to verify your email, ' +
      'confirm you are human, provide your identity details, and accept the Reality FX agreements. ' +
      (function () { const h = enr.registration.tokenHours || 168; const lbl = (h % 24 === 0) ? (h / 24) + ' day' + (h / 24 === 1 ? '' : 's') : h + ' hours'; return 'The link is <b>single-use</b> and expires in <b>' + lbl + '</b>.'; })() + '</p>' +
      '<div style="text-align:center;margin:26px 0;">' +
      '<a href="' + link + '" style="display:inline-block;background:linear-gradient(135deg,#f0d98c,#d4af37 45%,#a8842a);color:#241a05;' +
      'text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:14px 34px;border-radius:10px;font-size:14px;">' +
      'Complete my registration</a></div>' +
      '<p style="font-family:monospace;font-size:11px;color:#999;word-break:break-all;">If the button does not work, paste this link: ' + link + '</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Reality FX will never ask for your password. We only ever send secure links.</p>' +
      footerHtml();
  }

  /* ---------------- debug / demo ---------------- */
  function wipe() {
    localStorage.removeItem(DB_KEY);
    clearServerStore(); // the shared store starts fresh too
    state = load();
  }
  function loadDemoPayment() {
    return {
      customerName: 'Pedro Zulu',
      email: 'pedro.zulu@example.com',
      course: state.course.name,
      price: state.course.price,
      currency: state.course.currency,
      paymentMethod: state.course.paymentMethods[0],
      transactionId: 'TXN-8K2QD91',
      paidAt: new Date().toISOString(),
    };
  }
  function enrollDemo() {
    const enr = createEnrollment(loadDemoPayment());
    // idempotency-aware like the admin form: a repeated demo click returns the
    // existing Pedro instead of wiping his registration or re-sending emails
    const fresh = !(enr.registration && enr.registration.token);
    if (fresh) {
      createRegistrationInvite(enr);
      sendInviteEmails(enr);
    }
    return enr;
  }

  /* 24-hour demo pass — a free tour that feels exactly like a real purchase:
     invoice, registration email, full wizard. The link expires after the given
     hours (default 24), so the tour is time-boxed. Idempotent by the fixed
     DEMO-TOUR transaction: re-running returns the same enrollment, keeps a
     live link, and never re-sends emails; only an expired tour gets a fresh
     link (never a duplicate student). */
  function createDemoPass(opts) {
    const name = String(opts.name || '').trim();
    const emailAddr = String(opts.email || '').trim().toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr)) return { ok: false, msg: 'A name and a valid email are required.' };
    const hours = (typeof opts.hours === 'number' && opts.hours > 0) ? opts.hours : 24;
    const enr = createEnrollment({
      customerName: name,
      email: emailAddr,
      course: state.course.name,
      price: state.course.price,
      currency: state.course.currency,
      paymentMethod: state.course.paymentMethods[0],
      transactionId: 'DEMO-TOUR',
      paidAt: now(),
    });
    const fresh = !(enr.registration && enr.registration.token);
    if (fresh) {
      enr.demoPass = { hours, createdAt: now() };
      createRegistrationInvite(enr, hours);
      sendInviteEmails(enr);
    } else if (new Date(enr.registration.tokenExpiresAt) < new Date()) {
      // Re-issue a fresh link WITHOUT wiping the student's progress — preserve
      // anything they already entered (personal, identity, agreements, email
      // verification), exactly like a normal resend, just on the tour's clock.
      const keep = ['personal', 'emailVerifiedAt', 'captchaPassedAt', 'identity', 'selfieDataUrl', 'agreements', 'decision'];
      const saved = {};
      keep.forEach(k => { if (enr.registration[k] !== undefined && enr.registration[k] !== null) saved[k] = enr.registration[k]; });
      createRegistrationInvite(enr, hours);
      keep.forEach(k => { if (saved[k] !== undefined) enr.registration[k] = saved[k]; });
      enr.registration.token = makeToken();
      enr.registration.tokenCreatedAt = now();
      enr.registration.tokenExpiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      enr.registration.tokenHours = hours;
      // resend only the registration email — the invoice was already issued once
      const base = location.href.split('/').slice(0, -1).join('/');
      const regLink = base + '/register.html?token=' + enr.registration.token;
      email('registration', enr.payment.email, 'Complete your Reality FX registration — ' + enr.payment.customerName, renderRegistrationEmail(enr, regLink));
      save();
    }
    return { ok: true, enr, fresh, token: enr.registration.token, expiresAt: enr.registration.tokenExpiresAt };
  }

  /* ---------------- public API ---------------- */
  RFX.db = {
    // meta
    now, money, fmtDate, fmtDateShort, IDEMPOTENCY_KEY_FIELD,
    // settings
    getSettings, osIndexUrl, updateSettings, getCatalog, saveCatalog,
    // emails
    email, emails, markEmailRead, unreadCount, clearEmails,
    // enrollments
    enrollments, byId, byToken, createEnrollment, createRegistrationInvite,
    sendInviteEmails, resendRegistrationEmail, validateLink, markTokenUsed,
    // registration steps
    savePersonal, checkVerifyCode, resendVerifyCode, registerCaptchaAttempt,
    markEmailVerified, markCaptchaPassed,
    saveIdentity, acceptAgreements, submitRegistration,
    // link-open tracking + funnel analytics
    markLinkOpened, regStats,
    // approval
    verificationChecklist, checksPass, approve,
    // RFX account credit & consolidated refunds (resolution)
    // refund intelligence
    refundRiskScore, refundCooldown, refundStatement, linkedIdentities, refundedIdentities,    wallets, getWallet, walletBalance, walletSummary, recordResolutionChoice,
    issueCredit, queueRefund, payouts, queuedPayoutTotal, processPayoutBatch, auditLog,
    // awards & giveaways (the wallet as the value centre)
    issueAward, runGiveaway, giveaways, awardsList,
    // referral marketing
    referralConfig, referralTier, referralRecords, referralNetwork, referralStats,
    accrueReferralCommission, vestReferralCommissions, payReferralCommissions,
    forfeitReferral, clawbackReferral, referralAnalytics, makeReferralCode,
    // redemption (spending the wallet) + cash-outs
    spendable, redeemCredit, requestCashout,
    // staff payroll settings
    setStaffPayout, staffPayoutSchedule,
    // wallet numbers
    validateWalletNumber,
    // re-application (fixable rejections)
    canReapply, reapply,
    // merch (earned rewards + purchases, shared fulfilment queue)
    merchOrders, merchByEmail, merchAchievementFor, claimAchievementMerch, purchaseMerch, fulfilMerchReward, celebrateMerch, advanceMerch, MERCH_STATUS_LABELS,
    // member panel
    findStudentByCode, memberLogin,
    // staff (invited team, shifts, on-duty roster)
    staff, staffById, staffByEmail, createStaff, validateStaffInvite,
    activateStaff, staffLogin, clockIn, clockOut, onDutyStaff, onDutyCount,
    currentShift, STAFF_ROLES,
    // state machine
    transition, noteHandoffAttempt,
    // security
    securityStatus, securitySelfTest, storageMeter, printTrust, grantPrintTrust, revokePrintTrust, purgeRetainedSelfies, securityEvents, secEvent,
    // demo
    enrollDemo, loadDemoPayment, createDemoPass, wipe,
    // staff wallets (finance funds the team)
    staffWalletFor, staffWallets, fundStaffWallet,
    // financial audit (every money event — export / email end-of-day report)
    financialLedger, financialSummary, financialExport, emailFinancialReport,
    // internals for UI niceties
    audit,
  };
})();
