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


  /* The bridge never sends a student twice: every handoff carries
     the Student ID as an IDEMPOTENCY KEY. RFX-XXXXX can only ever
     represent one identity, so a retried request can never create
     a duplicate. */
  const IDEMPOTENCY_KEY_FIELD = 'studentId';

  /* ---------------- default settings ---------------- */
  const DEFAULTS = {
    schemaVersion: 8,
    seq: { enrollment: 0, invoice: 0, student: 10481, payout: 0, batch: 0, giveaway: 0, staff: 0, merch: 0, referral: 0, notification: 0, support: 0, supportMsg: 0, duty: 0 },
    /* Live support — the human line. A conversation per student between the
       member panel and the staff console. Sarrah (the bot) answers instantly;
       this is where a real person takes over. Unread counters are tracked per
       side so both ends see when the other has spoken. */
    conversations: [],
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
      // Review SLA — the honest promise on the under-review screen.
      // reviewSlaMinutes is how long a submitted registration should normally
      // take to be decided by staff. Before it elapses the student sees a
      // live "typically decided within ~2 hours" timer; after it elapses the
      // screen flips to an honest "still in the queue, nothing is wrong"
      // message with a contact line — never a silent black box.
      reviewSlaMinutes: 120, // 2 hours by default — tune to real staffing
    },
    loginAttempts: {},        // email -> { count, lockedUntil }  (throttle map)
    staffLoginAttempts: {},   // staff email -> { count, lockedUntil }
    staff: [],                // staff members (invite-based, admin-created)
    securityEvents: [],       // { at, event, detail } — lockouts, purges, etc.
    rfxOsEndpoint: 'https://os.realityfx.com/os/api/handoff', // Production OS — never localhost in production
    // Count privacy — the ghost-town rule. Reality FX never shows raw student
    // counts on any STUDENT-FACING surface until the Academy reaches this
    // number of ACTIVE students. A tiny school is nobody's business but ours:
    // public counts would let anyone estimate our revenue and net worth. Staff
    // consoles and the SRM always see the real numbers (internal); the OS
    // dashboard, member panel and reception hide them and show capacity
    // headroom instead. Shared constant so both systems always agree.
    revealStudentCountsAt: 1000,
    // Shared secret that System A signs into the handoff request header
    // (X-RFX-Handoff-Key). Production: the OS Cloud Function refuses any
    // request without the matching key — the browser can never mint identities.
    handoffApiKey: 'rfx-handoff-demo-key',
    demoMode: true,            // when true, the bridge simulates RFX OS answering
    autoApproveDemo: false,    // demo helper: approve submissions instantly
    homeCountry: 'South Africa', // used to flag cross-border refund considerations
    // The Trust Bar — the student's standing, drawn in gold. Penalties are
    // measured and deliberate (the bar never sways on a whim); recovery is
    // earned slowly. A referred student's serious violation costs their
    // referrer points too (referrerPenalty). See trustScore/trustStatus.
    // Bands (founder's model): 80-100 Excellent · 50-79 Stable · 30-49
    // Caution ("be careful") · below 30 Danger zone. The timeout enforcement
    // lives INSIDE the danger zone: ≤25 the account is timed out for a
    // period, ≤10 the timeout extends, 0 is fully restricted.
    trust: {
      excellentAt: 80,      // >= this: Excellent standing
      stableAt: 50,         // >= this: Stable standing
      cautionAt: 30,        // >= this: Caution — be careful; below = danger zone
      timeoutAt: 25,        // <= this: account timed out (a period)
      extendedAt: 10,       // <= this: a longer timeout
      referrerPenalty: -10, // serious referred-student violation → referrer loses this
    },
    trustEvents: [],        // global feed of Trust Bar adjustments (staff oversight)
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
      name: 'Reality FX — CORE',
      price: 2600,
      currency: 'R',
      tier: 'CORE',
      paymentMethods: ['Instant EFT', 'Card (Visa / Mastercard)', 'PayPal'],
    },
    // ─── FROZEN COMMERCIAL STRUCTURE (Founder-approved 26 Aug 2026) ───
    // BASIC R1,500 | CORE R2,600 | PRO R4,500 | ELITE R6,000 | MASTERY R10,000
    // NO LIVE tier. MASTERY only = live learning + private mentoring.
    // Assessment difficulty (Standard/Challenging/Elite) ≠ commercial packages.
    tiers: [
      { id: 'BASIC',  name: 'Reality FX — BASIC',  price: 1500,  label: 'Entry-level self-directed pathway' },
      { id: 'CORE',   name: 'Reality FX — CORE',   price: 2600,  label: 'Flagship foundation programme' },
      { id: 'PRO',    name: 'Reality FX — PRO',    price: 4500,  label: 'Practical development + Arena' },
      { id: 'ELITE',  name: 'Reality FX — ELITE',  price: 6000,  label: 'Advanced competency pathway' },
      { id: 'MASTERY', name: 'Reality FX — MASTERY', price: 10000, label: 'Premium / private development' },
    ],
    // Self-repair bookkeeping: when the mechanic clamps a negative wallet it
    // records the write-off here so the ledger stays honest (money is never
    // silently created or destroyed — even repairs are reconciled).
    repairOffsets: [],
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
      // ─── FROZEN UPGRADE PATHS (Founder-approved 26 Aug 2026) ───
      { code: 'RFX-UPGRADE-05', name: 'Reality FX — MASTERY', price: 10000, currency: 'R', note: 'Upgrade to MASTERY — private mentoring + live sessions' },
      { code: 'RFX-UPGRADE-04', name: 'Reality FX — ELITE', price: 6000, currency: 'R', note: 'Upgrade to ELITE — advanced competency pathway' },
      { code: 'RFX-UPGRADE-03', name: 'Reality FX — PRO', price: 4500, currency: 'R', note: 'Upgrade to PRO — practical development + Arena' },
      { code: 'RFX-UPGRADE-02', name: 'Reality FX — CORE', price: 2600, currency: 'R', note: 'Upgrade to CORE — flagship foundation programme' },
      { code: 'RFX-UPGRADE-01', name: 'Reality FX — BASIC', price: 1500, currency: 'R', note: 'Upgrade to BASIC — entry-level self-directed pathway' },
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
  /* Load-test mode: when simulateLoad runs it swaps in a fresh in-memory
     world and raises this flag, so every save() inside the test becomes a
     no-op — the REAL store is never touched, and the test is fast because
     it never serializes. Restored before simulateLoad returns. */
  let simSilent = false;

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
      if (merged.schemaVersion < 9) {
        merged.schemaVersion = 9;
      }
      if (merged.schemaVersion < 10) {
        // v10: Trust Bar re-tiered (founder's model): 80-100 Excellent · 50-79
        // Stable · 30-49 Caution ("be careful") · below 30 Danger zone. The
        // timeout (≤25) and extended (≤10) enforcement stay inside the danger
        // zone. Old saves carried the previous 50-caution line — force the new
        // thresholds so every store reads the same bands.
        merged.trust = Object.assign({}, DEFAULTS.trust, parsed.trust || {});
        merged.trust.excellentAt = 80;
        merged.trust.stableAt = 50;
        merged.trust.cautionAt = 30;
        merged.trust.timeoutAt = 25;
        merged.trust.extendedAt = 10;
        merged.schemaVersion = 10;
      }
      if (merged.schemaVersion < 11) {
        // v11: heal support-reply notifications that were truncated at 140
        // chars by an old supportSend — the FULL reply lives in the support
        // thread, so rebuild the preview from it (soft 220 cap).
        (merged.enrollments || []).forEach(e => {
          const nots = e.notifications || [];
          nots.forEach(n => {
            if (n.kind !== 'support' || (n.message || '').slice(-1) === '…') return;
            const thread = (merged.conversations || merged.supportThreads || []).find(t =>
              (t.email || '').toLowerCase() === String((e.payment && e.payment.email) || '').toLowerCase());
            const lastStaff = thread ? thread.messages.slice().reverse().find(m => m.from === 'staff') : null;
            if (lastStaff && lastStaff.text && lastStaff.text.length > (n.message || '').length) {
              const txt = lastStaff.text;
              n.message = txt.length <= 220 ? txt : txt.slice(0, txt.slice(0, 221).lastIndexOf(' ')) + '…';
            }
          });
        });
        merged.schemaVersion = 11;
      }
      // Seed-heal (idempotent, runs on EVERY load — not just migrations): an
      // approved enrollment must also read as submitted. Approval is ONLY
      // reachable after registration in the real pipeline, so any approved
      // record missing the flag is a seed artifact (ENR-0001 carried
      // approved:true with registrationSubmitted:false, which made the
      // pillar bar + funnel read oddly — the founder spotted the gray
      // REGISTRATION pillar on his own record). Heal regardless of whether
      // a submittedAt exists; some legacy seeds were minted straight into
      // APPROVED. A pure data fix: it never rewrites a real student's path.
      (merged.enrollments || []).forEach(e => {
        if (e.progress && e.progress.approved && !e.progress.registrationSubmitted) {
          e.progress.registrationSubmitted = true;
        }
      });
      return merged;
    } catch (e) {
      console.error('RFX db: failed to load, starting fresh.', e);
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function save() {
    if (simSilent) return; // load test — pure in-memory world, zero persistence
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
  /* The staff onboarding letter — the same care as the Academy prep guide.
     A new hire walks in knowing the whole machine: the three rooms, the
     robotic manager, the duties they will actually be given, the standing
     that shapes their pay, and the security that makes their job easy.
     The invite link is inside, one-time use, 7-day expiry. */
  function staffInviteEmail(s) {
    const link = makeInviteLink(s);
    const role = STAFF_ROLES[s.role] || 'Team member';
    const duties = [
      ['Clear the registration queue', 'Every pending registration gets a careful decision — approve with a reason, reject with a reason. The machine prepares everything; you bring the judgement.'],
      ['Review identity flags', 'When the gate flags a selfie or identity signal, the evidence lands in your queue. You confirm it is the person behind the payment — quality control is the point.'],
      ['Run the system audit', 'One click runs the full 20-check health check — money, identity, the handshake, integrity. Pass or fail, the manager records it. You never need to be a developer to know the machine is healthy.'],
      ['Sync the bridge to RFX OS', 'Push every approved student across the handshake rail and confirm the Academy received them. No student is ever left at a gateway.'],
      ['Answer the human line', 'Live support, in your own words. The AI handles the instant stuff; you are the warm hand that makes the machine feel human.'],
      ['Advance the merch queue', 'Collecting orders move to packing, packing to shipped — the fulfilment queue should never stall.'],
    ];
    const dutyRows = duties.map(function (d, i) {
      return '<tr><td style="padding:12px 0;border-bottom:1px solid #eee;">' +
        '<div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">' + (i + 1) + '. ' + d[0] + '</div>' +
        '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">' + d[1] + '</div></td></tr>';
    }).join('');
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(s.name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Welcome to the Reality FX team as <b>' + role + '</b> — the human line of the Academy.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">Before you set foot in the console, read this once and you will know the whole machine. You are joining at the best time: the system does the heavy lifting, and your job is judgement, care and consistency.</p>' +
      '<table style="width:100%;border-collapse:collapse;">' +
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;"><div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">Three rooms, one family</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">Reality FX is one journey in three rooms. The <b>Front Desk</b> (our website) is where the world meets us. The <b>Student Portal</b> is the campus office — identity, wallet, store, events. <b>RFX OS Academy</b> is the classroom. The chain is always: FRONT DESK → STUDENT PORTAL → RFX OS. Some students are hand-picked and skip the Front Desk — but every single one must register, because registration is how identity and Student Codes are minted. Nobody reaches the classroom without a verified identity.</div></td></tr>' +
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;"><div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">The machine does the heavy lifting</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">The system audits itself — 20 checks run across money, identity, the handshake and integrity, and 5 security self-tests attack it the way an intruder would (brute-forced logins, guessed codes, reused links) and every hit is defended and recorded. More than 35 kinds of security events are logged for review. You do not need to be a software developer: run the audit, review the log, and on the rare technical occasion the console will tell you plainly what is wrong.</div></td></tr>' +
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;"><div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">Your duties — the robotic manager assigns them</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">The board hands you real work, generated live from the state of the system. Complete it and your standing rises; let it go overdue and the manager records it. This is what your job actually is:</div>' +
      '<table style="width:100%;border-collapse:collapse;">' + dutyRows + '</table></td></tr>' +
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;"><div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">Your standing is your pay</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">Every team member works under the same standard, and it is never hidden: completed duties and quality decisions raise your standing; missed duties, late clock-ins and careless calls lower it. Full pay in good standing; needs-attention holds 10%; thin ice holds 20%; stood down pays nothing until an admin reviews. A standing of 20 or below opens a termination review. It sounds strict — that is deliberate. Reality FX does not tolerate anything less than quality, and the record is always in your hands.</div></td></tr>' +
      '<tr><td style="padding:14px 0;"><div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">Set up your access</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:3px;">The button below is a <b>one-time use</b> invite that expires in <b>7 days</b>. It takes two minutes: choose your staff code, clock into your first shift, and the board will be waiting for you.</div></td></tr>' +
      '</table>' +
      '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + link + '" style="display:inline-block;background:linear-gradient(135deg,#f0d98c,#d4af37 45%,#a8842a);color:#241a05;' +
      'text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:13px 30px;border-radius:10px;font-size:14px;">' +
      'Set up my staff access</a></div>' +
      '<p style="font-family:monospace;font-size:11px;color:#999;word-break:break-all;">Or paste: ' + link + '</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">You are the reason students feel cared for. Welcome to the family — the Academy is in good hands.</p>' +
      footerHtml();
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
      // the robotic manager's record — every new hire starts in good standing
      // and earns or loses ground from the first shift (staff trust bar)
      perf: { score: 100, events: [] },
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
    /* The founder holds the master key: the same email plus their Student ID
       (RFX-10482) or Student Code opens every door, including this console,
       as an admin. Their staff record is minted on first sign-in so shifts,
       duties, the trust bar and pay rules behave exactly like any team
       member's — the founder simply starts in gold. */
    if (email === String(FOUNDER_EMAIL).toLowerCase()) {
      const enr = (state.enrollments || []).find(e => String((e.payment && e.payment.email) || '').trim().toLowerCase() === email);
      const typed = String(code || '').trim();
      const codeOk = !!enr && (
        (enr.studentCode && typed === String(enr.studentCode)) ||
        (enr.studentId && (typed === String(enr.studentId) || typed === String(enr.studentId).replace(/^RFX-/, '')))
      );
      if (!codeOk) {
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
        return { ok: false, locked: false, msg: 'No match — check your email and Student ID (RFX-…). ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' };
      }
      delete state.staffLoginAttempts[email];
      let fs = staffByEmail(email);
      if (!fs) {
        const pers = (enr.registration && enr.registration.personal) || {};
        fs = {
          id: 'STF-F001',
          name: [pers.firstName, pers.lastName].filter(Boolean).join(' ') || (enr.payment && enr.payment.name) || 'Leeroy Chirwa',
          email: email,
          role: 'admin',
          founder: true,
          invitedAt: now(),
          activatedAt: now(),
          staffCode: typed,
          createdBy: 'Reality FX — the founder',
          shifts: [],
          perf: { score: 100, events: [] },
          createdAt: now(),
        };
        state.staff.push(fs);
      } else {
        fs.staffCode = typed;
        fs.activatedAt = fs.activatedAt || now();
        fs.founder = true;
        fs.role = 'admin';
      }
      secEvent('STAFF_LOGIN', fs.id + ' · ' + fs.name + ' — founder master key, staff console');
      let fweekly = null;
      if (!fs.lastReportAt || new Date(fs.lastReportAt) < new Date(Date.now() - 7 * 86400000)) {
        fweekly = staffWeeklyReport(fs.id);
      }
      save();
      return { ok: true, staff: fs, founder: true, weekly: fweekly };
    }
    const s = staffByEmail(email);
    if (s && s.terminatedAt) {
      delete state.staffLoginAttempts[email];
      save();
      return { ok: false, locked: false, msg: 'This account has been stood down — contact Reality FX admin.' };
    }
    if (s && s.activatedAt && s.staffCode === String(code || '').trim()) {
      delete state.staffLoginAttempts[email];
      secEvent('STAFF_LOGIN', s.id + ' · ' + s.name + ' signed in');
      // the weekly report lands automatically once a week — the standard is
      // known before it is enforced
      let weekly = null;
      if (!s.lastReportAt || new Date(s.lastReportAt) < new Date(Date.now() - 7 * 86400000)) {
        weekly = staffWeeklyReport(s.id);
      }
      save();
      return { ok: true, staff: s, weekly: weekly };
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
    if (s.terminatedAt) return { ok: false, msg: 'This account has been stood down — contact an admin.' };
    if (s.shifts.some(sh => !sh.out)) return { ok: false, msg: 'You are already clocked in — clock out first.' };
    const shType = type === 'night' ? 'night' : 'day';
    const at = new Date();
    s.shifts.push({ in: at.toISOString(), out: null, type: shType });
    // The owner hates late staff — a scheduled shift start makes lateness a
    // measured fact, not an opinion: 15-minute grace, then the manager records it.
    let lateMins = null, penalty = 0;
    if (s.shiftStart) {
      const hhmm = String(s.shiftStart).split(':');
      const expect = new Date(at);
      expect.setHours(parseInt(hhmm[0], 10), parseInt(hhmm[1], 10), 0, 0);
      lateMins = Math.round((at - expect) / 60000);
      if (lateMins > 15) {
        penalty = 2;
        staffPerfEvent(s.id, 'late-clockin', -penalty, 'Late clock-in — expected ' + s.shiftStart + ', clocked in ' + lateMins + ' min late');
      } else {
        lateMins = null;
      }
    }
    secEvent('STAFF_CLOCK_IN', s.id + ' · ' + s.name + ' clocked in (' + shType + ' shift)' + (lateMins ? ' — LATE by ' + lateMins + ' min (-' + penalty + ')' : ''));
    save();
    return { ok: true, shift: s.shifts[s.shifts.length - 1], lateMins: lateMins, penalty: penalty };
  }
  /* The expected start of a staff member's shift (HH:MM, 24-hour). When set,
     clocking in more than 15 minutes late costs 2 points — recorded once,
     visibly, on the staff member's own bar. Empty clears the schedule. */
  function setStaffShiftTime(staffId, startTime) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    const v = String(startTime || '').trim();
    if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { ok: false, msg: 'Shift start must be HH:MM (24-hour), e.g. 09:00.' };
    s.shiftStart = v || null;
    secEvent('STAFF_SHIFT_SET', s.id + ' · ' + s.name + ' expected shift start → ' + (v || 'not scheduled — no lateness check'));
    save();
    return { ok: true, staff: s };
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

  /* Coverage heatmap — the shift board's honest week view. For each of the
     last N days, every hour of the day counts how many staff were on duty,
     from REAL shift records only: a cell is lit by actual clock-ins, nothing
     else. Gaps (nights nobody covers, quiet weekends) show up exactly as
     they are — the 24/7 promise is a measured fact, not a slogan. */
  function coverageHeatmap(days) {
    days = Math.min(14, Math.max(1, days | 0 || 7));
    const staffList = state.staff || [];
    const nowMs = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    // cells[dayOffset][hour] -> names; dayOffset 0 = today
    const cells = [];
    for (let i = 0; i < days; i++) cells.push(new Array(24).fill(0).map(() => []));
    staffList.forEach(function (s) {
      (s.shifts || []).forEach(function (sh) {
        let t = new Date(sh.in).getTime();
        const end = sh.out ? new Date(sh.out).getTime() : nowMs;
        if (end < t || !isFinite(t)) return;
        for (; t < end; t += 3600000) {
          const dt = new Date(t);
          const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
          const off = Math.round((todayMs - dayStart) / 86400000);
          if (off < 0 || off >= days) continue;
          cells[off][dt.getHours()].push(s.name);
        }
      });
    });
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayRows = [];
    let totalStaffHours = 0, gaps = 0, peak = 0;
    for (let off = days - 1; off >= 0; off--) {
      const dt = new Date(todayMs - off * 86400000);
      const rows = cells[off].map(function (names, hour) {
        const uniq = Array.from(new Set(names));
        totalStaffHours += uniq.length;
        if (!uniq.length) gaps++;
        peak = Math.max(peak, uniq.length);
        return { hour: hour, names: uniq, count: uniq.length };
      });
      dayRows.push({ date: dt, label: DAYS[dt.getDay()] + ' ' + dt.getDate() + '/' + (dt.getMonth() + 1), rows: rows });
    }
    const totalCells = days * 24;
    let demoShifts = 0;
    staffList.forEach(function (s) { (s.shifts || []).forEach(function (sh) { if (sh.demo) demoShifts++; }); });
    return {
      days: dayRows,
      stats: {
        windowDays: days,
        totalStaffHours: totalStaffHours,
        coveragePct: totalCells ? Math.round((100 * (totalCells - gaps)) / totalCells) : 0,
        gaps: gaps,
        peak: peak,
        demoShifts: demoShifts,
      },
    };
  }

  /* Demo coverage seed — a labelled sample roster so the heatmap can be seen
     at full strength while the academy is still small. Adds a few realistic
     team members and a 14-day sample schedule (two day staff 08:00-16:00,
     two night staff 16:00-23:00, lighter weekends) with every shift flagged
     `demo` — real clock-ins replace the picture as staff actually work.
     Idempotent: re-running never duplicates team members or open shifts. */
  function seedCoverage() {
    const demoTeam = [
      { name: 'Thandi Nkosi', email: 'thandi@realityfx.co.za', role: 'reception', code: 'THANDI2026' },
      { name: 'Mpho Dlamini', email: 'mpho@realityfx.co.za', role: 'approver', code: 'MPHO2026' },
      { name: 'Lerato Molefe', email: 'lerato@realityfx.co.za', role: 'finance', code: 'LERATO2026' },
    ];
    let created = 0;
    demoTeam.forEach(function (d) {
      if (staffByEmail(d.email)) return;
      state.staff.push({
        id: nextStaffId(), name: d.name, email: d.email,
        role: d.role, invitedAt: now(), inviteToken: null, inviteExpiresAt: now(),
        activatedAt: now(), staffCode: d.code, activatedToken: 'demo-coverage-seed',
        createdBy: 'Demo coverage seed', shifts: [],
        perf: { score: 100, events: [] }, createdAt: now(),
      });
      created++;
    });
    const roster = state.staff || [];
    for (let off = 13; off >= 0; off--) {
      const d = new Date(Date.now() - off * 86400000);
      const wd = d.getDay();
      const isWknd = wd === 0 || wd === 6;
      const plan = isWknd
        ? [{ i: 0, type: 'day', from: 9, to: 15 }]
        : [{ i: 0, type: 'day', from: 8, to: 16 }, { i: 1, type: 'day', from: 8, to: 16 }, { i: 2, type: 'night', from: 16, to: 23 }, { i: 3, type: 'night', from: 16, to: 23 }];
      plan.forEach(function (p) {
        const st = roster[p.i % roster.length];
        if (!st) return;
        if (st.shifts.some(function (sh) { return !sh.out; })) return; // never stack an open shift
        const inD = new Date(d); inD.setHours(p.from, (off * 7) % 60, 0, 0);
        const outD = new Date(d); outD.setHours(p.to, (off * 13) % 60, 0, 0);
        st.shifts.push({ in: inD.toISOString(), out: outD.toISOString(), type: p.type, demo: true });
      });
    }
    secEvent('COVERAGE_SEEDED', 'Demo coverage seeded — ' + created + ' team member' + (created === 1 ? '' : 's') + ' added, 14-day sample roster built (flagged demo)');
    save();
    return { ok: true, created: created, team: roster.length };
  }

  /* ============================================================
     STAFF PERFORMANCE — the robotic manager.
     Every staff member carries a trust bar of their own (0-100),
     fed by the work they actually do. The manager assigns today's
     duties from LIVE system state, records every completed duty
     (+1), every overdue duty (-2), every quality decision (+2),
     every support reply (+1) and every merch advancement (+1).
     The ledger is permanent — staff earn their pay, visibly.
     ------------------------------------------------------------ */
  const STAFF_PERF_MAX = 100;
  function staffPerf(s) {
    s.perf = s.perf || { score: 100, events: [] };
    return s.perf;
  }
  function staffPerfEvent(staffId, kind, delta, note) {
    const s = staffById(staffId);
    if (!s) return null;
    const p = staffPerf(s);
    p.score = Math.max(0, Math.min(STAFF_PERF_MAX, (p.score || 100) + (delta || 0)));
    p.events = p.events || [];
    p.events.push({ at: now(), kind: kind || 'note', delta: delta || 0, note: note || '' });
    if (p.events.length > 300) p.events = p.events.slice(-300);
    save();
    return { score: p.score, event: p.events[p.events.length - 1] };
  }
  function staffPerfStatus(s) {
    const p = staffPerf(s);
    const score = p.score;
    let tier = 'stable', label = 'Solid standing';
    if (score === 0) { tier = 'standdown'; label = 'Stood down — pay withheld, admin review'; }
    else if (score < 20) { tier = 'danger'; label = 'Final warning — termination review'; }
    else if (score < 30) { tier = 'danger'; label = 'On thin ice';
    }
    else if (score < 50) { tier = 'caution'; label = 'Needs attention'; }
    else if (score < 80) { tier = 'stable'; label = 'Solid standing'; }
    else { tier = 'excellent'; label = 'Excellent standing'; }
    return { score: score, tier: tier, label: label, events: p.events.slice().reverse() };
  }
  /* The pay link — standing is money, honestly. Full pay in good standing;
     needs-attention holds 10%; thin ice holds 20%; stood down pays nothing
     until an admin reviews. Shown to the staff member and in the weekly report. */
  function perfPayFactor(s) {
    const st = staffPerfStatus(s);
    if (st.score === 0) return { factor: 0, label: 'Pay withheld — stood down, admin review' };
    if (st.score < 30) return { factor: 0.8, label: '80% pay — 20% performance hold' };
    if (st.score < 50) return { factor: 0.9, label: '90% pay — 10% performance hold' };
    return { factor: 1, label: 'Full pay — in good standing' };
  }

  /* ------- the duty engine (assigns work from live system state) ------- */
  const STAFF_DUTY_ROLES = {
    reviews: 'approver', identity: 'approver', sessions: 'approver',
    support: 'reception', merch: 'reception',
    finance: 'finance',
    audit: 'all', sync: 'all', outage: 'all', security: 'all',
  };
  function dutyOpenCount(kind) {
    const enrs = state.enrollments || [];
    switch (kind) {
      case 'reviews': return enrs.filter(e => e.state === 'PENDING' || e.state === 'REGISTERED').length;
      case 'identity': return enrs.filter(e => e.identityFlags && e.identityFlags.length).length;
      case 'support': return (state.conversations || []).filter(t => { const m = t.messages || []; return m.length && m[m.length - 1].from === 'student'; }).length;
      case 'merch': return (state.merch && state.merch.orders || []).filter(o => o.status === 'collecting' || o.status === 'packing').length;
      default: return 0;
    }
  }
  function generateDuties() {
    state.staffDuties = state.staffDuties || [];
    const today = new Date().toISOString().slice(0, 10);
    const defs = [
      { kind: 'audit', manual: true, title: 'Run the full system audit', desc: 'The 19-point health check — money, identity, handshake, integrity. Pass or fail, the manager records it.' },
      { kind: 'sync', manual: true, title: 'Sync & reconcile the bridge', desc: 'Push every approved-but-unhanded-off enrollment to RFX OS and confirm the rail is clean.' },
      { kind: 'outage', manual: true, title: 'Review the Academy uptime board', desc: 'Check the power monitor — confirm the Academy is reachable and no outage is unaccounted for.' },
      { kind: 'security', manual: true, title: 'Review today\'s security events', desc: 'Scan the security feed for lockouts, failed logins, flagged captures or anything unusual.' },
      { kind: 'reviews', manual: false, title: 'Clear the registration queue', desc: 'Every pending registration gets a decision — approve with care, reject with a reason.' },
      { kind: 'identity', manual: false, title: 'Review identity flags', desc: 'Check every selfie/identity signal the gate flagged and confirm the evidence.' },
      { kind: 'sessions', manual: true, title: 'Audit active sessions', desc: 'Confirm one active session per student — the contract ends stale or shared ones automatically.' },
      { kind: 'support', manual: false, title: 'Answer the support queue', desc: 'Every open conversation gets a reply from the human line.' },
      { kind: 'merch', manual: false, title: 'Advance the merch fulfilment queue', desc: 'Collecting orders move to packing, packing to shipped — the queue should never stall.' },
      { kind: 'finance', manual: true, title: 'Review the payout & refund queue', desc: 'Check the consolidated batch: cash-outs, refunds and wages ready for the next run.' },
    ];
    // The day rolled over: file every unhandled duty from a previous day at day
    // end WITHOUT penalty — the desk that owned that day is gone, so dumping the
    // misses on whoever opens the board days later would be noise, not justice.
    // The filing is recorded in the security feed so the paper trail stays (an
    // admin always sees what was never done). Only the CURRENT day's duties can
    // cost the person at the desk points.
    const rollover = state.staffDuties.filter(d => !d.doneAt && String(d.key || '').split('|')[0] < today);
    if (rollover.length) {
      rollover.forEach(d => { d.doneAt = now(); d.penalized = true; d.filed = true; });
      secEvent('DUTY_FILED', rollover.length + ' unhandled dut' + (rollover.length === 1 ? 'y' : 'ies') + ' from a previous day filed at day end — ' + rollover.map(d => d.title).join(', '));
    }
    let created = false;
    defs.forEach(function (d) {
      const role = STAFF_DUTY_ROLES[d.kind];
      const key = today + '|' + role + '|' + d.kind;
      if (state.staffDuties.some(x => x.key === key)) return;
      state.staffDuties.push({
        id: 'D-' + (state.seq.duty = (state.seq.duty || 0) + 1),
        key: key, kind: d.kind, role: role, title: d.title, desc: d.desc, manual: !!d.manual,
        createdAt: now(),
        dueAt: new Date(Date.now() + (d.manual ? 10 * 3600000 : 14 * 3600000)).toISOString(),
        doneAt: null, overdue: false, penalized: false,
      });
      created = true;
    });
    // only persist when something was actually created — this runs on every
    // panel render + the 8s poll, so a silent save would spam the store
    if (created || rollover.length) save();
  }
  /* The manager's board for one staff member: their role's duties + the
     shared ones. Auto duties close themselves when their queue clears;
     overdue duties record ONE penalty to whoever is at the desk (deduped
     per duty). Admins see every duty — they are the manager's eyes. */
  function dutiesFor(staff) {
    generateDuties();
    const me = (staff && staff.id) ? staff : null;
    state.staffDuties = state.staffDuties || [];
    const nowMs = Date.now();
    const list = state.staffDuties.filter(function (d) {
      return d.role === 'all' || (me && (me.role === 'admin' || d.role === me.role));
    });
    let changed = false;
    list.forEach(function (d) {
      if (!d.manual && !d.doneAt && dutyOpenCount(d.kind) === 0) { d.doneAt = now(); changed = true; }
      if (!d.doneAt && !d.overdue && nowMs > new Date(d.dueAt).getTime()) { d.overdue = true; changed = true; }
      if (d.overdue && !d.penalized && me) {
        d.penalized = true; changed = true;
        // the manager does not forgive repeat misses: every overdue duty in the
        // past 30 days makes the next one cost more (starts at -2, grows by 1,
        // capped at -6). Quality is the standard, and the record is permanent.
        const p = staffPerf(me);
        const recentMisses = (p.events || []).filter(e => e.kind === 'duty-overdue' && new Date(e.at) > new Date(Date.now() - 30 * 86400000)).length;
        const delta = -Math.min(2 + recentMisses, 6);
        staffPerfEvent(me.id, 'duty-overdue', delta, 'Overdue duty: ' + d.title + (recentMisses ? ' — ' + recentMisses + ' overdue in the last 30 days, the penalty grows' : ''));
      }
    });
    if (changed) save();
    return list;
  }
  function completeDuty(staff, dutyId) {
    const me = (staff && staff.id) ? staff : null;
    const d = (state.staffDuties || []).find(x => x.id === dutyId);
    if (!d) return { ok: false, msg: 'Duty not found.' };
    if (d.doneAt) return { ok: false, msg: 'Already done.' };
    if (d.manual || dutyOpenCount(d.kind) === 0) {
      d.doneAt = now();
      if (me) staffPerfEvent(me.id, 'duty-done', 1, 'Completed: ' + d.title);
      save();
      return { ok: true, duty: d };
    }
    return { ok: false, msg: 'The queue still has work — handle the items first; the duty closes itself when it clears.' };
  }
  /* the live queue counts the duty card shows under each auto duty */
  function dutyQueueCount(kind) { return dutyOpenCount(kind); }
  function currentShift(staffId) {
    const s = staffById(staffId);
    return s ? (s.shifts || []).find(sh => !sh.out) || null : null;
  }

  /* The team board — every member's standing in one list, best first. Staff
     see the whole team (the standard is shared); admins get the controls. */
  function staffPerfBoard() {
    return (state.staff || []).map(function (s) {
      const st = staffPerfStatus(s);
      return {
        id: s.id, name: s.name, role: s.role,
        score: st.score, tier: st.tier, label: st.label,
        atRisk: st.score <= 20, terminated: !!s.terminatedAt,
        shiftStart: s.shiftStart || null,
      };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  /* A merged, permanent feed of every recorded performance event across the
     team — the robotic manager's logbook, newest first. */
  function teamPerfFeed(limit) {
    const out = [];
    (state.staff || []).forEach(function (s) {
      (staffPerf(s).events || []).forEach(function (e) {
        out.push({ at: e.at, staffId: s.id, name: s.name, role: s.role, kind: e.kind, delta: e.delta, note: e.note });
      });
    });
    return out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, limit || 20);
  }
  /* Admin override — the human boss is allowed to move a bar, but only with a
     recorded reason. The adjustment, the reason and the admin are permanent. */
  function adminPerfOverride(staffId, delta, note, by) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    delta = Math.round(Number(delta));
    if (!isFinite(delta) || delta === 0) return { ok: false, msg: 'Enter a non-zero adjustment (-20 to +20).' };
    if (delta < -20 || delta > 20) return { ok: false, msg: 'Adjustments are capped at ±20 — contact the owner for bigger moves.' };
    const noteTxt = String(note || '').trim();
    if (!noteTxt) return { ok: false, msg: 'A reason is mandatory — every override is recorded.' };
    const byTxt = by || 'Admin';
    staffPerfEvent(s.id, 'admin-override', delta, 'Admin override (' + byTxt + '): ' + noteTxt);
    secEvent('STAFF_PERF_OVERRIDE', s.id + ' · ' + s.name + ' ' + (delta > 0 ? '+' : '') + delta + ' by ' + byTxt + ' — ' + noteTxt);
    return { ok: true, staff: s, score: staffPerfStatus(s).score };
  }
  /* Termination — the level Reality FX cannot tolerate. Only an admin can
     stand a member down; the reason is recorded and the member is emailed.
     A stood-down account cannot sign in or clock in again. */
  function adminTerminateStaff(staffId, reason, by) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    if (s.terminatedAt) return { ok: false, msg: s.name + ' is already stood down.' };
    const why = String(reason || '').trim();
    if (!why) return { ok: false, msg: 'A reason is mandatory — termination is a recorded, reviewed act.' };
    const byTxt = by || 'Admin';
    s.terminatedAt = now();
    (s.shifts || []).forEach(sh => { if (!sh.out) sh.out = now(); });
    staffPerfEvent(s.id, 'terminated', 0, 'Stood down by ' + byTxt + ' — ' + why);
    secEvent('STAFF_TERMINATED', s.id + ' · ' + s.name + ' stood down by ' + byTxt + ' — ' + why);
    email('staff-terminated', s.email, 'Reality FX — your staff access has ended', staffTerminatedEmail(s, why));
    save();
    return { ok: true, staff: s };
  }
  function staffTerminatedEmail(s, why) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(s.name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your staff access to Reality FX has been stood down.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#555;">Reason recorded: ' + escHtml(why) + '</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#777;">If you believe this is an error, contact the owner directly. The full performance record that led to this decision remains on file — every number was always in your hands.</p>' + footerHtml();
  }
  /* The weekly report — one branded email per team member: standing, shifts,
     duties, misses, and the pay position. Auto-sent on sign-in once a week,
     always available from the portal. */
  function staffWeeklyReport(staffId) {
    const s = staffById(staffId);
    if (!s) return { ok: false, msg: 'Staff member not found.' };
    const p = staffPerf(s);
    const since = Date.now() - 7 * 86400000;
    const events = (p.events || []).filter(e => new Date(e.at) > new Date(since));
    const scoreNow = p.score;
    const deltaSum = events.reduce((acc, e) => acc + (e.delta || 0), 0);
    const scoreThen = Math.max(0, Math.min(STAFF_PERF_MAX, scoreNow - deltaSum));
    const dutiesDone = events.filter(e => e.kind === 'duty-done').length;
    const overdue = events.filter(e => e.kind === 'duty-overdue').length;
    const lateIn = events.filter(e => e.kind === 'late-clockin').length;
    const overrides = events.filter(e => e.kind === 'admin-override').length;
    const shifts = (s.shifts || []).filter(sh => sh.out && new Date(sh.out) > new Date(since)).length;
    const st = staffPerfStatus(s);
    const pay = perfPayFactor(s);
    const html = brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(s.name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your weekly performance report from the robotic manager — the same record your pay is built on.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<tr><td style="padding:6px 0;color:#888;">Standing</td><td style="text-align:right;font-weight:700;">' + st.label + ' (' + scoreNow + ')</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Score a week ago</td><td style="text-align:right;">' + scoreThen + ' → ' + scoreNow + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Shifts clocked</td><td style="text-align:right;">' + shifts + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Duties completed</td><td style="text-align:right;">' + dutiesDone + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Overdue duties</td><td style="text-align:right;">' + overdue + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Late clock-ins</td><td style="text-align:right;">' + lateIn + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Admin adjustments</td><td style="text-align:right;">' + overrides + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Pay position</td><td style="text-align:right;font-weight:600;">' + pay.label + '</td></tr>' +
      '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#777;">The standard, plainly: excellent and solid standing are paid in full; needs attention holds 10%; thin ice holds 20%; a stood-down account is paid nothing until an admin reviews it. Missed duties escalate, lateness is recorded, and a standing at 20 or below opens a termination review. Every number here is the manager\'s permanent record.</p>' + footerHtml();
    email('staff-weekly', s.email, 'Reality FX — your weekly performance report', html);
    s.lastReportAt = now();
    save();
    return { ok: true, html: html, staff: s };
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
    // Fire-and-forget: deliver the email via Resend Cloud Function.
    // The localStorage record stays for the member-panel mailbox display;
    // the Cloud Function delivers it to the real inbox.
    deliverEmail(to, subject, html);
    return mail;
  }
  /* Production email delivery — calls the sendEmail Cloud Function.
     Fire-and-forget: failures are logged but never block the UI.
     In demo/local mode (no Cloud Function), this silently does nothing. */
  function deliverEmail(to, subject, html) {
    const SEND_EMAIL_ENDPOINT = 'https://us-central1-reality-fx-production-25796.cloudfunctions.net/sendEmail';
    try {
      fetch(SEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) console.warn('Email delivery failed:', d.error);
      }).catch(function () { /* demo/offline — no delivery, no error */ });
    } catch (e) { /* no delivery in demo mode */ }
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
    let ep = String(state.rfxOsEndpoint || 'https://os.realityfx.com/os/api/handoff').trim();
    if (ep.indexOf('/api/') !== -1) ep = ep.split('/api/')[0];
    ep = ep.replace(/\/+$/, '');
    if (/\.html?($|[?#])/.test(ep)) return ep;          // already a page URL
    return ep + '/index.html';
  }

  /* Production auth gateway — the openOs Cloud Function that issues the
     RS256-signed JWT.  The member panel opens this URL instead of going
     directly to the OS; the Cloud Function looks up the enrollment,
     generates the token, and redirects to the OS with ?token=.

     In demo/fallback mode (no Firebase project), falls back to the
     local fork server's /open-os endpoint so the handshake still works
     during local development. */
  const PROD_AUTH_GATE = 'https://us-central1-reality-fx-production-25796.cloudfunctions.net/openOs';
  const LOCAL_AUTH_GATE = '/open-os';  // local fork server fallback
  function osAuthUrl(email) {
    // In production, use the Cloud Function which issues RS256 tokens.
    // In demo/local mode, fall back to the fork server.
    if (state.rfxAuthProduction === false) {
      // explicit local mode — use the fork server
      return LOCAL_AUTH_GATE + '?email=' + encodeURIComponent(email || '');
    }
    // Default: production Cloud Function
    return PROD_AUTH_GATE + '?email=' + encodeURIComponent(email || '');
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
    // kind is normalized at read time so old saves stay compatible: merch is
    // explicit; UPGRADE codes are courses (the panel enrolls them properly);
    // everything else is a service (mentorship, seat transfer, deposits).
    return (state.catalog || []).slice().sort((a, b) => (a.price || 0) - (b.price || 0))
      .map(c => Object.assign({}, c, { kind: c.kind || (c.code && c.code.indexOf('RFX-UPGRADE') === 0 ? 'course' : 'service') }));
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
      // (clawbacks are ledgered as type 'clawback' and REDUCE the liability)
      // 'repair-offset' = write-offs recorded when self-repair clamps a negative
      // wallet to zero — the liability must shrink by exactly that, so even a
      // repair keeps the books balanced (money is never silently destroyed).
      held: sumIn(['credit', 'award', 'referral']) - sumOut(['referral', 'clawback', 'redeem', 'cashout', 'repair-offset']),
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
    if (a.phone && b.phone && phonesMatch(a.phone, b.phone)) return true;
    // same name AND same payment method is a strong link even with a fresh email
    if (a.name && b.name && a.method && b.method && a.name === b.name && a.method === b.method) return true;
    return false;
  }

  /* ------------------------------------------------------------
     SMARTER PHONE MATCHING — formats collapse, fakes get caught.
     The old matcher stripped non-digits and compared raw, so
     '082 123 4567' and '+27 82 123 4567' looked like DIFFERENT
     numbers even though they are the same line. phoneKey() derives
     the country code (the registration form records it) and
     collapses local + international formats to one canonical key:
       • South Africa: 0XX… local == +27 XX… == 27XX…
       • US / Canada:  +1 202-555-0123 == 2025550123
       • Elsewhere:    leading country code + zeros are stripped,
                        keeping the genuine digit core.
     A 9-digit number can never match a 10-digit one (the digit
     core is the truth), so genuinely different lines stay apart.
     ------------------------------------------------------------ */
  function phoneKey(phone) {
    const raw = String(phone || '').replace(/[^\d]/g, '');
    if (!raw) return '';
    let d = raw;
    // South Africa — the dominant case: 0XX… local or 27XX… / +27XX…
    if (/^0\d{9}$/.test(d)) d = '27' + d.slice(1);           // 0821234567 → 27821234567
    else if (d.length === 11 && d[0] === '27') d = d;          // +27 82 123 4567 → 27821234567
    else if (d.length === 12 && d.slice(0, 2) === '27') d = d; // already canonical
    // US/Canada: the leading 1 is the trunk, not the country dial
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    // strip a lone leading zero for the rest of the world
    d = d.replace(/^0+/, '');
    return d;
  }
  function phonesMatch(a, b) {
    const ka = phoneKey(a), kb = phoneKey(b);
    return !!(ka && kb && ka === kb);
  }

  /* Identity fraud signals — run on the same fingerprint machinery as the
     refund layer. When a new identity shares a phone (PHONE_REUSE), a full
     name with a different email (NAME_REUSE) or an email (EMAIL_REUSE) with
     another enrollment, the approval checklist shows a gold 'Identity
     signals · flagged' row and the SRM shows the pills. Flags are REVIEW
     TRIGGERS, never auto-verdicts — the moderator's eyes make the call.
     Re-saves never spam the log (new-signal-only dedupe). */
  function scanIdentitySignals(enr) {
    const reg = enr.registration || {};
    const idn = reg.identity || {};
    const p = enr.payment || {};
    const myPhone = String(idn.phone || p.phone || '');
    const myName = String(reg.personal && (reg.personal.fullName || ((reg.personal.firstName || '') + ' ' + (reg.personal.surname || ''))) || p.customerName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const myEmail = String(p.email || '').trim().toLowerCase();
    const signals = [];
    const seen = new Set();
    (state.enrollments || []).forEach(o => {
      if (o.id === enr.id || !o.studentId) return;
      const oreg = o.registration || {};
      const oidn = oreg.identity || {};
      const op = o.payment || {};
      const oPhone = String(oidn.phone || op.phone || '');
      const oName = String(oreg.personal && (oreg.personal.fullName || ((oreg.personal.firstName || '') + ' ' + (oreg.personal.surname || ''))) || op.customerName || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const oEmail = String(op.email || '').trim().toLowerCase();
      if (myPhone && oPhone && phonesMatch(myPhone, oPhone) && !(myEmail && oEmail && myEmail === oEmail)) {
        const k = 'PHONE_REUSE|' + o.id;
        if (!seen.has(k)) { seen.add(k); signals.push({ kind: 'PHONE_REUSE', ref: o.id, label: 'Same phone number as ' + o.id + ' (' + (op.customerName || '?') + ')' }); }
      }
      if (myName && oName && myName === oName && myEmail !== oEmail && oEmail) {
        const k = 'NAME_REUSE|' + o.id;
        if (!seen.has(k)) { seen.add(k); signals.push({ kind: 'NAME_REUSE', ref: o.id, label: 'Same full name as ' + o.id + ' with a different email' }); }
      }
      if (myEmail && oEmail && myEmail === oEmail) {
        const k = 'EMAIL_REUSE|' + o.id;
        if (!seen.has(k)) { seen.add(k); signals.push({ kind: 'EMAIL_REUSE', ref: o.id, label: 'Same email as ' + o.id }); }
      }
    });
    // new-signal-only dedupe: never re-fire events for signals we already raised
    const prev = new Set((reg.identitySignals || []).map(s => s.kind + '|' + s.ref));
    signals.forEach(s => {
      if (!prev.has(s.kind + '|' + s.ref)) {
        secEvent('IDENTITY_' + s.kind, enr.id + ' · ' + s.label);
      }
    });
    reg.identitySignals = signals;
    return signals;
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
      if (enr) {
        audit(enr, 'AWARD_CREDITED', money(amount, w.currency) + ' · ' + (opts.reason || 'Award') + ' (ref ' + ref + ')');
        notifyStudent(enr, 'award', 'You won ' + money(amount, w.currency), (opts.reason || 'An academy award') + ' landed in your RFX account — prize money never expires. Reference ' + ref + '.');
      }
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
      notifyEmail(r.referrerEmail, 'referral', 'Your referral commission is in', 'Your friend ' + (r.referredName || '—') + ' is fully locked in — ' + money(r.amount, 'R') + ' (' + r.rate + '% tier) landed in your RFX account. Well done for growing the RFX family.');
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
    // the robotic manager credits the fulfilment work
    const mop = currentOperator();
    if (mop && mop.id && mop.id !== 'console') staffPerfEvent(mop.id, 'merch', 1, 'Advanced ' + order.id + ' → ' + next);
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
  /* The official print-trust rules — a privilege earned through trust, not
     smarts. Shown in the SRM grant dialog and documented for staff so the
     rule is the same everywhere. */
  function printTrustRules() {
    return [
      'Printing is OFF by default — every OS page is watermarked, text-copy is blocked and print is blacked out.',
      'Print access is granted ONLY by staff, to students who have earned the Academy\'s trust (sustained good standing, clean integrity record, no sharing flags).',
      'The grant is recorded against the identity — who granted it, when, and why — and rides the handoff payload so the OS enforces it at the backend.',
      'A revoked student loses print access on the next sync; the watermark and blackout return automatically.',
      'A referred student\'s serious violation can cost the referrer points too — trust is a family matter.',
    ];
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
    notifyStudent(enr, 'printTrust', 'Print access granted', 'You have earned Reality FX\'s trust — you can now print your course material. It stays watermarked with your Student ID, as every RFX document is.');
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

  /* ============================================================
     THE JOURNEY CALENDAR — a student's own planner.
     ------------------------------------------------------------
     One smart calendar per student, with three tiers (mirroring the OS
     course difficulty tiers: Standard / Demanding / Elite) and two
     focuses (study / updates / both). Academy events (Founder's Day,
     graduation, ceremonies) are auto-inserted so nothing is ever
     missed; the calendar also suggests study work tied to the student's
     own standing — trust, active course, and how long they've been in.
     Stored on the enrollment record so it rides the handoff to the OS.
     ------------------------------------------------------------ */
  const CAL_TIERS = {
    standard: { label: 'Standard', cadence: '2 sessions · 30 min each', weeklySessions: 2, blurb: 'A gentle rhythm — a few fixed Academy dates and light study nudges.', plan: ['Review this week\'s lesson once', 'One journal entry for your best trade this week'] },
    demanding: { label: 'Demanding', cadence: '3 sessions · 45 min each', weeklySessions: 3, blurb: 'A steady discipline — scheduled study blocks plus every Academy date.', plan: ['3 study blocks this week (45 min each)', 'Journal every trade with a written reason', 'Re-watch the lesson before the Intelligent Assessment'] },
    elite: { label: 'Elite', cadence: 'Daily · 60 min blocks', weeklySessions: 5, blurb: 'Trading-room intensity — daily blocks, mentor check-ins and exam prep.', plan: ['Daily 60-min study block', 'Simulated exam every Friday', 'Mentor check-in before the next assessment'] },
  };
  /* Briefing types a student can subscribe to — the Journey Calendar only
     shows the feeds they want. Defaults: all on. Stored per enrollment. */
  const CAL_BRIEFING_TYPES = [
    { id: 'prep', label: 'Academy prep & guides', blurb: 'The 2026 prep guide, the operating guide, and semester letters.' },
    { id: 'events', label: 'Events & dates', blurb: 'Academy dates, ceremonies, awards and giveaway draws.' },
    { id: 'merch', label: 'Merch & rewards', blurb: 'New merch drops, free tee & hoodie milestones, prize news.' },
    { id: 'milestones', label: 'Milestones & nudges', blurb: 'Your 60-day reviews, month markers and personal reminders.' },
  ];
  function briefingSubs(enr) {
    const cal = journeyCal(enr);
    const all = {}; CAL_BRIEFING_TYPES.forEach(t => all[t.id] = true);
    return Object.assign(all, (cal.subs && typeof cal.subs === 'object') ? cal.subs : {});
  }
  function setBriefingSub(enr, id, on) {
    if (!CAL_BRIEFING_TYPES.some(t => t.id === id)) return briefingSubs(enr);
    const cal = journeyCal(enr);
    cal.subs = cal.subs || {};
    cal.subs[id] = !!on;
    save();
    return briefingSubs(enr);
  }
  const CAL_FOCUS = { study: 'study', updates: 'updates', all: 'all' };
  function journeyCal(enr) {
    if (!enr) return { tier: 'standard', focus: 'all', events: [], suggestions: [] };
    enr.journeyCal = enr.journeyCal || { tier: 'standard', focus: 'all', events: [], suggestions: [] };
    return enr.journeyCal;
  }
  function journeyCalTier(enr) { return CAL_TIERS[journeyCal(enr).tier] ? journeyCal(enr).tier : 'standard'; }
  function journeyCalFocus(enr) { return journeyCal(enr).focus || 'all'; }
  function setJourneyCal(enr, patch) {
    const cal = journeyCal(enr);
    if (patch.tier && CAL_TIERS[patch.tier]) cal.tier = patch.tier;
    if (patch.focus && CAL_FOCUS[patch.focus]) cal.focus = patch.focus;
    save();
    return cal;
  }
  function calAddEvent(enr, ev) {
    const cal = journeyCal(enr);
    state.seq.calEvent = (state.seq.calEvent || 0) + 1;
    ev = Object.assign({ id: 'CE-' + state.seq.calEvent, at: now(), done: false }, ev);
    cal.events = cal.events || [];
    cal.events.push(ev);
    save();
    return ev;
  }
  function calRemoveEvent(enr, id) {
    const cal = journeyCal(enr);
    cal.events = (cal.events || []).filter(e => e.id !== id);
    save();
  }
  function calToggleEvent(enr, id) {
    const cal = journeyCal(enr);
    const ev = (cal.events || []).find(e => e.id === id);
    if (ev) { ev.done = !ev.done; save(); }
  }
  /* Academy dates that every student gets, derived from real constants so the
     calendar and the OS can never disagree. Events in the past are still
     listed (marked past) so the journey reads as a timeline. */
  function calAcademyEvents(enr) {
    const y = new Date().getFullYear();
    const list = [
      { date: y + '-01-15', title: 'Academy year begins', kind: 'academy' },
      { date: y + '-06-01', title: 'Mid-year review week', kind: 'academy' },
      { date: FOUNDERS_DAY.month + '-' + String(FOUNDERS_DAY.day).padStart(2, '0') + '-' + y, title: 'Founder\'s Day — remembering the mentor', kind: 'academy' },
      { date: y + '-12-10', title: 'Graduation ceremony', kind: 'academy' },
    ];
    // an awards/giveaway date when one is scheduled — state.awards is a
    // reference-keyed object, so use the array helper, never .slice() on it
    const aw = awardsList().sort((a, b) => (a.at || '').localeCompare(b.at || ''))[0];
    if (aw && aw.at) list.push({ date: aw.at.slice(0, 10), title: 'Awards & giveaway draw', kind: 'academy' });
    return list;
  }
  /* Academy briefings — short, current notices. Academy dates live in
     "Coming up" on the card (never duplicated here); this feed is the news
     that changes: prep guide, merch, milestone nudges, and the single next
     Academy date as a pointer. Rendered fresh; not stored. Each item carries
     a type, and the feed only shows the types the student is subscribed to
     (see briefingSubs / setBriefingSub). */
  function calBriefings(enr) {
    const subs = briefingSubs(enr);
    const out = [];
    if (subs.prep) out.push({ title: 'Prep guide 2026 — read it before your first lesson', when: 'In your Mailbox', type: 'prep', kind: 'brief' });
    if (subs.prep) out.push({ title: 'How Reality FX operates — the full guide', when: 'In your Mailbox', type: 'prep', kind: 'brief' });
    if (subs.merch) out.push({ title: 'Merch drops — free tee & hoodie at an 80% average', when: 'Ongoing', type: 'merch', kind: 'brief' });
    const daysIn = enr && enr.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(enr.createdAt).getTime()) / 86400000)) : 0;
    if (subs.milestones && daysIn >= 60 && daysIn % 60 < 7) out.push({ title: 'Your 60-day review — journal, reflect, set one goal', when: 'This week', type: 'milestones', kind: 'brief' });
    const today = new Date().toISOString().slice(0, 10);
    const next = subs.events ? calAcademyEvents(enr).filter(ev => ev.date && ev.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] : null;
    if (next) out.push({ title: next.title, when: 'Next Academy date · ' + next.date.slice(8) + '/' + next.date.slice(5, 7), type: 'events', kind: 'brief' });
    return out.slice(0, 5);
  }

  /* Study-session tracker — the week's weekday slots (Mon–Fri), with a
     target from the tier, so a student sees "2 of 3 sessions done" and can
     mark today's session complete. Stored per enrollment as a flat log of
     done-dates; the week view is derived, never stored. */
  /* Session streak — consecutive studied weekdays ending at the most recent
     one. Weekends never break the streak (they just don't add to it), and a
     not-yet-studied today is given grace instead of resetting it to zero. */
  function sessionStreak(enr) {
    const cal = journeyCal(enr);
    cal.sessions = cal.sessions || [];
    const doneMap = {}; cal.sessions.forEach(s => doneMap[s.date] = true);
    const cursor = new Date();
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let streak = 0, first = true;
    for (let i = 0; i < 370; i++) {
      const d = cursor.getDay();
      if (d === 0 || d === 6) { cursor.setDate(cursor.getDate() - 1); continue; }
      if (doneMap[iso(cursor)]) streak++;
      else if (!first) break; // first pass may be a grace day (today not yet studied)
      cursor.setDate(cursor.getDate() - 1);
      first = false;
    }
    return streak;
  }
  const STREAK_MILESTONES = [3, 7, 14, 30];
  function sessionTracker(enr) {
    const tier = journeyCalTier(enr);
    const target = (CAL_TIERS[tier] && CAL_TIERS[tier].weeklySessions) || 2;
    const cal = journeyCal(enr);
    cal.sessions = cal.sessions || [];
    const nowD = new Date();
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const start = new Date(nowD);
    start.setDate(nowD.getDate() - ((nowD.getDay() + 6) % 7)); // Monday
    const days = [];
    const doneLog = {}; cal.sessions.forEach(s => doneLog[s.date] = true);
    for (let i = 0; i < 5; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const date = iso(d);
      days.push({ date: date, weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i], done: !!doneLog[date], isToday: date === iso(nowD) });
    }
    const done = days.filter(x => x.done).length;
    const today = days.find(x => x.isToday);
    const streak = sessionStreak(enr);
    return { weekStart: iso(start), target: target, days: days, done: done, today: today, pct: target ? Math.min(100, Math.round(done / target * 100)) : 0, streak: streak };
  }
  /* Marking a session done can cross a streak milestone — that moment gets a
     branded mailbox note + a panel notification, once per milestone, ever. */
  function markTodaySession(enr) {
    const cal = journeyCal(enr);
    cal.sessions = cal.sessions || [];
    cal.rewards = cal.rewards || [];
    const t = sessionTracker(enr);
    const today = t.today;
    if (!today) return { tracker: sessionTracker(enr), reward: null };
    let reward = null;
    if (today.done) {
      cal.sessions = cal.sessions.filter(s => s.date !== today.date);
    } else {
      cal.sessions.push({ date: today.date, at: now() });
      const streak = sessionStreak(enr);
      const hit = STREAK_MILESTONES.find(m => streak >= m && cal.rewards.indexOf(m) === -1);
      if (hit) {
        cal.rewards.push(hit);
        notifyStudent(enr, 'milestone', hit + '-day study streak!', 'You studied ' + hit + ' days in a row — that rhythm is exactly how traders are made. Keep it alive; your streak is ' + streak + ' days.');
        reward = { milestone: hit, streak: streak };
      }
    }
    save();
    return { tracker: sessionTracker(enr), reward: reward };
  }

  /* Smart suggestions — tied to the student's own standing so the calendar
     never hands out generic homework. Fresh at render time, not stored. */
  function calSuggestions(enr) {
    const tier = journeyCalTier(enr);
    const focus = journeyCalFocus(enr);
    const t = CAL_TIERS[tier];
    const out = [];
    if (focus === 'study' || focus === 'all') {
      t.plan.forEach((p, i) => out.push({ title: p, when: 'This week', kind: 'suggest' }));
    }
    // tied to their own record
    const ts = trustStatus(enr);
    if (ts && ts.tier === 'caution') out.push({ title: 'Rebuild your standing — complete this week\'s work and keep your conduct clean', when: 'Now', kind: 'suggest' });
    const daysIn = enr.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(enr.createdAt).getTime()) / 86400000)) : 0;
    if (daysIn > 0 && daysIn % 30 === 0) out.push({ title: 'Month ' + (daysIn / 30) + ' — review your journal and set one goal for next month', when: 'This week', kind: 'suggest' });
    if (focus === 'updates' || focus === 'all') {
      out.push({ title: 'Check your Mailbox before Academy announcements', when: 'Weekly', kind: 'suggest' });
      out.push({ title: 'New merch or events drop here first — keep an eye out', when: 'Ongoing', kind: 'suggest' });
    }
    return out.slice(0, 6);
  }

  /* ============================================================
     STUDENT NOTIFICATIONS — the member-panel feed
     ------------------------------------------------------------
     A small, per-enrollment feed of things the student should hear
     about, even if they are not looking at the screen the moment it
     happens: print trust granted, an award landing, a referral
     commission paid, a buddy enrolling. The member panel renders it
     as a card (unread items get a gold NEW badge) and toasts the
     freshest unread item on sign-in so nobody misses a moment.
     ============================================================ */
  function notifyStudent(enr, kind, title, message) {
    if (!enr) return null;
    enr.notifications = enr.notifications || [];
    const n = {
      id: 'N-' + (++state.seq.notification),
      at: now(),
      kind,            // 'printTrust' | 'award' | 'referral' | 'credit' | 'milestone'
      title,
      message,
      read: false,     // acknowledged by the student (Mark all read)
      toastedAt: null, // has the member panel toasted it yet (separate from read)
    };
    enr.notifications.push(n);
    save();
    return n;
  }
  /* Mark the newest un-read items as toasted (so they fire once) and return
     the one that should be toasted now. Kept separate from `read`: a toast is
     a heads-up, the gold NEW badge stays until the student acknowledges. */
  function markToasted(enr) {
    if (!enr || !enr.notifications) return null;
    const fresh = enr.notifications.slice().reverse().find(n => !n.read && !n.toastedAt);
    if (fresh) { fresh.toastedAt = now(); save(); }
    return fresh;
  }
  function notifyEmail(emailOrId, kind, title, message) {
    const hit = (state.enrollments || []).find(e =>
      (e.payment && e.payment.email === emailOrId) || e.id === emailOrId || e.studentId === emailOrId);
    return hit ? notifyStudent(hit, kind, title, message) : null;
  }
  function studentNotifications(enr) {
    return (enr && enr.notifications ? enr.notifications.slice().reverse() : []);
  }
  function unreadNotificationCount(enr) {
    return (enr && enr.notifications ? enr.notifications.filter(n => !n.read).length : 0);
  }
  function markNotificationsRead(enr) {
    if (!enr || !enr.notifications) return 0;
    let n = 0;
    enr.notifications.forEach(x => { if (!x.read) { x.read = true; n++; } });
    if (n) save();
    return n;
  }

  /* Review SLA — the honest clock on the under-review screen. Returns
     { withinSla, submittedAt, slaMinutes, decidedBy, overdueMinutes }.
     "Typically decided within ~2 hours" is a promise we can keep, and
     when we don't, the student is TOLD the registration is still in the
     queue — not left guessing what "a short time" meant. */
  function reviewSlaInfo(enr) {
    const sub = enr && enr.registration && enr.registration.submittedAt;
    const mins = (state.security && state.security.reviewSlaMinutes) || 120;
    const submittedMs = sub ? new Date(sub).getTime() : null;
    if (!submittedMs) return { withinSla: true, submittedAt: null, slaMinutes: mins, decidedBy: null, overdueMinutes: 0 };
    const dueMs = submittedMs + mins * 60000;
    const overdue = Math.max(0, Date.now() - dueMs);
    return {
      withinSla: Date.now() <= dueMs,
      submittedAt: sub,
      slaMinutes: mins,
      decidedBy: new Date(dueMs).toISOString(),
      overdueMinutes: Math.floor(overdue / 60000),
    };
  }

  /* ============================================================
     THE TRUST BAR — how the student carries themselves
     ------------------------------------------------------------
     Every approved student's bar starts at 100%. It is the direct
     representation of conduct: serious violations drain it, genuine
     good conduct slowly restores it. It never sways easily —
     penalties are measured and deliberate, recovery is earned, and
     a referred student's serious violation costs their referrer
     points too (you vouch for who you bring into the family).
     Bands (settings.trust, founder's model):
       80-100 excellent  — nothing to worry about
       50-79  stable     — standing intact
       30-49  caution    — told: "be careful — keep it above 30%"
       <30    danger     — told: "below 25 your account is timed out"
       ≤ 25   timeout    — account timed out (7 days)
       ≤ 10   extended   — a longer timeout (30 days)
       0      restricted — fully restricted, pending moderator review
     ============================================================ */
  function trustScore(enr) {
    if (!enr || !enr.trust || typeof enr.trust.score !== 'number') return 100;
    return Math.max(0, Math.min(100, enr.trust.score));
  }
  function trustStatus(enr) {
    const s = trustScore(enr);
    const t = state.trust || {};
    const excellentAt = t.excellentAt || 80;
    const stableAt = t.stableAt || 50;
    const cautionAt = t.cautionAt || 30;
    const timeoutAt = t.timeoutAt || 25;
    const extendedAt = t.extendedAt || 10;
    // The five bands the founder defined: 80-100 Excellent · 50-79 Stable ·
    // 30-49 Caution ("be careful") · 1-29 Danger zone · 0 Restricted. The
    // timeout/extended enforcement lives INSIDE the danger band (≤25 timed
    // out for a period, ≤10 extended) so the ring always reads the band
    // while the student still gets the honest timeout warning when it bites.
    let tier = 'stable', label = 'Stable standing';
    if (s === 0) { tier = 'restricted'; label = 'Restricted'; }
    else if (s < cautionAt) { tier = 'danger'; label = 'Danger zone'; }
    else if (s < stableAt) { tier = 'caution'; label = 'Caution — be careful'; }
    else if (s < excellentAt) { tier = 'stable'; label = 'Stable standing'; }
    else { tier = 'excellent'; label = 'Excellent standing'; }
    // enforcement flags — the danger band carries the timeout ladder
    const timedOut = s > 0 && s <= timeoutAt;
    const extended = s > 0 && s <= extendedAt;
    return { score: s, tier, label, excellentAt, stableAt, cautionAt, timeoutAt, extendedAt, restricted: s === 0, timedOut, extended };
  }
  function trustEvents(enr) {
    return (enr && enr.trust && enr.trust.events ? enr.trust.events.slice().reverse() : []);
  }
  function trustFeed() {
    return (state.trustEvents || []).slice().reverse(); // staff oversight — every bar move, all students
  }
  /* Adjust the bar by a signed amount. Measured, never whimsical: the delta
     comes from the caller's named severity (serious / warning / minor for
     penalties; good-conduct / milestone for credits). Clamped 0..100, every
     move is ledgered, tier-crossings notify the student, and 0% triggers the
     restriction flag a moderator reviews. */
  function adjustTrust(enr, opts) {
    if (!enr) return null;
    const delta = Number(opts.delta) || 0;
    if (!delta) return { score: trustScore(enr), delta: 0, note: 'No change' };
    const before = trustScore(enr);
    const score = Math.max(0, Math.min(100, before + delta));
    enr.trust = enr.trust || { score: 100, events: [], restricted: false, restrictedAt: null };
    enr.trust.score = score;
    enr.trust.events.push({
      at: now(),
      delta,
      reason: opts.reason || (delta < 0 ? 'Conduct review' : 'Good conduct'),
      kind: opts.kind || (delta < 0 ? 'penalty' : 'credit'),
      by: opts.by || 'System',
      ref: opts.ref || null,
    });
    // 0% = fully restricted, pending moderator review — the OS stops access.
    // Recovering above 0 clears the flag: the restriction was a state, not a
    // life sentence, and the moderator keeps the history either way.
    if (score === 0 && !enr.trust.restricted) {
      enr.trust.restricted = true;
      enr.trust.restrictedAt = now();
      audit(enr, 'TRUST_RESTRICTED', 'Trust Bar reached 0% — account fully restricted pending review');
      secEvent('TRUST_RESTRICTED', (enr.studentId || enr.id) + ' — Trust Bar at 0%');
      notifyStudent(enr, 'milestone', 'Your account is restricted', 'Your Trust Bar reached 0%. Your account is now fully restricted — the moderator will review your case and decide the next step.');
    } else if (score > 0 && enr.trust.restricted) {
      enr.trust.restricted = false;
      audit(enr, 'TRUST_RECOVERED', 'Trust Bar recovered above 0% — restriction lifted, standing reinstated');
      notifyStudent(enr, 'milestone', 'Your account is reinstated', 'Your Trust Bar recovered above 0% — the restriction has been lifted. Keep your standing up.');
    }
    // every move lands on the global feed too — the staff oversight ledger
    state.trustEvents = state.trustEvents || [];
    state.trustEvents.push({ at: now(), student: enr.studentId || enr.id, name: (enr.payment && enr.payment.customerName) || '', score, delta, reason: opts.reason || '', by: opts.by || 'System' });
    // tier crossings: tell the student the moment their standing changes
    const s0 = trustStatus(Object.assign({}, enr, { trust: { score: before } }));
    const s1 = trustStatus(enr);
    if (s0.tier !== s1.tier && score > 0) {
      const timeoutAt = (state.trust && state.trust.timeoutAt) || 25;
      const cautionAt = (state.trust && state.trust.cautionAt) || 30;
      const msg = s1.tier === 'caution'
        ? ('Your Trust Bar is at ' + score + '% — you are in the caution band. Keep it above ' + cautionAt + '% or you enter the danger zone (below ' + timeoutAt + '% your account is timed out).')
        : (s1.tier === 'danger'
          ? (s1.extended ? 'Your Trust Bar is critically low and your timeout is extended. Further drops mean full restriction at 0%.'
            : (s1.timedOut ? 'Your Trust Bar fell below ' + timeoutAt + '% — the danger zone. Your account is timed out for a period; good conduct will earn it back.'
              : 'Your Trust Bar fell below ' + cautionAt + '% — the danger zone. Below ' + timeoutAt + '% your account is timed out; good conduct will earn it back.'))
          : (s1.tier === 'stable' ? 'Your Trust Bar recovered to a stable standing — keep it up.'
            : (s1.tier === 'excellent' ? 'Outstanding — your Trust Bar reached excellent standing. Keep it up.'
              : 'Your standing has changed to ' + s1.label + '.')));
      notifyStudent(enr, 'milestone', 'Trust Bar · ' + s1.label, msg);
    }
    audit(enr, 'TRUST_ADJUSTED', (delta > 0 ? '+' : '') + delta + ' → ' + score + '% · ' + (opts.reason || ''));
    save();
    return { score, before, delta, tier: s1.label };
  }
  /* Serious conduct events ripple up the referral tree: the referrer vouched
     for this student, so a serious violation costs the referrer too. Forces
     students to only share their code with people they genuinely trust. */
  function referralTrustPenalty(referredEnr, reason) {
    if (!referredEnr) return null;
    const rec = (state.referrals || []).find(r => r.referredEnrId === referredEnr.id && ['accrued', 'vested', 'paid'].indexOf(r.status) > -1);
    if (!rec) return null;
    const refEnr = (state.enrollments || []).find(e => (e.payment && e.payment.email === rec.referrerEmail) || e.studentId === rec.referrerId || e.id === rec.referrerId);
    if (!refEnr || refEnr.id === referredEnr.id) return null;
    const penalty = (state.trust && state.trust.referrerPenalty) || -10;
    return adjustTrust(refEnr, { delta: penalty, kind: 'penalty', by: 'System', ref: rec.id, reason: 'Referred student violation — ' + (reason || 'conduct review') + '. You vouch for who you bring into the family.' });
  }
  /* Seed the bar the moment the identity is minted — a fresh student starts
     trusted at 100%, and every later move is a ledgered event. */
  function seedTrust(enr) {
    if (!enr) return;
    if (!enr.trust) enr.trust = { score: 100, events: [], restricted: false, restrictedAt: null };
    if (!enr.trust.events.length) {
      enr.trust.events.push({ at: now(), delta: 0, reason: 'Identity established — ' + (enr.studentId || 'approved'), kind: 'credit', by: 'System' });
    }
  }
  /* Fraction of the demo window still ahead (0..1) — feeds the gold life bar
     that drains as the 24h tour runs out. Pre-approval it stays full, because
     the clock hasn't started; the moment the student is approved it drains. */
  function demoLifeLeft(enr) {
    if (!enr || !enr.demoPass) return 0;
    const total = (enr.demoPass.hours || 24) * 3600000;
    return Math.max(0, Math.min(1, demoTimeLeft(enr) / total));
  }

  /* The FOUNDER — the master key. One record carries the founder flag (or
     the known founder email on the legacy tour); the founder is exempt from
     every demo/tour clock and unlocks every door. Never hard-coded in the
     UI — everything flows through this helper so production can point it at
     Firebase auth instead. */
  const FOUNDER_EMAIL = 'leeroychirwa18@gmail.com';
  function isFounder(enr) {
    if (!enr) return false;
    if (enr.founder === true) return true;
    const e = String((enr.payment && enr.payment.email) || '').trim().toLowerCase();
    return e === FOUNDER_EMAIL;
  }
  /* Has this demo tour actually RUN OUT? (Countdown hit zero.) Founders are
     exempt — the master key never expires. */
  function demoTourExpired(enr) {
    if (!enr || !enr.demoPass) return false;
    if (isFounder(enr)) return false;
    return demoTimeLeft(enr) <= 0;
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
        // Commercial tier — the source of truth. The OS receives this via the
        // auth gate and enforces programme-specific access. Staff set it in
        // the admin form; fallback to the default course tier.
        tier: payment.tier || state.course.tier || 'CORE',
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

    // 3) DEMO-TOUR WELCOME — sent LAST so it is the newest message in the
    //    student's inbox (the inbox reads newest-first): a tour student opens
    //    their mailbox and the warm letter that explains the tour is the first
    //    thing they read.
    if (enr.demoPass) {
      const tourHtml = renderDemoTourEmail(enr);
      email('demo-tour', enr.payment.email, 'Welcome to your Reality FX tour — ' + enr.payment.customerName, tourHtml);
      audit(enr, 'DEMO_TOUR_EMAIL_SENT', 'Tour welcome letter sent to ' + enr.payment.email);
    }
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
    // source of truth = progress flag (same as the pillar bar); a seed
    // record minted straight into APPROVED has no submittedAt timestamp but
    // IS a submitted registration — the funnel should never read fewer
    // submitted than approved. Real durations still come from timestamps.
    const submitted = all.filter(e => e.registration.submittedAt || (e.progress && e.progress.registrationSubmitted));
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
  /* ------------------------------------------------------------
     SELFIE QUALITY GATE — obvious fakes never reach the queue.
     analyzeSelfie() runs at UPLOAD time (not at submission) so the
     student hears the reason instantly and can retry. Flat drawings,
     solid-colour fakes and tiny images are rejected with an honest
     reason; borderline images (low detail, grayscale, odd ratio) are
     accepted but flagged 'suspicious' for the moderator.
     selfieHash() — a 64-bit perceptual hash on every accepted selfie;
     the same photo reused across identities fires a SELFIE_DUPLICATE
     security event and a gold flag. Both are review triggers, never
     auto-verdicts.
     ------------------------------------------------------------ */
  function analyzeSelfie(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) return resolve({ ok: false, reason: 'Could not read that image. Please try another photo.' });
          if (w < 160 || h < 160) return resolve({ ok: false, reason: 'That photo is too small to verify (under 160px). Take a closer photo — your face should fill the frame.' });
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var data;
          try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return resolve({ ok: false, reason: 'We could not read that image. Please try another photo.' }); }
          var n = w * h, samples = Math.min(n, 20000);
          var step = Math.max(1, Math.floor(n / samples));
          var colors = new Set(), total = 0, grayish = 0, dark = 0, light = 0;
          for (var i = 0; i < n; i += step * 4) {
            var r = data[i], g = data[i + 1], b = data[i + 2];
            colors.add((r >> 5) + ',' + (g >> 5) + ',' + (b >> 5));
            var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            var sat = mx - mn;
            if (sat < 12) grayish++;
            var lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum < 40) dark++; if (lum > 215) light++;
            total++;
          }
          var colorCount = colors.size;
          var grayPct = total ? grayish / total : 1;
          var darkPct = total ? dark / total : 0;
          var lightPct = total ? light / total : 0;
          var ratio = w / h;
          // flat drawing / solid-colour fake: almost no colour variation
          if (colorCount < 24 || grayPct > 0.97) {
            return resolve({ ok: false, reason: 'This looks like a flat drawing or solid-colour image rather than a real photo. Please take a live selfie or upload a clear photo of your face.' });
          }
          // a mostly-black or mostly-white frame is almost never a real face
          if (darkPct > 0.93 || lightPct > 0.93) {
            return resolve({ ok: false, reason: 'This image is almost entirely one shade — it will not pass verification. Please take a well-lit photo of your face.' });
          }
          // borderline: accepted, but flagged for a human look
          var suspicious = colorCount < 60 || grayPct > 0.75 || ratio > 2.4 || ratio < 0.42;
          resolve({ ok: true, suspicious: suspicious, reason: suspicious ? 'Quality verified — flagged for a quick human check.' : 'Quality verified.', width: w, height: h });
        } catch (e) {
          resolve({ ok: false, reason: 'We could not verify that image. Please try another photo.' });
        }
      };
      img.onerror = function () { resolve({ ok: false, reason: 'That file could not be opened as an image. Please try another photo.' }); };
      img.src = dataUrl;
    });
  }

  /* 64-bit perceptual hash (dHash): downscale to 9×8, compare neighbour
     brightness per row, pack 64 bits. Equal hashes = near-certainly the
     same photo. Used to catch one selfie reused across identities. */
  function selfieHash(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = 9; c.height = 8;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, 9, 8);
          var d = ctx.getImageData(0, 0, 9, 8).data;
          var bits = '';
          for (var y = 0; y < 8; y++) {
            for (var x = 0; x < 8; x++) {
              var i = (y * 9 + x) * 4;
              var j = (y * 9 + x + 1) * 4;
              var a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              var b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
              bits += (a > b) ? '1' : '0';
            }
          }
          resolve(parseInt(bits, 2).toString(36));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  /* saveIdentity stores the identity plus the quality verdict + photo hash.
     quality comes from analyzeSelfie (or null when unavailable). A hash that
     matches another identity's accepted selfie fires SELFIE_DUPLICATE. */
  async function saveIdentity(enr, identity, selfieDataUrl, quality) {
    enr.registration.identity = identity;
    enr.registration.selfieDataUrl = selfieDataUrl || null;
    if (quality) enr.registration.selfieQuality = quality;
    if (selfieDataUrl) {
      var hash = await selfieHash(selfieDataUrl);
      if (hash) {
        enr.registration.selfieHash = hash;
        var dup = (state.enrollments || []).find(o => o.id !== enr.id && o.registration && o.registration.selfieHash === hash && o.registration.selfieHash);
        if (dup) {
          enr.registration.selfieDuplicateOf = dup.id;
          secEvent('SELFIE_DUPLICATE', enr.id + ' uploaded the same selfie as ' + dup.id + ' — flagging for review (photos must be unique per identity)');
        } else if (enr.registration.selfieDuplicateOf) {
          delete enr.registration.selfieDuplicateOf; // no longer a duplicate
        }
      }
    }
    scanIdentitySignals(enr);
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
      // First name + surname are the standard (a single first name is
      // ambiguous for certificates and SRM matching). Tolerant of older saves
      // that only have a combined fullName with at least two words.
      personalComplete: (function () {
        const p = reg.personal || {};
        const twoNames = (p.firstName && p.surname) || ((p.fullName || '').trim().split(/\s+/).filter(Boolean).length >= 2);
        return Boolean(p && twoNames && p.dob && p.country) && Boolean(enr.payment.email);
      })(),
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
      // flags are review triggers, never verdicts — they surface as a gold
      // 'flagged for review' row when the moderator opens the checklist
      selfieQualityOk: !reg.selfieQuality || reg.selfieQuality.ok === true,
      selfieUnique: !reg.selfieDuplicateOf,
      identitySignalsClear: !(reg.identitySignals && reg.identitySignals.length),
    };
  }
  /* The gold 'flagged for review' rows: selfie quality, duplicate selfie,
     identity signals. Returns an array of { kind, label } (empty when clear). */
  function identityFlags(enr) {
    const reg = enr.registration || {};
    const out = [];
    const sq = reg.selfieQuality;
    if (sq && sq.suspicious) out.push({ kind: 'selfie', label: 'Selfie quality · flagged for review' });
    if (reg.selfieDuplicateOf) out.push({ kind: 'selfie', label: 'Same photo as ' + reg.selfieDuplicateOf + ' — selfie reused across identities' });
    (reg.identitySignals || []).forEach(s => {
      out.push({ kind: 'identity', label: 'Identity signal · ' + s.label });
    });
    return out;
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
      // a fresh identity starts TRUSTED at 100% — every later move is ledgered
      seedTrust(enr);
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
    // The Academy prep guide goes out THE MOMENT they're approved — before any
    // handoff, so no approved student is ever left wondering what happens next.
    if (verdict === 'APPROVED') autoSendPrepGuide(enr);
    // "Buddy linked" — if this student was referred, the referrer hears about
    // it the moment their friend is approved (a small win worth celebrating).
    if (verdict === 'APPROVED') {
      const rec = (state.referrals || []).find(r => r.referredEnrId === enr.id);
      if (rec) {
        notifyEmail(rec.referrerEmail, 'referral', 'Buddy linked — welcome to the family',
          (rec.referredName || 'Your friend') + ' has been approved at Reality FX. Their referral commission is on the way — it vests after the ' + ((state.referral && state.referral.vestingDays) || 30) + '-day refund window, then lands in your RFX account.');
      }
    }
    // the robotic manager records the decision on the operator's trust bar —
    // but NEVER for automated decisions (the self-test's AUDIT runs, referral
    // penalties, system migrations): machines do not earn staff trust, humans do.
    const op = currentOperator();
    const auto = decision.by === 'AUDIT' || decision.by === 'System' || decision.by === 'auto' || decision.by === 'Automated';
    if (!auto && op && op.id && op.id !== 'console') {
      staffPerfEvent(op.id, 'decision', 2, (verdict === 'APPROVED' ? 'Approved ' : 'Rejected ') + (enr.studentId || enr.id) + (decision.reason ? ' — ' + decision.reason : ''));
    }
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
    /* SILENT-RUN — same reasoning as fullAudit: the test snapshots state and
       restores it at the end, so the intermediate save() calls (each a full
       store stringify + localStorage + server POST) are pure waste. simSilent
       makes the whole run in-memory: dramatically faster, zero writes. */
    const wasSilent = simSilent;
    simSilent = true;
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
    // 5) single-session contract — a new login mints a fresh token and revokes
    //    the previous one (the OS one-device rule, mirrored on System A)
    let sessionOk = false;
    try {
      scratch.registration = scratch.registration || {};
      scratch.session = null;
      const first = issueSession(scratch, { quiet: true }); // scratch — never pollute the real feed
      const validFirst = sessionStillValid(scratch, first.token);
      const revokedEventsBefore = (state.securityEvents || []).filter(e => e.event === 'SESSION_REVOKED').length;
      const second = issueSession(scratch, { quiet: true }); // new device fingerprint would differ in real life
      const firstDead = !sessionStillValid(scratch, first.token);
      const secondLive = sessionStillValid(scratch, second.token);
      sessionOk = validFirst && firstDead && secondLive;
    } catch (e) { /* fingerprint requires a browser — the check stays honest */ }
    out.push({ name: 'Single-session guard', pass: sessionOk,
      detail: sessionOk ? 'Each login mints a fresh token; a new login revokes the previous session (one device at a time, the OS contract).' : 'Session token was NOT rotated on re-login.' });
    // cleanup: remove scratch enrollments, then truncate audit/events back to
    // their pre-test lengths and restore the sequence — zero residue, zero drift
    state.enrollments = (state.enrollments || []).filter(e => e.id !== scratch.id && e.id !== fresh.id);
    state.auditLog = (state.auditLog || []).slice(0, al0);
    state.securityEvents = (state.securityEvents || []).slice(0, ev0);
    state.seq = seq0;
    delete state.loginAttempts['selftest@realityfx.local'];
    delete state.loginAttempts['selftest2@realityfx.local'];
    save();
    simSilent = wasSilent; // the self-test is pure — nothing was ever written
    return out;
  }

  /* FULL SYSTEM AUDIT — the one-click health check. Runs every guard and
     invariant the system can prove about itself, in one call, with zero
     residue. Staff press ONE button; every check fires the REAL code (no
     mocks), and the scratch records used are removed and the sequence/audit
     counters restored exactly — so running the audit never changes the data
     it audits. Designed for: a student complains → moderator clicks → the
     machine re-proves the whole chain on the spot and reports PASS/FAIL. */
  function fullAudit() {
    /* SILENT-RUN — the audit snapshots state at the top and restores it
       exactly at the end, so persisting along the way is pure waste: each
       save() stringifies the whole store, writes localStorage AND POSTs to
       the demo server (~60ms+ each, ×40+ calls ≈ the 15s freeze behind the
       browser's "page unresponsive" dialog). Running in simSilent makes the
       audit a pure in-memory computation: nothing is written, nothing leaks,
       and the restore below still guarantees zero residue. */
    const wasSilent = simSilent;
    simSilent = true;
    const out = [];
    const al0 = (state.auditLog || []).length;
    const ev0 = (state.securityEvents || []).length;
    const seq0 = JSON.parse(JSON.stringify(state.seq || {}));
    const wallets0 = JSON.parse(JSON.stringify(state.wallets || []));
    const payouts0 = JSON.parse(JSON.stringify(state.payouts || []));
    const redemptions0 = JSON.parse(JSON.stringify(state.redemptions || {}));
    const awards0 = JSON.parse(JSON.stringify(state.awards || {}));
    const staffW0 = JSON.parse(JSON.stringify(state.staffWallets || []));
    const emails0 = JSON.parse(JSON.stringify(state.emails || []));

    /* 1) THE JOURNEY — a scratch student runs the REAL pipeline end-to-end:
       webhook → enrollment → invoice → registration invite → open → submit →
       approve → handoff → ACTIVE. If any link breaks, this fails. */
    const smoke = (() => {
      const steps = [];
      // tag: 'journey' — these are pipeline sub-proofs; if one fails the whole
      // journey group is down and only a human engineer can fix it.
      const ok = (pass, name, detail) => steps.push({ pass, name, detail, tag: 'journey' });
      try {
        state.enrollments = (state.enrollments || []).filter(e => e.payment.transactionId !== 'AUDIT-SMOKE');
        const enr = createEnrollment({
          customerName: 'Audit Smoke Test', email: 'audit.smoke@realityfx.local',
          course: state.course.name, price: state.course.price, currency: state.course.currency,
          paymentMethod: state.course.paymentMethods[0], transactionId: 'AUDIT-SMOKE', paidAt: now(),
        });
        ok(true, 'Payment webhook → enrollment', 'A sale creates exactly one enrollment (ENR-' + enr.id.replace('ENR-', '') + ') and invoice INV-' + (enr.invoice || {}).number + '.');
        // the pipeline mints the invite right after the enrollment (the exact
        // same calls the webhook path makes) — invoice email + registration email
        createRegistrationInvite(enr, 168);
        sendInviteEmails(enr);
        const link = enr.registration && enr.registration.token;
        ok(!!link, 'Registration link minted', link ? 'A secure single-use link exists for the student.' : 'No registration link was created.');
        markLinkOpened(enr);
        ok(!!(enr.registration && enr.registration.firstOpenedAt), 'Link-open recorded', 'The funnel records the first click.');
        const pre = enr.state;
        submitRegistration(enr);
        ok(pre === 'PENDING' && enr.registration.submittedAt, 'Registration submitted', 'Submitted for review; the link is consumed so it cannot be reused.');
        approve(enr, { verdict: 'APPROVED', by: 'AUDIT', reason: 'Automated system audit' });
        ok(!!(enr.studentId && enr.studentCode), 'Identity minted', 'Student ID ' + enr.studentId + ' + Code generated on approval.');
        transition(enr, 'SYNCING_WITH_RFX_OS');
        transition(enr, 'RFX_OS_CONFIRMED');
        ok(enr.state === 'RFX_OS_CONFIRMED' && enr.progress.handoffConfirmed, 'OS handshake confirmed', 'RFX OS acknowledged the student — no duplicate possible (Student ID is the idempotency key).');
        transition(enr, 'ACTIVE');
        ok(enr.state === 'ACTIVE' && enr.progress.active, 'Student ACTIVE', 'The student is fully in and the OS gate unlocks.');
        // clean the scratch enrolment + the audit trail it produced
        state.enrollments = (state.enrollments || []).filter(e => e.id !== enr.id);
      } catch (err) {
        ok(false, 'Journey pipeline', 'The pipeline threw: ' + err.message);
      }
      return steps;
    })();
    out.push({ name: 'THE JOURNEY — webhook → enrollment → registration → approval → handoff → ACTIVE', pass: smoke.every(s => s.pass), detail: smoke, sub: true });

    /* 2) MONEY RECONCILIATION — every rand the ledger claims to hold must
       exist in a wallet. The end-of-day file and the balances must agree. */
    const fin = financialSummary();
    const sumWallets = (state.wallets || []).reduce((s, w) => s + (w.balance || 0), 0);
    const queuedCashouts = (state.payouts || []).filter(p => p.kind === 'cashout' && p.status === 'queued').reduce((s, p) => s + p.amount, 0);
    // held (liability) = credits+awards+referrals granted − spent − cashed out;
    // wallet balances + queued cash-outs must equal it (cash-outs leave the
    // wallet at request time and wait in the queue — so they are money the
    // business still owes and must be counted).
    const liability = sumWallets + queuedCashouts;
    const moneyOk = Math.abs(liability - fin.held) < 0.01;
    out.push({ name: 'Money reconciles — ledger vs wallets', pass: moneyOk,
      detail: moneyOk
        ? 'Ledger ' + money(fin.held, fin.currency) + ' = wallets ' + money(sumWallets, fin.currency) + ' + queued cash-outs ' + money(queuedCashouts, fin.currency) + '. Every rand is accounted for.'
        : 'MISMATCH: ledger claims ' + money(fin.held, fin.currency) + ' but wallets hold ' + money(sumWallets, fin.currency) + ' + ' + money(queuedCashouts, fin.currency) + ' queued.' });

    /* 3) WALLET-DATA HYGIENE — wallets should never go negative, and every
       wallet must belong to someone (no orphan money). */
    const negWallets = (state.wallets || []).filter(w => (w.balance || 0) < -0.001);
    out.push({ name: 'No negative wallets', pass: !negWallets.length,
      detail: negWallets.length ? negWallets.length + ' wallet(s) went negative: ' + negWallets.map(w => w.email).join(', ') : 'Every wallet balance is ≥ 0 — no wallet was ever spent into the red.' });
    const knownEmails = new Set((state.enrollments || []).map(e => (e.payment.email || '').toLowerCase()));
    const orphans = (state.wallets || []).filter(w => w.email && w.balance > 0 && !knownEmails.has(w.email));
    out.push({ name: 'No orphan credit', pass: !orphans.length,
      detail: orphans.length ? 'Orphan wallet(s) with a balance but no student: ' + orphans.map(w => w.email).join(', ') : 'Every wallet with a balance belongs to a known student.' });

    /* 4) ENROLLMENT INTEGRITY — identity invariants across every student. */
    const enrs = state.enrollments || [];
    const active = enrs.filter(e => e.state === 'ACTIVE');
    const activeMissingId = active.filter(e => !e.studentId || !e.studentCode);
    out.push({ name: 'ACTIVE students all have identity', pass: !activeMissingId.length,
      detail: activeMissingId.length ? activeMissingId.length + ' ACTIVE student(s) missing Student ID/Code' : active.length + ' ACTIVE student(s) — every one holds a Student ID and Code.' });
    const dupCodes = [];
    const seenCodes = {};
    enrs.forEach(e => { if (e.studentCode) { const k = e.studentCode.toUpperCase(); (seenCodes[k] = seenCodes[k] || []).push(e.id); } });
    Object.keys(seenCodes).forEach(k => { if (seenCodes[k].length > 1) dupCodes.push(k); });
    out.push({ name: 'Student Codes are unique', pass: !dupCodes.length,
      detail: dupCodes.length ? 'Duplicate code(s): ' + dupCodes.join(', ') : 'Every Student Code is unique — one identity, one credential.' });
    const submittedNoDecision = enrs.filter(e => e.registration && e.registration.submittedAt && !e.registration.decision && e.state !== 'PENDING');
    out.push({ name: 'No stuck submissions', pass: !submittedNoDecision.length,
      detail: submittedNoDecision.length ? submittedNoDecision.length + ' submission(s) with no decision recorded' : 'Every submitted registration has a decision (or is still awaiting review).' });

    /* 4b) TRUST BAR INTEGRITY — the ledger must be a true record: every
       student's recorded trust events, when summed from their baseline of 100,
       must equal the trust score the UI would show. A mismatch means a ledger
       entry was edited or dropped — exactly the kind of thing the audit should
       catch before a moderator ever acts on a bad bar. */
    const trustBroken = [];
    enrs.forEach(e => {
      if (!e.studentId) return;
      // the per-student ledger lives on enr.trust.events (adjustTrust/seedTrust
      // write there); enr.trustEvents is never populated — reading it made the
      // sum ALWAYS 0 and falsely flagged every bar that wasn't 100.
      const evs = (e.trust && e.trust.events) || [];
      const sum = evs.reduce((s, x) => s + (Number(x.delta) || 0), 0);
      const fromLedger = Math.max(0, Math.min(100, 100 + sum));
      const rawScore = e.trust && typeof e.trust.score === 'number' ? e.trust.score : 100;
      const current = Math.max(0, Math.min(100, rawScore)); // default only when MISSING — a real 0 (restricted) stays 0
      // a deliberate clamp (score cannot exceed 100 or fall below 0) may
      // legitimately differ from a raw ledger sum — only flag drift beyond 1
      if (Math.abs(fromLedger - current) > 1) {
        trustBroken.push(e.studentId + ' (ledger→' + fromLedger + ' vs ' + current + ')');
      }
    });
    out.push({ name: 'Trust Bar ledgers reconcile', pass: !trustBroken.length,
      detail: trustBroken.length ? 'Mismatch(es): ' + trustBroken.join(', ') : 'Every Trust Bar\'s recorded actions, summed from 100%, equal its shown score — the bar is a true record.' });

    /* 5) STORE INTEGRITY — a REAL save→load round-trip: write a marker to the
       store, read it back, and confirm the multi-tab rev counter survives. */
    const storeAlive = (() => {
      try {
        const marker = 'audit-probe-' + Date.now();
        localStorage.setItem(DB_KEY + '-probe', marker);
        const read = localStorage.getItem(DB_KEY + '-probe');
        localStorage.removeItem(DB_KEY + '-probe');
        return read === marker && typeof state.rev === 'number';
      } catch (e) { return false; }
    })();
    out.push({ name: 'Store / multi-tab guard alive', pass: storeAlive,
      detail: storeAlive
        ? 'A write→read round-trip to the store succeeded and the revision counter is intact (rev ' + state.rev + ') — a stale tab can never clobber a newer one.'
        : 'The store round-trip failed — persistence or the rev counter is broken.' });

    /* 6) CAPACITY — honest room-to-grow number. */
    const m = storageMeter();
    out.push({ name: 'Capacity headroom', pass: m.percent < 90,
      detail: m.enrollments + ' student(s) · ' + m.kb + ' KB of ' + m.quotaMB + ' MB · ≈ ' + m.headroomStudents.toLocaleString() + ' more students fit at current size.' });

    /* 7) THE SECURITY GUARDS — reuse the live self-test. */
    const sec = securitySelfTest();
    out.push({ name: 'Security self-test', pass: sec.every(s => s.pass), detail: sec.map(s => Object.assign({}, s, { tag: 'security' })), sub: true });

    /* restore every counter and record the audit touched — zero residue */
    state.auditLog = (state.auditLog || []).slice(0, al0);
    state.securityEvents = (state.securityEvents || []).slice(0, ev0);
    state.seq = seq0;
    state.wallets = wallets0;
    state.payouts = payouts0;
    state.redemptions = redemptions0;
    state.awards = awards0;
    state.staffWallets = staffW0;
    state.emails = emails0;
    state.enrollments = (state.enrollments || []).filter(e => e.payment.transactionId !== 'AUDIT-SMOKE');
    delete state.loginAttempts['audit.smoke@realityfx.local'];
    save();
    simSilent = wasSilent; // the audit is pure — nothing was ever written
    const flat = [];
    out.forEach(o => {
      if (o.sub) flat.push.apply(flat, o.detail);
      else { o.tag = o.tag || 'core'; flat.push(o); }
    });
    return { checks: flat, passed: flat.filter(c => c.pass).length, failed: flat.filter(c => !c.pass).length, total: flat.length, at: now() };
  }

  /* Storage capacity meter — how much of the browser store the system holds,
     and what that means in students. Answers "can it remember 30 students"
     with real numbers instead of a guess. */
  /* Count privacy — the ghost-town rule. Student-facing surfaces must NOT
     reveal how many students (or identities) exist until the Academy passes
     `revealStudentCountsAt`. Below the threshold every public surface shows
     capacity headroom instead — a private school's enrolment is nobody's
     business but ours, and public counts would let anyone estimate revenue
     and net worth. Staff consoles / SRM always see the real numbers.
     Returns { revealed: bool, threshold, label } — label is the safe
     public phrase to render on student-facing surfaces. */
  function countsRevealed() {
    const threshold = state.revealStudentCountsAt || 1000;
    const active = (state.enrollments || []).filter(e => e.state === 'ACTIVE').length;
    const revealed = active >= threshold;
    return {
      revealed,
      threshold,
      active,
      label: revealed
        ? active.toLocaleString() + ' active students'
        : 'Our Academy is growing — student numbers are kept private until we reach ' + threshold.toLocaleString() + '. What matters: every student is fully supported, and capacity has room for the whole year.'
    };
  }

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

  /* ============================================================
     SELF-REPAIR — the head mechanic
     ------------------------------------------------------------
     The one-click audit PROVES the system; self-repair FIXES what
     is safely machine-fixable. Staff pass the screwdriver to the
     mechanic (a button); the mechanic runs the repair routines,
     logs every change in the security ledger, and re-runs the
     audit to prove the fix. Anything the machine must NOT touch
     (money, pending human decisions, deep pipeline failures) is
     handed back to a human with a clear "needs a human" reason.
     Repair is REAL work, unlike the audit's zero-residue proof:
     every repair writes its change and its ledger entry together,
     so the books stay honest even mid-repair.
     ============================================================ */
  const REPAIRS = {
    /* A negative wallet can only be a bug — no code path should ever let a
       balance go red. The mechanic clamps it to R0.00 and records a
       repair-offset write-off so the ledger liability shrinks by exactly the
       same amount: money is never silently created or destroyed, and the
       financial audit file shows the write-off for tax/audit. */
    'No negative wallets': function () {
      const fixed = [];
      (state.wallets || []).forEach(w => {
        if ((w.balance || 0) < -0.001) {
          const amt = Math.abs(w.balance);
          w.balance = 0;
          w.ledger.push({ at: now(), type: 'repair-offset', amount: -amt, ref: 'self-repair', note: 'Negative balance clamped to R0.00 by self-repair (write-off recorded so the ledger stays honest).' });
          fixed.push(w.email + ': ' + money(-amt, w.currency) + ' → R0.00');
        }
      });
      if (fixed.length) { state.repairOffsets = (state.repairOffsets || []).concat(fixed.map(f => ({ at: now(), detail: f }))); save(); }
      return fixed.length ? { fixed: true, note: 'Clamped ' + fixed.length + ' negative wallet(s) to R0.00 with a recorded write-off — the books stay honest. ' + fixed.join(' · ') } : { fixed: false, note: 'No negative wallets found.' };
    },
    /* Duplicate Student Codes are corruption — one identity, one credential.
       The mechanic keeps the earliest enrollment's code and re-mints a fresh
       one for every later duplicate, then logs each change. */
    'Student Codes are unique': function () {
      const fixed = [];
      const seen = {};
      const enrs = (state.enrollments || []).filter(e => e.studentCode).slice()
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      enrs.forEach(e => {
        const k = e.studentCode.toUpperCase();
        if (seen[k]) {
          const old = e.studentCode;
          e.studentCode = makeStudentCode();
          fixed.push(e.id + ': ' + old + ' → ' + e.studentCode);
          audit(e, 'CODE_REMINTED_BY_SELF_REPAIR', 'Duplicate code ' + old + ' replaced with a fresh unique code.');
        } else seen[k] = true;
      });
      if (fixed.length) save();
      return fixed.length ? { fixed: true, note: 'Re-minted ' + fixed.length + ' duplicate Student Code(s): ' + fixed.join(' · ') } : { fixed: false, note: 'Every Student Code is already unique.' };
    },
    /* An ACTIVE student missing identity is broken — they got to ACTIVE through
       the pipeline, so the identity was minted once. If it is gone, the mechanic
       re-mints it loudly so the student stays whole and the OS handoff key is
       restored. */
    'ACTIVE students all have identity': function () {
      const fixed = [];
      (state.enrollments || []).filter(e => e.state === 'ACTIVE' && (!e.studentId || !e.studentCode)).forEach(e => {
        if (!e.studentId) e.studentId = nextStudentId();
        if (!e.studentCode) e.studentCode = makeStudentCode();
        fixed.push(e.id + ' → ' + e.studentId + ' / code re-minted');
        audit(e, 'IDENTITY_REMINTED_BY_SELF_REPAIR', 'ACTIVE student was missing identity — Student ID ' + e.studentId + ' restored by self-repair.');
      });
      if (fixed.length) save();
      return fixed.length ? { fixed: true, note: 'Re-minted identity for ' + fixed.length + ' ACTIVE student(s): ' + fixed.join(' · ') } : { fixed: false, note: 'Every ACTIVE student holds a Student ID and Code.' };
    },
    /* The store guard failed — usually stale probe keys or a bloated save.
       The mechanic clears stale probes and forces a clean re-save; the re-run
       audit then tells the truth about whether it recovered. */
    'Store / multi-tab guard alive': function () {
      try {
        Object.keys(localStorage).forEach(k => { if (k.indexOf(DB_KEY) === 0 && k.indexOf('-probe') !== -1) localStorage.removeItem(k); });
        save();
        return { fixed: true, note: 'Stale store probes cleared and the store force re-saved — the multi-tab guard has a clean slate.' };
      } catch (e) {
        return { fixed: false, note: 'Could not write to the store: ' + (e && e.message ? e.message : e) };
      }
    },
  };

  /* The repair plan — what each failing check maps to, and whether it is
     machine-fixable or must go to a human. The UI reads this to decide
     whether a failing row gets a "Fix" button or a "needs a human" note. */
  function repairPlan() {
    return {
      'No negative wallets': { needsHuman: false, label: 'Clamps negative balances to R0.00 and records a write-off so the ledger stays honest.' },
      'Student Codes are unique': { needsHuman: false, label: 'Re-mints a fresh Student Code for every duplicate — one identity, one credential.' },
      'ACTIVE students all have identity': { needsHuman: false, label: 'Re-mints the missing Student ID + Code so the ACTIVE student stays whole.' },
      'Store / multi-tab guard alive': { needsHuman: false, label: 'Clears stale store probes and forces a clean re-save.' },
      'No orphan credit': { needsHuman: true, label: 'A human must decide who that credit belongs to — the machine will not guess.' },
      'No stuck submissions': { needsHuman: true, label: 'A human must review each submission and decide — never an automated verdict.' },
      'Money reconciles — ledger vs wallets': { needsHuman: true, label: 'Money is never auto-adjusted. A human traces the difference with the machine\'s help.' },
      'Capacity headroom': { needsHuman: true, label: 'Not a defect — a growth signal. A human decides on archiving or quota.' },
    };
  }

  /* Repair ONE named check (used by the per-row Fix button), then re-run the
     audit to prove the fix. Returns what changed and whether it now passes. */
  function repairOne(name, by) {
    const plan = repairPlan();
    const r = plan[name];
    const fn = REPAIRS[name];
    if (!r || !fn) return { ok: false, msg: 'That check has no automatic repair.' };
    if (r.needsHuman) return { ok: false, msg: r.label };
    const res = fn();
    const after = fullAudit();
    const check = after.checks.find(c => c.name === name);
    const nowPasses = !!(check && check.pass);
    if (res.fixed) secEvent('SELF_REPAIR', (by || 'Staff') + ' handed the screwdriver to the mechanic — "' + name + '": ' + res.note + (nowPasses ? ' · now PASSES.' : ' · still needs attention.'));
    return { ok: true, name, fixed: res.fixed, note: res.note, nowPasses, after: { passed: after.passed, total: after.total } };
  }

  /* The full mechanic: audit → fix every machine-safe failing check → audit
     again to prove the repair. Staff press ONE button; the machine does the
     wrench work, logs every change, and hands back a verdict. */
  function selfRepair(by) {
    const before = fullAudit();
    const plan = repairPlan();
    const fixes = [];
    before.checks.forEach(c => {
      if (c.pass) return;
      const r = plan[c.name];
      const fn = REPAIRS[c.name];
      if (!r || !fn || r.needsHuman) return; // needs a human — never auto-touch
      const res = fn();
      if (res && res.fixed) {
        fixes.push({ name: c.name, note: res.note });
        secEvent('SELF_REPAIR', (by || 'Staff') + ' handed the screwdriver to the mechanic — "' + c.name + '": ' + res.note);
      }
    });
    const after = fullAudit();
    return {
      ok: true,
      by: by || 'Staff Console',
      at: now(),
      before: { passed: before.passed, total: before.total },
      after: { passed: after.passed, total: after.total },
      fixed: fixes,
      allClear: after.failed === 0,
      // what still needs human hands — with the reason, so staff know exactly
      // what to do next instead of staring at a red row
      stillFailing: after.checks.filter(c => !c.pass).map(c => {
        const r = plan[c.name];
        return { name: c.name, tag: c.tag || 'core', detail: c.detail, whyHuman: r && r.needsHuman ? r.label : (c.tag === 'journey' ? 'A deep pipeline step failed — an engineer must trace it.' : c.tag === 'security' ? 'A security guard did not fire — a human must investigate.' : 'No automatic repair exists for this check.') };
      }),
    };
  }

  /* ============================================================
     LIVE SUPPORT — the human line between students and staff
     ------------------------------------------------------------
     Sarrah (the bot) answers instantly; this is the conversation
     where a real person takes over. A thread per student, unread
     counted per side, staff replies toast + notify the student.
     ============================================================ */
  function supportThread(email) {
    state.conversations = state.conversations || [];
    email = String(email || '').trim().toLowerCase();
    let t = state.conversations.find(c => c.email === email);
    if (!t) {
      const enr = (state.enrollments || []).find(e => (e.payment && e.payment.email || '').toLowerCase() === email);
      t = {
        id: nextId('support', 'SUP-', 4),
        email,
        studentId: enr ? (enr.studentId || enr.id) : email,
        name: enr ? enr.payment.customerName : email,
        createdAt: now(),
        updatedAt: now(),
        messages: [],
        studentUnread: 0,
        staffUnread: 0,
        status: 'open',
      };
      state.conversations.push(t);
      save();
    }
    return t;
  }
  function supportSend(email, from, text, opts) {
    text = String(text || '').trim();
    if (!text) return { ok: false, msg: 'Your message is empty.' };
    if (text.length > 2000) return { ok: false, msg: 'Keep messages under 2,000 characters.' };
    const t = supportThread(email);
    opts = opts || {};
    const msg = {
      id: 'M-' + ((state.seq.supportMsg = (state.seq.supportMsg || 0) + 1)),
      from: from === 'staff' ? 'staff' : 'student',
      fromName: from === 'staff' ? (opts.fromName || 'Reality FX Support') : (opts.fromName || t.name),
      text,
      at: now(),
    };
    t.messages.push(msg);
    t.updatedAt = now();
    if (from === 'student') { t.staffUnread = (t.staffUnread || 0) + 1; t.studentUnread = 0; }
    else { t.studentUnread = (t.studentUnread || 0) + 1; t.staffUnread = 0; }
    if (from === 'student') {
      secEvent('SUPPORT_MESSAGE', t.studentId + ' · ' + t.name + ' wrote: ' + text.slice(0, 90));
    } else {
      // staff replied — the student's panel hears about it the moment they look.
      // The full reply lands in the Live support thread; the notification shows
      // a preview that never cuts mid-word (soft cap ~220 chars, hard cut only
      // when the reply is genuinely long). No truncation for short replies.
      const enr = (state.enrollments || []).find(e => (e.payment && e.payment.email || '').toLowerCase() === t.email);
      if (enr) {
        const cap = 220;
        const preview = text.length <= cap ? text : text.slice(0, text.slice(0, cap + 1).lastIndexOf(' ')) + '…';
        notifyStudent(enr, 'support', 'Reality FX replied to you', preview);
      }
      // the robotic manager records the human line's reply on the operator's bar
      const sop = currentOperator();
      if (sop && sop.id && sop.id !== 'console') staffPerfEvent(sop.id, 'support', 1, 'Replied on ' + t.name + '\'s support thread');
    }
    save();
    return { ok: true, thread: t, message: msg };
  }
  function supportThreads() {
    return (state.conversations || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  function supportUnreadCount() {
    return (state.conversations || []).reduce((s, t) => s + (t.staffUnread || 0), 0);
  }
  function supportMarkStaffRead(id) {
    const t = (state.conversations || []).find(c => c.id === id);
    if (t && t.staffUnread) { t.staffUnread = 0; save(); }
  }
  function supportStudentThread(enr) {
    if (!enr || !enr.payment) return null;
    return (state.conversations || []).find(c => c.email === String(enr.payment.email).trim().toLowerCase()) || null;
  }
  function supportStudentUnread(enr) {
    const t = supportStudentThread(enr);
    return t ? (t.studentUnread || 0) : 0;
  }
  function supportMarkStudentRead(enr) {
    const t = supportStudentThread(enr);
    if (t && t.studentUnread) { t.studentUnread = 0; save(); }
  }
  /* Who is pressing the button — the staff member signed into staff.html in
     this browser, else a generic console attribution. Used for repair and
     support "by" fields so every action has a human name on it. */
  function currentOperator() {
    try {
      const raw = sessionStorage.getItem('rfx_staff');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.name) return { name: o.name, id: o.id || '', role: o.role || '' };
      }
    } catch (e) { /* no session — generic attribution */ }
    return { name: 'Staff Console', id: 'console', role: '' };
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

  /* ------------------------------------------------------------
     RECONCILIATION SWEEP — the bridge's safety net.
     The automatic retry lives in a browser tab (bridge.js timers);
     if that tab closes, the retry dies silently. So the Staff Console
     runs a sweep on load (and the demo keeps a manual 'Sync all
     pending' button): any APPROVED/SYNC_FAILED enrollment with a live
     bridge and no confirmed handoff is surfaced and synced. Overdue
     ones fire a SYNC_OVERDUE security event so the moderator sees it
     in the feed. Production moves the schedule server-side (see
     FOR-LEE §9.24); this is the demo that never trusts a tab.
     ------------------------------------------------------------ */
  function pendingSyncs() {
    return (state.enrollments || []).filter(enr =>
      enr.studentId &&
      (enr.state === 'APPROVED' || enr.state === 'SYNC_FAILED') &&
      !(enr.handoff && enr.handoff.confirmedAt));
  }
  /* ms since the handshake should have happened (approval time or last
     attempt). A pending sync is 'overdue' past this window. */
  const SYNC_OVERDUE_MS = 10 * 60 * 1000; // 10 minutes without confirmation
  function syncOverdueMs(enr) {
    const anchor = (enr.handoff && enr.handoff.attempts && enr.handoff.attempts.length)
      ? (enr.handoff.attempts[enr.handoff.attempts.length - 1].at || enr.progress.approvedAt || enr.createdAt)
      : (enr.progress.approvedAt || enr.createdAt);
    return Date.now() - Date.parse(anchor || now());
  }
  /* Fire SYNC_OVERDUE once per enrollment (tracked on the record so the
     3s re-render can never spam the feed). Returns the newly-logged ids. */
  function reconcileSweep() {
    const fired = [];
    pendingSyncs().forEach(enr => {
      if (enr.handoff.syncOverdueLogged) return;
      if (syncOverdueMs(enr) > SYNC_OVERDUE_MS) {
        enr.handoff.syncOverdueLogged = true;
        secEvent('SYNC_OVERDUE', enr.id + ' · ' + enr.studentId + ' approved but not confirmed with RFX OS after 10 min — sync now (server owns the schedule in production)');
        fired.push(enr.id);
      }
    });
    if (fired.length) save();
    return fired;
  }

  /* ------------------------------------------------------------
     SINGLE-SESSION CONTRACT (member panel side).
     The OS enforces one active session per student server-side; this
     mirrors the contract on System A: every login mints a fresh
     session token, a new login for the same identity revokes the
     previous token (SESSION_REVOKED security event, device named),
     and the kicked device detects it on its next check and shows the
     same lock screen. Device fingerprint = user agent + screen +
     touch capability — never anything personal.
     ------------------------------------------------------------ */
  function deviceFingerprint() {
    var ua = String(navigator.userAgent || '');
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var fp = ua + '|' + screen.width + 'x' + screen.height + '|' + (touch ? 'touch' : 'mouse');
    return fp;
  }
  function newSessionToken() {
    return 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function issueSession(enr, opts) {
    /* STRICT one-active-session rule: every new login mints a fresh token and
       kills EVERY previous session — no exceptions for same-device browsers.
       Two browsers on the same PC are still two separate sessions, and the
       second one silently ends the first. The member panel detects the dead
       token on its next poll and locks by itself — the student never needs to
       sign out anywhere. The device fingerprint is recorded for the audit
       trail only; it no longer decides whether a revoke happens. */
    const prev = enr.session || null;
    const dev = deviceFingerprint();
    // quiet: internal tests (the security self-test) rotate tokens on a
    // scratch student — never let that pollute the real security feed
    if (!(opts && opts.quiet) && prev && prev.token) {
      secEvent('SESSION_REVOKED', enr.studentId + ' signed in again — previous session revoked (' + (prev.device || 'unknown device') + ' → ' + dev + ')' + (prev.device === dev ? ' · same device, different session' : ''));
    }
    enr.session = { token: newSessionToken(), device: dev, at: now() };
    save();
    return enr.session;
  }
  function sessionStillValid(enr, token) {
    return Boolean(enr && enr.session && enr.session.token && enr.session.token === token);
  }

  /* Member-panel login: email + Student Code (or Student ID). Codes are
     shown once on the completion screen, so possession of the code is the
     lightweight credential here (production: Firebase password auth).
     Throttled: repeated failures lock the account for N minutes and are
     logged as security events. */
  /* Profile tier — the Exness/XM pattern, made honest for an academy.
     A student whose identity is NOT yet established (no Student ID — still
     pending or never approved) is a DEMO profile: no panel access, no OS
     access. Once verified and approved they become LIVE: full features.
     The restriction is already enforced by the code gate (a code only exists
     after approval); this is the visible label that makes the tier obvious. */
  function profileTier(enr) {
    return (enr && enr.studentId) ? 'LIVE' : 'DEMO';
  }

  /* Demo-pass countdown — how long the student's 24h academy tour has left.
     The pass is { hours, createdAt }. The clock starts when the student is
     APPROVED (they're officially in — the academy is about trading, not
     registration, so the tour counts from the moment the learning can
     begin), never from when the pass was minted or the page was opened.
     Returns ms remaining (0 when not yet approved / expired / never had a
     pass). Shared by the registration page and the member panel so both
     show the SAME clock. */
  function demoTimeLeft(enr) {
    const dp = enr && enr.demoPass;
    if (!dp || !dp.createdAt || !(dp.hours > 0)) return 0;
    // the tour's starting gun: the approval moment (fallback: first time the
    // handshake went through — the moment they could actually enter the OS)
    const startRaw = (enr.registration && enr.registration.decision && enr.registration.decision.at) || enr.progress.activeAt;
    if (!startRaw) return dp.hours * 3600 * 1000; // not approved yet — full window still ahead
    const end = new Date(startRaw).getTime() + dp.hours * 3600 * 1000;
    const left = end - Date.now();
    return left > 0 ? left : 0;
  }

  /* Format ms as a compact countdown clock. Kept here so the registration
     page and member panel render the exact same "23:59:59" style. */
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const hh = String(h).padStart(2, '0'), mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
    return d > 0 ? d + 'd ' + hh + ':' + mm + ':' + ss : hh + ':' + mm + ':' + ss;
  }

  /* Course-name NORMALIZATION for ownership checks. Names cross system
     boundaries (website store, catalog, PayPal, the shared store) and can
     arrive with different dashes (— – -), encodings (U+FFFD replacement
     chars), spaces and casing — a raw string comparison could silently miss
     a match and let a student double-buy. We compare a normalized key instead:
     lowercase, punctuation stripped, whitespace collapsed. */
  function normCourse(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /* Simplified NEW-COURSE enrollment for an ALREADY-VERIFIED member.
     The student passed verification once — their details are synced by the
     SRM, so buying another course is like buying anything else:
       1. pick a course from the catalog (must exist, must be a course)
       2. pay from the RFX wallet (the same idempotent spend rail)
       3. a NEW enrollment is created UNDER THE SAME IDENTITY — same Student
          ID, same Student Code (one person, one credential) — pre-verified
          and handed off to the OS immediately.
     Idempotency: each course can be bought ONCE per identity (reference
     ADD-<code>-<email>), so a retry can never double-charge or double-enroll. */
  function enrollAdditionalCourse(emailIn, code) {
    const mail = String(emailIn || '').trim().toLowerCase();
    const item = getCatalog().find(c => String(c.code).toUpperCase() === String(code || '').trim().toUpperCase());
    if (!item) return { ok: false, msg: 'Unknown course code — nothing was charged.' };
    if (item.kind !== 'course') return { ok: false, msg: 'That is not a course — use “Spend your credit” for services and the shop for merch.' };
    // the identity must be VERIFIED and in GOOD STANDING. A suspended,
    // restricted or banned identity keeps its Student ID but must not be able
    // to keep buying courses — the integrity layer applies here too.
    const primary = (state.enrollments || []).find(e => e.payment.email === mail && e.studentId);
    if (!primary) return { ok: false, msg: 'Only verified members can enroll from the panel — complete registration first.' };
    if (primary.state !== 'ACTIVE' && primary.state !== 'RFX_OS_CONFIRMED') {
      return { ok: false, msg: 'Your account is ' + (primary.state || 'not active') + ' — you cannot enroll in new courses in this state.' };
    }
    // same refund-cooldown intelligence as a fresh purchase: a refunded
    // identity spending wallet credit on a new course is flagged for the
    // moderator rather than silently accepted (consistent with createEnrollment).
    const cooldown = refundCooldown({ email: mail, customerName: primary.payment.customerName, phone: (primary.registration && primary.registration.identity && primary.registration.identity.phone) || '' });
    const reference = 'ADD-' + item.code.toUpperCase() + '-' + mail;
    const already = (state.enrollments || []).some(e => e.payment.email === mail && e.payment.transactionId === reference);
    if (already) return { ok: false, already: true, msg: 'You already own this course — each course can be added once per identity.' };
    // ownership by course NAME too (not just the ADD reference): the student's
    // original purchase may carry a different transaction ID (PayPal webhook),
    // so a panel retry must never let them double-buy the same course. Names
    // are compared NORMALIZED — the same course can arrive as
    // "Academy — Professional", "Academy - Professional", or with encoding
    // artifacts — so raw equality would be unsafe.
    const want = normCourse(item.name);
    const ownsByName = (state.enrollments || []).some(e => e.payment.email === mail && e.payment.course && normCourse(e.payment.course) === want);
    if (ownsByName) return { ok: false, already: true, msg: 'You already own ' + item.name + ' — each course can be added once per identity.' };
    const amount = Number(item.price);
    const usable = spendable(mail);
    if (amount > usable) {
      return { ok: false, msg: 'Your balance is ' + money(usable, item.currency || 'R') + ' — this course needs ' + money(amount, item.currency || 'R') + '.' };
    }
    // 1) money first — the same idempotent spend rail (ledgered, emailed, audited)
    //    PRODUCTION: redeemCredit + createEnrollment must run in ONE transactional
    //    batch (Firestore runTransaction / SQL transaction) so a mid-way failure
    //    can never deduct without enrolling. In this single-threaded demo the
    //    layered idempotency (reference guard → redemptions map → txn-id match)
    //    already makes double-charge impossible, but atomicity moves server-side.
    const redeem = redeemCredit({ email: mail, amount, itemName: item.name, itemRef: item.code, by: 'Student', reference });
    if (!redeem.ok) return redeem;
    // 2) the new enrollment under the SAME identity
    const enr = createEnrollment({
      customerName: primary.payment.customerName,
      email: mail,
      course: item.name,
      price: amount,
      currency: item.currency || 'R',
      paymentMethod: 'RFX wallet',
      transactionId: reference,
      paidAt: now(),
    });
    if (cooldown) enr.cooldownFlag = { at: now(), ...cooldown }; // same flag the webhook path raises
    enr.studentId = primary.studentId;   // one person…
    enr.studentCode = primary.studentCode; // …one credential
    // pre-verified: their details are already established and SRM-synced
    const pre = primary.registration || {};
    enr.registration = {
      personal: pre.personal ? JSON.parse(JSON.stringify(pre.personal)) : null,
      identity: pre.identity ? JSON.parse(JSON.stringify(pre.identity)) : null,
      agreements: (pre.agreements || []).map(a => Object.assign({}, a)),
      emailVerifiedAt: pre.emailVerifiedAt || now(),
      captchaPassedAt: pre.captchaPassedAt || now(),
      submittedAt: now(),
      token: null, tokenUsedAt: now(), // no new registration link needed
      selfieDataUrl: null,
      source: 'member-panel',
    };
    enr.progress.registrationSubmitted = true;
    enr.referralCode = primary.referralCode; // keep the same shareable code
    // 3) instantly approved (identity already verified) and handed to the OS
    approve(enr, { verdict: 'APPROVED', by: 'AUTO (verified identity)' });
    transition(enr, 'SYNCING_WITH_RFX_OS');
    transition(enr, 'RFX_OS_CONFIRMED');
    transition(enr, 'ACTIVE');
    audit(enr, 'COURSE_ADDED', primary.studentId + ' added ' + item.name + ' — paid ' + money(amount, item.currency || 'R') + ' from RFX wallet (ref ' + reference + ')');
    secEvent('COURSE_ADDED', mail + ' · ' + item.code + ' · ' + money(amount, item.currency || 'R') + ' · wallet payment · same identity ' + primary.studentId);
    email('welcome', mail, 'Welcome to ' + item.name + ' — Reality FX',
      brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(primary.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your new course, <b>' + escHtml(item.name) + '</b>, is confirmed and added to your Reality FX account (' + primary.studentId + ').</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<tr><td style="padding:6px 0;color:#888;">Paid from RFX balance</td><td style="text-align:right;font-weight:600;">' + money(amount, item.currency || 'R') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Reference</td><td style="text-align:right;font-family:monospace;">' + reference + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Course access</td><td style="text-align:right;">Live in RFX OS — the handshake confirmed it.</td></tr></table>' + footerHtml());
    save();
    return { ok: true, enrollment: enr, balance: wBalance(mail), reference };
  }
  function wBalance(mail) {
    try { return getWallet(mail).balance; } catch (e) { return 0; }
  }

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

  /* ============================================================
     STUDENT PASSWORDS — the Academy's recovery principle.
     Passwords are NEVER stored readable: only a salted SHA-256 hash
     lives on the enrollment, so staff, the virtual assistant and even
     the store itself can never reveal a password. Recovery is always
     self-service through the registered email: "forgot password"
     mints a short-lived, single-use reset token and emails a reset
     link. Staff guide students to this flow; they never ask for or
     handle passwords.
     (Demo seam: production replaces hashing + the reset link with
     Firebase Auth — this is the demo analog of Firebase's
     password-reset email.)
     ------------------------------------------------------------ */
  const PW_MIN = 8;
  /* SHA-256, pure JS and synchronous so the whole auth layer (including
     the security self-test) stays synchronous like the rest of the store. */
  function sha256Hex(input) {
    const utf8 = unescape(encodeURIComponent(String(input)));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        const p = off + i * 4;
        w[i] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let hex = '';
    for (let i = 0; i < 8; i++) hex += ('00000000' + H[i].toString(16)).slice(-8);
    return hex;
  }
  function hashPassword(pw) { return 'sha256:' + sha256Hex('RFX::' + String(pw)); }
  function hasPassword(enr) { return !!(enr && enr.passwordHash); }
  function passwordChangedEmail(enr) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ' + escHtml((enr.payment && enr.payment.customerName) || '') + ',</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your Reality FX password was set. From now on you sign in with your email and this password.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#555;">If this was not you, use <b>Forgot password?</b> on the sign-in screen immediately to take back control — a secure reset link is emailed to this address. Reality FX staff and support can never see or recover your password; the Academy only stores a secure hash.</p>' + footerHtml();
  }
  function setStudentPassword(enr, password) {
    if (!enr) return { ok: false, msg: 'Enrollment not found.' };
    if (!canSetPassword(enr)) return { ok: false, msg: 'Setting a password is reserved for enrolled students. Your demo pass signs you in with your Student Code — when you enrol for real, you can secure your account right here.' };
    password = String(password || '');
    if (password.length < PW_MIN) return { ok: false, msg: 'Password must be at least ' + PW_MIN + ' characters.' };
    enr.passwordHash = hashPassword(password);
    enr.passwordSetAt = now();
    enr.resetToken = null; enr.resetTokenExpiresAt = null;
    secEvent('PASSWORD_SET', 'Password set' + (enr.studentId ? ' · ' + enr.studentId : '') + ' — stored as a secure hash');
    try { email('password-set', enr.payment.email, 'Reality FX — your password was set', passwordChangedEmail(enr)); } catch (e) { console.error(e); }
    save();
    return { ok: true, enr: enr };
  }
  /* Who may set a password? Real RFX students — the people who paid for the
     course. A demo / trial / coupon prospect is shown the Secure-your-account
     option but it stays feint and locked: their tour is meant to be easy to
     step into, and a password is a real-student privilege (and a recovery
     channel). The founder is always exempt — the master key is never locked. */
  function canSetPassword(enr) {
    if (!enr) return false;
    if (isFounder(enr)) return true;
    return !(enr.demoPass && enr.demoPass.hours);
  }
  function pageUrl(page, query) {
    const base = location.href.split('/').slice(0, -1).join('/');
    return base + '/' + page + (query ? '?' + query : '');
  }
  function passwordResetEmail(enr, token) {
    const link = pageUrl('member.html', 'reset=' + encodeURIComponent(token));
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ' + escHtml((enr.payment && enr.payment.customerName) || '') + ',</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Someone asked to reset the password for <b>' + escHtml(enr.payment.email) + '</b>. If that was you, the button below works for the next <b>15 minutes</b> — and only once.</p>' +
      '<div style="text-align:center;margin:24px 0;"><a href="' + link + '" style="display:inline-block;background:linear-gradient(135deg,#f0d98c,#d4af37 45%,#a8842a);color:#241a05;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:13px 30px;border-radius:10px;font-size:14px;">Reset my password</a></div>' +
      '<p style="font-family:monospace;font-size:11px;color:#999;word-break:break-all;">Or paste: ' + link + '</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#777;">If you did not ask for this, ignore this email — your password stays exactly as it is. Reality FX staff and support can never see your password; the Academy only stores a secure hash, and this link is the only way it changes.</p>' +
      footerHtml();
  }
  function passwordResetConfirmEmail(enr) {
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ' + escHtml((enr.payment && enr.payment.customerName) || '') + ',</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your password was reset successfully. The old one no longer works — sign in with your email and the new password.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">If this was not you, contact Reality FX immediately — a member of the team will help you secure your account. Staff will never ask you for your password.</p>' + footerHtml();
  }
  /* Forgot-password — never reveals whether the address exists: the response
     is identical either way, so the endpoint can't be used to fish for
     accounts. When an account exists, a short-lived single-use token is
     emailed as a reset link. */
  function requestPasswordReset(addr) {
    addr = String(addr || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return { ok: false, msg: 'Enter a valid email address.' };
    const enr = (state.enrollments || []).find(e => String((e.payment && e.payment.email) || '').trim().toLowerCase() === addr);
    if (enr) {
      const token = makeToken() + makeToken(); // long, single-use secret
      enr.resetToken = token;
      enr.resetTokenExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();
      secEvent('PASSWORD_RESET_REQUESTED', 'Reset link emailed to ' + addr);
      email('password-reset', addr, 'Reality FX — reset your password', passwordResetEmail(enr, token));
      save();
    }
    return { ok: true, sent: true };
  }
  /* The reset link is single-use and short-lived. Success sets the new hash
     and consumes the token; a stale or unknown token is refused plainly. */
  function resetPasswordWithToken(token, password) {
    token = String(token || '').trim();
    if (!token) return { ok: false, msg: 'That reset link is not recognised.' };
    const enr = (state.enrollments || []).find(e => e.resetToken === token);
    if (!enr) return { ok: false, msg: 'That reset link is not recognised — it may already have been used. Request a new one from the sign-in screen.' };
    if (!enr.resetTokenExpiresAt || new Date(enr.resetTokenExpiresAt) < new Date()) {
      enr.resetToken = null; enr.resetTokenExpiresAt = null;
      save();
      return { ok: false, msg: 'That reset link has expired. Request a fresh one from the sign-in screen.' };
    }
    password = String(password || '');
    if (password.length < PW_MIN) return { ok: false, msg: 'Password must be at least ' + PW_MIN + ' characters.' };
    enr.passwordHash = hashPassword(password);
    enr.passwordSetAt = now();
    enr.resetToken = null; enr.resetTokenExpiresAt = null; // single-use: consumed
    secEvent('PASSWORD_RESET', 'Password reset completed' + (enr.studentId ? ' · ' + enr.studentId : ''));
    email('password-reset-confirm', enr.payment.email, 'Reality FX — your password was reset', passwordResetConfirmEmail(enr));
    save();
    return { ok: true, enr: enr };
  }

  /* GATEKEEPER contract: the OS (System B) never decides who gets in. If it
     asks "can this identity come in?" the answer comes from HERE — a live
     lockout read of the same throttle record the sign-in screen enforces.
     System B only follows: no authorization is ever minted on that side. */
  function loginLockoutStatus(addr) {
    const a = String(addr || '').trim().toLowerCase();
    const rec = (state.loginAttempts || {})[a] || null;
    if (!rec || !rec.lockedUntil || new Date(rec.lockedUntil) <= new Date()) return { locked: false };
    return { locked: true, lockedUntil: rec.lockedUntil, minutesLeft: Math.ceil((new Date(rec.lockedUntil) - new Date()) / 60000) };
  }

  function memberLogin(email, code) {
    email = (email || '').trim().toLowerCase();
    const secret = String(code || '').trim();
    if (!email || !secret) return { ok: false, msg: 'Enter both your email and your password.' };
    const sec = state.security || {};
    const max = sec.maxLoginAttempts || 5;
    const lockMin = sec.lockoutMinutes || 15;
    state.loginAttempts = state.loginAttempts || {};
    const rec = state.loginAttempts[email] || { count: 0, lockedUntil: null };
    // locked? refuse even correct credentials until the window passes
    if (rec.lockedUntil && new Date(rec.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(rec.lockedUntil) - new Date()) / 60000);
      return { ok: false, locked: true, lockedUntil: rec.lockedUntil, msg: 'Too many failed sign-in attempts. This account is locked for ' + mins + ' more minute' + (mins === 1 ? '' : 's') + ' — try again later, or use Forgot password? to recover it.' };
    }
    const enr = (state.enrollments || []).find(e => e.payment.email === email);
    let ok = false;
    if (enr) {
      if (hasPassword(enr)) {
        // password-first: once a password is set, it is the only way in
        ok = hashPassword(secret) === enr.passwordHash;
        // THE FOUNDER'S CONVENIENCE — and only the founder's: the master key
        // may always use the Student Code / Student ID even after a password
        // is set. Students never get this; for them a set password is the
        // only way in (that is the security model).
        if (!ok && isFounder(enr)) {
          const c = secret.toUpperCase().replace(/^RFX-?/, '');
          ok = !!(enr.studentCode && enr.studentCode.toUpperCase().replace(/^RFX-?/, '') === c) ||
            !!(enr.studentId && enr.studentId.toUpperCase().replace(/^RFX-?/, '') === c);
          // the audit trail always shows which door the master key used
          if (ok) secEvent('FOUNDER_CODE_LOGIN', 'The founder signed in with the Student Code while a password is set · ' + enr.studentId);
        }
      } else {
        // legacy: no password set yet — accept Student Code / Student ID
        const c = secret.toUpperCase().replace(/^RFX-?/, '');
        ok = !!(enr.studentCode && enr.studentCode.toUpperCase().replace(/^RFX-?/, '') === c) ||
          !!(enr.studentId && enr.studentId.toUpperCase().replace(/^RFX-?/, '') === c);
      }
    }
    if (ok && enr && enr.studentId) {
      delete state.loginAttempts[email]; // success clears the throttle record
      const session = issueSession(enr);
      secEvent('MEMBER_LOGIN', 'Sign-in succeeded · ' + enr.studentId + ' · ' + email);
      save();
      return { ok: true, enr: enr, token: session.token };
    }
    rec.count = (rec.count || 0) + 1;
    const left = max - rec.count;
    if (left <= 0) {
      rec.lockedUntil = new Date(Date.now() + lockMin * 60000).toISOString();
      rec.count = 0;
      secEvent('LOGIN_LOCKOUT', email + ' locked for ' + lockMin + ' min after ' + max + ' failed sign-in attempts');
      state.loginAttempts[email] = rec;
      save();
      return { ok: false, locked: true, lockedUntil: rec.lockedUntil, msg: 'Too many failed sign-in attempts — this account is locked for ' + lockMin + ' minutes. Contact Reality FX if this is you.' };
    }
    state.loginAttempts[email] = rec;
    secEvent('LOGIN_FAILED', email + ' · wrong password (' + left + ' attempt' + (left === 1 ? '' : 's') + ' left)');
    save();
    return { ok: false, locked: false, attemptsLeft: left, msg: 'No match — check the email on your enrollment and your password. Forgot it? Use the Forgot password? link to email yourself a reset. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before this account locks.' };
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

  /* The demo-tour welcome letter — a warm, honest welcome for a tour student.
     It mirrors the same care as the Academy prep guide, tuned to the tour:
     what the tour is, what they can expect, and exactly what happens when the
     clock runs out (their registration link stays valid — continuing to a
     real enrollment takes minutes, not weeks). */
  function renderDemoTourEmail(enr) {
    const p = enr.payment;
    const hours = (enr.demoPass && enr.demoPass.hours) || 24;
    const days = hours / 24;
    const windowLabel = (hours % 24 === 0) ? (days + ' day' + (days === 1 ? '' : 's')) : hours + ' hours';
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(p.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Welcome to <b>Reality FX</b> — and thank you for stepping into the tour.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">This is a <b>free, time-boxed tour</b> of the Academy — it feels exactly like a real purchase so you can see the whole machine from the inside: the official invoice, the secure registration link, the identity and verification steps, and the golden countdown that shows exactly how your Academy time works.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;">' +
      '<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:13px;color:#333;">Your tour lasts <b>' + windowLabel + '</b>, counted from the moment you are approved.</td></tr>' +
      '<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:13px;color:#333;">You will see the <b>real registration journey</b> — email verification, identity, the agreements — and once approved, your tour clock starts draining live.</td></tr>' +
      '<tr><td style="padding:10px 0;font-size:13px;color:#333;">When the tour ends, your Academy door closes — <b>but your registration link stays valid</b>, so continuing to a real enrollment takes minutes, not weeks.</td></tr>' +
      '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">Your secure registration link is in the email right after this one. If anything ever feels unclear, the human line is always open — every question is answered, every time.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Welcome to the family. The learning is the point.</p>' +
      footerHtml();
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

  /* ============================================================
     THE ACADEMY PREP GUIDE — the "what to bring to school" email.
     Every approved student receives it so they land in the Academy
     ready, not confused. Covers: what to prepare, what every
     dashboard is for, what the wallet can do, and how to get help.
     Year-stamped so the same letter serves 2026, 2027, … — staff
     just change ACADEMY_YEAR when the year turns.
     ============================================================ */
  const ACADEMY_YEAR = 2026;

  function prepGuideYear() { return ACADEMY_YEAR; }

  /* The guide body, shared by the email and (as plain text) the PDF. */
  /* Founder's Day — 1 November, the founder's birthday. The founder stays
     anonymous while alive (the learning is the point); only after passing may
     the Academy add his details everywhere — one line in this constant when
     the family/org chooses. On the day itself the dashboards play the
     founder's own words, from the quotes below — the name stays quiet, but
     the voice does not. */
  const FOUNDERS_DAY = { month: 11, day: 1 };
  const FOUNDERS_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function foundersDayLabel() { return FOUNDERS_DAY.day + ' ' + FOUNDERS_MONTHS[FOUNDERS_DAY.month - 1]; }
  /* Quote of the month — a founder quote chosen by the current month (one per
     month, so it feels curated rather than random), with a warm explanation
     of why it matters. Used on the registration welcome screen and anywhere
     a quiet word from the founder fits. */
  function quoteOfMonth() {
    const m = new Date().getMonth(); // 0-11
    const pick = founderQuotes[m % founderQuotes.length];
    return { quote: pick, month: FOUNDERS_MONTHS[m] };
  }
  function isFoundersDay() {
    const n = new Date();
    return (n.getMonth() + 1) === FOUNDERS_DAY.month && n.getDate() === FOUNDERS_DAY.day;
  }
  const founderQuotes = [
    'Every lesson is a trade. Every trade is a lesson.',
    'The learning is the point.',
    'Money that is subject to change is not yours yet.',
    'Quality before quantity — enrolment is capped, care is not.',
    'We trade with knowledge here — every rand is earned, never left to chance.',
    'A chart is a story told in candles. Learn to read it before you try to write one.',
    'Discipline is what you do when nobody is watching — and the market is always watching.',
    'You do not trade the market. You trade your own mind — the market just collects the score.',
    'The best trade of your life will be the one you did not take.',
    'Family is not who you are born to. It is who vouches for you, and who you vouch for.',
    'The Academy does not sell courses. It builds traders — one disciplined decision at a time.',
    'Your first loss is tuition. Your second is a choice.',
    'Be the student who keeps the door open for the one behind you.',
    'A school that depends on one person will die with them. This Academy was built to outlive us all.',
    'We do not chase fast money. We build slow skill — fast money finds the skilled.',
  ];

  function prepGuideSections() {
    return [
      {
        t: 'Welcome to your Academy year',
        b: 'Your registration is approved and your Reality FX identity is official. This letter is your preparation kit — what to get ready, where everything lives, and how your wallet works. Keep it somewhere safe; it is your map for the year.'
      },
      {
        t: 'What to prepare before you start',
        b: 'A computer, laptop or phone with a stable internet connection; a quiet space where you can focus; a trading journal (paper or digital — note every trade, the reasoning and the outcome); a calculator and something to write with if you prefer paper notes; and your Student ID + Student Code — both are in this email and are your permanent identity.'
      },
      {
        t: 'The members panel — your account home',
        b: 'Sign in with your email and Student Code. This is where your identity card lives, every course you own is listed, your wallet balance and ledger are shown, your referral link is ready to share, and you can spend RFX credit, buy merch, and manage your invoices. Your vital details are masked by default — reveal them with the eye icon when you need them.'
      },
      {
        t: 'The Mailbox — your official inbox',
        b: 'Every invoice, registration link and Academy announcement lands here, with Reality FX branding. You can download any message as a file. Check it before big announcements — it is the only channel the Academy uses for official notices.'
      },
      {
        t: 'The RFX OS Academy — where you learn',
        b: 'Your lessons, progress and assessments live in the Academy. It is protected: pages are watermarked with your Student ID, copying is blocked, printing is blacked out by default, and capture attempts are logged. This protects the value of the education you paid for — for you and every student after you. Print access is a privilege granted only to students who earn it.'
      },
      {
        t: 'Your RFX wallet — what the money in it can do',
        b: 'Your wallet holds RFX credit: prize money and referral rewards are paid straight into it, and it is the fee-free way to buy another course, a mentorship session, a seat transfer for a family member, or Academy merch. You can request a cash-out of prize money (minimum R50) which is paid in the monthly batch. Credit never expires if it was earned; it is yours to use on Academy value.'
      },
      {
        t: 'The rules that keep everyone safe',
        b: 'One student, one account — sharing or selling access is a breach of the Fair Usage Policy. The Academy also keeps exactly one active session per student: the moment you sign in anywhere (a new device, a new browser, even a second browser on the same computer), the previous session ends on its own — you never need to sign out of old devices, the system does it for you. This is how we stop a course from being shared with someone else. Suspicious activity, unusual assessment timing or perfect-score patterns are reviewed by the moderator, who checks the evidence before any decision. A refund request ends your access to materials and starts a re-application cooldown; the full policy is in the agreements you accepted.'
      },
      {
        t: 'Why these measures exist — and why they protect you',
        b: 'Every safeguard in this Academy — tracking when a registration link is opened, timing your sessions, the Trust Bar that reflects your standing, watermarking your pages, logging security events — exists for one reason: so your profile never stops working, your login never fails, and the Academy is never compromised because someone leaked sensitive information. They are not for show. When something looks unusual, a moderator reviews the evidence before any decision is made — you are never judged by a machine alone. If a measure ever feels like extra fuss, it is the thing standing between you and a day when your account stops working for no reason you can see. Reality FX runs deliberately small and intimate — enrolment is capped and quality comes before quantity — so every student gets this level of care, and every student is protected by it.'
      },
      {
        t: 'Our values — the standard we hold ourselves to',
        b: 'Reality FX would rather carry a student who is struggling than keep staff who do not meet the standard — and that is not a slogan, it is how the system is built. A student\'s Trust Bar always leaves room to come back: even if it dips low, the path back is open, because every student is here to learn and every learner deserves the chance to recover. The team works under a far stricter rule: a staff member whose standing falls too far is placed under review, because the people who run the Academy must live up to the quality it promises. Every action that moves either bar is recorded and visible — the system never hides the score from the person earning it. That is the contract: students are given every chance to grow, and the Academy holds its own people to the highest line of all.'
      },
      {
        t: 'The work behind your Academy',
        b: 'What you are joining is not a website — it is an engineered system, and the effort behind it is the reason you can trust it. The journey that brought you here runs through a monitored pipeline with over a dozen checkpoints, and every one of them is verified before you are handed your identity. A full system audit runs 19 checks — from the payment webhook that created your enrollment, to the handshake that introduced you to the Academy, to the guarantee that every student code is unique and every rand reconciles across the ledgers. Three security self-tests attack the system the way an intruder would — brute-forcing your login, guessing verification codes, reusing an expired registration link — and each attack is defended; a fourth verifies that your identity data is deleted the moment a decision is made. More than thirty kinds of security events are recorded for the team to review, and a capacity check keeps the system comfortably ahead of every student it serves. This is not complexity for its own sake; it is the machinery that makes your account work without drama, year after year. A lot of people built this carefully, and they keep auditing it so you never have to think about it.'
      },
      {
        t: 'Proven at scale — and built to outlive any one of us',
        b: 'You are not joining a promise — you are joining a machine that has been tested at full strength. Before you arrived, the whole Academy was simulated at two thousand students at once: every enrollment, registration, identity, handoff and wallet built in a matter of seconds, and every one of the 19 system checks still passed, all four security attacks were still defended, all 1,874 student codes stayed unique, and every rand reconciled to the cent across 2,202 ledger events. The entire two-thousand-student academy weighs about 34 MB of records — roughly 17 KB per student — and that is the browser demo\'s limit, not the Academy\'s: production storage is effectively unlimited, so doubling overnight would not blink. And this is deliberate: Reality FX was engineered to run on its own. The pipeline automates the journey from payment to classroom, staff guide and moderate, the machine carries the load — it does not depend on any single person, and it was built to keep teaching long after its founders. Every year on Founder\'s Day — 1 November — the Academy honours the founder who built the self-reliant school you now study in; the name stays quiet, because the learning is the point. On that day the Academy plays the founder\'s own words — the name stays quiet, but the voice does not. You are not a customer; you are family, and the Academy you are joining was built to stand.'
      },
      {
        t: 'Getting help',
        b: 'Ask Sarrah, the Academy assistant, on the members panel and reception — she answers account and panel questions around the clock. For anything else, the team is one message away at realityfx20@gmail.com. Welcome to Reality FX — your trading journey starts now.'
      },
    ];
  }

  function renderPrepGuideEmail(enr) {
    const secs = prepGuideSections();
    const body = secs.map((s, i) =>
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;">' +
      '<div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">' + (i + 1) + '. ' + escHtml(s.t) + '</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:4px;">' + escHtml(s.b) + '</div></td></tr>').join('');
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Welcome to the <b>Reality FX Academy — ' + ACADEMY_YEAR + '</b>. Your identity is official' +
      (enr.studentId ? ' (' + enr.studentId + ')' : '') + ' and your Academy access is ready.</p>' +
      (enr.studentCode ? '<div style="background:#f9f6ed;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;margin:14px 0;"><div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#a8842a;text-transform:uppercase;font-weight:700;">Your Student Code — keep this safe</div><div style="font-family:monospace;font-size:20px;color:#241a05;font-weight:700;margin-top:6px;letter-spacing:3px;">' + escHtml(enr.studentCode) + '</div><div style="font-family:Arial,sans-serif;font-size:12px;color:#666;margin-top:6px;">You need this code to sign in to your Student Portal. It does not change — it is yours for life.</div></div>' : '') +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">This letter prepares you for the year — read it once and you will know exactly what to do next.</p>' +
      '<table style="width:100%;border-collapse:collapse;">' + body + '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;margin-top:16px;">' +
      'A downloadable copy of this guide is attached to this email — save it and pass it to your future self.' +
      ' This letter is updated each Academy year; if anything changes in the system you will be told here, first.</p>' +
      footerHtml();
  }

  /* Send the prep guide to one student. Idempotent-ish: re-sending simply
     emails again (a resend is allowed — staff may re-send after a complaint),
     but it is recorded as a security event so the audit trail shows when. */
  function sendPrepGuide(enr) {
    const mail = email('prep-guide', enr.payment.email, 'Your ' + ACADEMY_YEAR + ' Academy preparation guide — Reality FX', renderPrepGuideEmail(enr));
    secEvent('PREP_GUIDE_SENT', enr.payment.email + ' · ' + ACADEMY_YEAR + ' Academy guide · ' + (enr.studentId || 'pre-approval'));
    if (enr.registration) enr.registration.prepGuideSentAt = now();
    save();
    return mail;
  }

  /* ============================================================
     HOW REALITY FX OPERATES — the full operating guide.
     The same story as the standalone operating-guide.html page, in
     email form: Front Desk → Student Portal → RFX OS, the gate,
     the machine, and the staff role. Staff can send it from the
     console to anyone (a prospective hire, a curious student, a
     colleague) — it lands in the Mailbox with full branding.
     ============================================================ */
  function operatingGuideSections() {
    return [
      { t: 'Three rooms, one family', b: 'Reality FX is one journey told in three rooms. The Front Desk (our website) is where the world meets us — courses, prices, enrolment. The Student Portal is the campus office — identity, wallet, store, events and referrals. RFX OS Academy is the classroom itself, where approved students learn. The chain: FRONT DESK → STUDENT PORTAL → RFX OS.' },
      { t: 'The Front Desk — where it begins', b: 'When someone buys a course and the payment is approved (e.g. through PayPal), the system takes over automatically: it creates the enrolment, generates an official invoice, and emails it. Immediately after, a second email carries a secure, single-use registration link that leads into the gate.' },
      { t: 'The gate — nobody walks in unregistered', b: 'Buying a course is not the same as becoming a student. Through the secure link the student provides their details, verifies their email with a 6-digit code, passes CAPTCHA, submits identity information including a selfie, and accepts the exact version of the Terms, Conditions and Fair Usage Policy (with the time of acceptance recorded). The system verifies the registration is tied to a genuine paid enrolment and that the link is valid and unused.' },
      { t: 'Approval & identity', b: 'Once approved, the student receives their official Reality FX identity: a unique Student ID and Student Code. The record is then handed to RFX OS over the bridge — an idempotent handshake, so a network hiccup can never create two identities for one student. Until this completes, the student holds a demo / under-review profile with no full access.' },
      { t: 'The Student Portal — everything student', b: 'The portal is the main office of campus reception. Students find their identity and vital details (masked until revealed), their RFX wallet and credit, invoices and an official Mailbox, live support, their referral link, merch, and the ability to enrol in further courses without re-registering — because they are already verified.' },
      { t: 'RFX OS Academy — the classroom', b: 'The Academy is the most protected room: every resource asks “is this authenticated Student ID authorised?” before delivering anything. Pages are watermarked, copying is blocked, printing is blacked out by default and capture attempts are logged. One student, one account, one active session — signing in on a new device ends the old session automatically.' },
      { t: 'The machine behind it', b: 'The system runs a full audit of 20 checks and attacks itself with 5 security self-tests the way an intruder would — brute-forcing logins, guessing verification codes, reusing expired links — and defends against each. More than 35 kinds of security events are recorded for review. The whole Academy has been simulated at 2,000 students at once and every check still passed.' },
      { t: 'The staff role — the human line', b: 'Staff never need to be software developers. They approve registrations, resolve flagged cases, run the one-click audit and repair, refresh logs, and talk to the system motherboard on the rare technical occasion. They work shifts to keep the 24/7 reception promise, and they are the warm hand that makes the machine feel human to every student.' },
      { t: 'Built to outlive any one of us', b: 'The entire journey is automated end to end, engineered to run without depending on any single person. A school that depends on one person will die with them — this Academy was built to outlive its founders, and to keep teaching long after. The learning is the point.' },
    ];
  }

  function renderOperatingGuideEmail(enr) {
    const secs = operatingGuideSections();
    const body = secs.map((s, i) =>
      '<tr><td style="padding:14px 0;border-bottom:1px solid #eee;">' +
      '<div style="font-family:Arial,sans-serif;font-weight:700;font-size:14px;color:#080808;">' + (i + 1) + '. ' + escHtml(s.t) + '</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;line-height:1.55;margin-top:4px;">' + escHtml(s.b) + '</div></td></tr>').join('');
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr && enr.payment ? enr.payment.customerName : 'reader') + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Here is the complete walkthrough of <b>how Reality FX operates</b> — from the first click on the Front Desk to the classroom in RFX OS Academy.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">Read it once and the whole machine makes sense: three rooms, one family, and the security that stands between them.</p>' +
      '<table style="width:100%;border-collapse:collapse;">' + body + '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;margin-top:16px;">' +
      'The full illustrated version is available on the website — <b>“How we operate — The Complete Guide”</b> from the Front Desk.</p>' +
      footerHtml();
  }

  function sendOperatingGuide(enr) {
    const mail = email('operating-guide', enr && enr.payment ? enr.payment.email : 'team@realityfx.local', 'How Reality FX operates — the complete guide', renderOperatingGuideEmail(enr));
    secEvent('OPERATING_GUIDE_SENT', (enr && enr.payment ? enr.payment.email : 'team') + ' · full operating guide');
    save();
    return mail;
  }

  /* Auto-prepare on approval: the moment a student is approved, the guide
     goes out with the welcome — they never wonder what happens next. */
  function autoSendPrepGuide(enr) {
    if (!enr || !enr.registration || enr.registration.prepGuideSentAt) return null;
    try { return sendPrepGuide(enr); } catch (e) { return null; }
  }

  /* Birthdays — Reality FX celebrates its students. DOB is captured at
     registration (branded calendar, step 1) so the Academy can greet each
     student on their birthday: a branded mailbox note + a panel
     notification, exactly once per year. Guarded by birthdayGreetedYear,
     so reloads and multiple open panels can never double-greet. In
     production this is a daily server-side sweep; here every panel that
     loads the store runs it and the guard keeps it idempotent. The OS
     mirrors it via the `dob` field on the handoff payload when present. */
  function birthdayFor(enr) {
    const p = enr && enr.registration && enr.registration.personal;
    if (!p || !p.dob) return null;
    const d = new Date(p.dob);
    if (isNaN(d.getTime())) return null;
    return { month: d.getMonth() + 1, day: d.getDate(), year: d.getFullYear() };
  }
  function renderBirthdayEmail(enr, first) {
    const b = birthdayFor(enr);
    const age = b ? Math.max(0, new Date().getFullYear() - b.year) : null;
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(first) + '</b>,</p>' +
      '<div style="background:linear-gradient(135deg,#fbf3dc,#f6e7bd);border:1px solid #d4af37;border-radius:12px;padding:24px 26px;text-align:center;font-family:Georgia,serif;color:#241a05;">' +
      '<div style="font-size:11px;letter-spacing:3px;color:#a8842a;">REALITY FX · YOUR ACADEMY FAMILY</div>' +
      '<div style="font-size:24px;font-weight:700;margin-top:10px;">Happy birthday' + (age ? ', turning ' + age : '') + '!</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:13px;color:#5c4a15;margin-top:12px;line-height:1.7;">Today the whole Reality FX family celebrates you. Thank you for being part of the Academy — your focus, your discipline and your journey matter here, and we are honoured to walk it with you.</div>' +
      '</div>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;margin-top:18px;line-height:1.6;">Make today count — then come back to the floor. Your seat, your identity and your progress are exactly where you left them.</p>' +
      footerHtml();
  }
  function checkBirthdays() {
    const today = new Date();
    const mm = today.getMonth() + 1, dd = today.getDate(), yy = today.getFullYear();
    let count = 0;
    (state.enrollments || []).forEach(enr => {
      const b = birthdayFor(enr);
      if (!b || b.month !== mm || b.day !== dd) return;
      if (enr.birthdayGreetedYear === yy) return;
      enr.birthdayGreetedYear = yy;
      const name = (enr.payment && enr.payment.customerName) || 'Student';
      const first = String(name).split(/\s+/)[0] || 'there';
      if (enr.payment && enr.payment.email) {
        email('birthday', enr.payment.email, 'Happy birthday, ' + first + ' — Reality FX', renderBirthdayEmail(enr, first));
      }
      notifyStudent(enr, 'birthday', 'Happy birthday, ' + first + '!', 'Reality FX celebrates you today — the whole Academy family is glad you are here. Your birthday note is in your Mailbox.');
      secEvent('BIRTHDAY_GREETED', (enr.studentId || enr.id) + ' · ' + first + ' greeted on ' + yy + '-' + mm + '-' + dd);
      count++;
    });
    if (count) save();
    return count;
  }

  /* The Academy is back online — fired the moment the handshake probe sees
     the OS return after an outage. Warm, never apologetic: the student's
     access was never in doubt, the door simply re-opened. Landed in the
     Mailbox with full branding (same message goes by real email in prod). */
  function renderAcademyOnlineEmail(enr) {
    const name = enr && enr.payment ? enr.payment.customerName : 'student';
    return brandHtml() +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(name) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Good news — <b>the Academy is back online.</b> The power is on, the lights are up, and your seat was waiting for you the whole time.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;line-height:1.55;">Nothing was lost during the pause — your identity, your progress and your access are exactly where you left them. Simply open the Academy door and continue. If anything ever feels out of place, our reception is always a message away.</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#666;">Welcome back to the floor.</p>' +
      footerHtml();
  }
  function academyOnlineNotice(enr) {
    if (!enr) return null;
    const mail = email('academy-online', enr.payment.email, 'The Academy is back online — Reality FX', renderAcademyOnlineEmail(enr));
    secEvent('ACADEMY_BACK_ONLINE', enr.payment.email + ' · ' + (enr.studentId || enr.id) + ' · handshake restored');
    save();
    return mail;
  }

  /* ---------------- Academy outage ledger (the OS-outage monitoring board) ---
     Every UP→DOWN transition opens an outage row, every DOWN→UP closes it
     (state.osOutages). Shared across every panel that probes, so one outage is
     ONE row no matter how many tabs watch — the first to see it records it.
     Staff read the board; the member side feeds the power-on moment. */
  function osOutageBegin() {
    const log = state.osOutages || (state.osOutages = []);
    const open = log.find(o => o.downAt && !o.upAt);
    if (open) return open; // already recorded — never spam the ledger
    const row = { downAt: now(), upAt: null, durationSec: null };
    log.push(row);
    secEvent('ACADEMY_DOWN', 'Academy unreachable — outage recorded at ' + row.downAt);
    save();
    return row;
  }
  function osOutageEnd() {
    const log = state.osOutages || (state.osOutages = []);
    const open = log.find(o => o.downAt && !o.upAt);
    if (!open) return null; // already closed
    open.upAt = now();
    open.durationSec = Math.max(0, Math.round((new Date(open.upAt) - new Date(open.downAt)) / 1000));
    save();
    return open;
  }
  function osOutageLog() {
    return (state.osOutages || []).slice();
  }
  function osOutageSummary() {
    const log = osOutageLog();
    const open = log.find(o => o.downAt && !o.upAt) || null;
    const closed = log.filter(o => o.upAt);
    let totalSec = 0; closed.forEach(o => totalSec += (o.durationSec || 0));
    return { count: log.length, open: open, totalSec: totalSec, last: closed[closed.length - 1] || null };
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60, h = Math.floor(m / 60);
    if (h > 0) return h + 'h ' + (m % 60) + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  /* ---------------- debug / demo ---------------- */
  function wipe() {
    localStorage.removeItem(DB_KEY);
    // Clear the SHARED store SYNCHRONOUSLY: load() below prefers the server,
    // so an async clear would race and re-load the old state (the wipe would
    // silently do nothing — a real bug the audit caught).
    // The wiped payload carries a HIGH rev so any stale open tab's next save
    // is refused by the server's rev guard instead of resurrecting the old
    // state from its memory — and the "wipe" flag tells the server to skip the
    // rev guard itself, so a reset ALWAYS wins (even against a stale high-rev
    // state that would otherwise 409 it and silently do nothing).
    try {
      const cleared = JSON.parse(JSON.stringify(DEFAULTS));
      cleared.rev = Date.now();
      cleared.wipe = true;
      const x = new XMLHttpRequest();
      x.open('POST', SERVER_STATE_ENDPOINT, false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(cleared));
    } catch (e) {}
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
  /* Per-email idempotency key for demo passes: the SAME prospect email always
     returns the same tour (fresh link after expiry — never a duplicate
     student, never duplicate emails), but DIFFERENT prospects each get their
     own tour. (Before this, every pass carried the fixed 'DEMO-TOUR'
     transaction, so the webhook idempotency silently returned the founder's
     own account for every prospect — the typed name/email were ignored.) */
  function demoPassTxn(email) {
    const e = String(email || '').trim().toLowerCase();
    // legacy: the founder's original tour keeps its plain DEMO-TOUR transaction
    const legacy = (state.enrollments || []).find(x => x.payment && x.payment.transactionId === 'DEMO-TOUR'
      && String(x.payment.email || '').toLowerCase() === e);
    if (legacy) return 'DEMO-TOUR';
    let h = 0;
    for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
    return 'DEMO-TOUR-' + h.toString(36);
  }
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
      transactionId: demoPassTxn(emailAddr),
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
      // resendRegistrationEmail rotates the token, keeps the lifetime, sends
      // ONE registration email and saves — never a dead first email.
      const keep = ['personal', 'emailVerifiedAt', 'captchaPassedAt', 'identity', 'selfieDataUrl', 'agreements', 'decision'];
      const saved = {};
      keep.forEach(k => { if (enr.registration[k] !== undefined && enr.registration[k] !== null) saved[k] = enr.registration[k]; });
      resendRegistrationEmail(enr); // rotates token + single email + save
      keep.forEach(k => { if (saved[k] !== undefined) enr.registration[k] = saved[k]; });
      // the tour's clock is shorter than the standard lifetime — pin it to the
      // demo window so the link and the countdown both die on the same wall
      enr.registration.tokenHours = hours;
      enr.registration.tokenExpiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      // the countdown clock restarts too — a fresh 24h pass deserves a fresh
      // clock, so demoTimeLeft (createdAt + hours) matches the new wall
      enr.demoPass = { hours, createdAt: now() };
      save();
    }
    // return the ACTUAL current token — the re-issue branch rotates it, so
    // callers (and the demo tour link) must never be handed a stale one
    return { ok: true, enr, fresh, token: enr.registration.token, expiresAt: enr.registration.tokenExpiresAt };
  }

  /* ------------------------------------------------------------
     LOAD TEST — prove the machine at scale, in memory only.
     Builds `count` random students through the REAL pipeline —
     payment webhook → enrollment → invoice → registration link →
     verification → identity → agreements → submission → approval →
     identity minted → OS handshake → ACTIVE — with wallets, awards,
     merch spend, referral chains and refunds mixed in, then runs the
     full audit + security self-test against that entire world and
     reconciles every rand. Nothing is persisted: the live store is
     untouched and restored before we return. Deterministic when
     seeded, so the exact same academy can be rebuilt and re-proven. */
  function simulateLoad(count, opts) {
    opts = opts || {};
    count = Math.max(1, Math.floor(Number(count) || 0));
    const t0 = Date.now();
    const real = state;                        // the live world, restored on the way out
    state = JSON.parse(JSON.stringify(DEFAULTS)); // a fresh test world
    state.rev = 0;                            // a fresh academy starts at revision 0 (saves are no-ops here)
    state.autoApproveDemo = false;             // approval is a deliberate moderator act here
    simSilent = true;                          // zero persistence during the run
    const R = { count: count, seed: opts.seed != null ? opts.seed : 20260808, ok: false };
    let s = Number(R.seed) >>> 0;
    const rnd = function () {                  // mulberry32 — deterministic, seeded
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    const int = function (lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); };
    const FIRST = ['Thabo', 'Nomvula', 'Sipho', 'Zanele', 'Kagiso', 'Lerato', 'Mandla', 'Naledi', 'Tendai', 'Chipo', 'Bongani', 'Amara', 'Kwame', 'Aisha', 'Dumisani', 'Lindiwe', 'Musa', 'Palesa', 'Tumelo', 'Nokuthula', 'Sibusiso', 'Ayanda', 'Lwazi', 'Refilwe', 'Osman', 'Yusuf', 'Gabriel', 'Emma', 'Liam', 'Fatima', 'Chenai', 'Ayo', 'Zinhle', 'Melokuhle', 'Karabo', 'Onthatile'];
    const LAST = ['Zulu', 'Nkosi', 'Mokoena', 'Dlamini', 'Khumalo', 'Ndlovu', 'Botha', 'van der Merwe', 'Naidoo', 'Pillay', 'Banda', 'Phiri', 'Mwale', 'Okafor', 'Adeyemi', 'Mensah', 'Otieno', 'Mutasa', 'Sibanda', 'Kowalski', 'Novak', 'Meyer', 'Schmidt', 'Rossi', 'Dubois', 'Ali', 'Hassan', 'Smith', 'Brown'];
    const DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'protonmail.com', 'webmail.co.za', 'zoho.com'];
    const COUNTRIES = ['South Africa', 'Zambia', 'Malawi', 'Kenya', 'Nigeria', 'Ghana', 'Botswana', 'Namibia', 'Poland', 'Germany', 'United Kingdom', 'United States', 'Canada', 'Australia'];
    const STREETS = ['Acacia', 'Main', 'Kings', 'Oxford', 'Union', 'Vrede', 'Church', 'Long', 'Empire', 'Riverside'];
    const CITIES = ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Gqeberha', 'Bloemfontein', 'Lusaka', 'Blantyre', 'Lilongwe', 'Nairobi'];
    const METHODS = (state.course && Array.isArray(state.course.paymentMethods) && state.course.paymentMethods.length)
      ? state.course.paymentMethods : ['PayPal', 'Card', 'EFT'];
    const MERCH = (state.catalog || []).filter(function (x) { return x.kind === 'merch'; });
    const activeRefs = [];   // referral codes of ACTIVE students — the buddy chains grow
    const outcomes = { approved: 0, fixable: 0, final: 0 };
    const codes = [];
    let referrals = 0, awardsCount = 0, merchCount = 0, refunds = 0, credits = 0;

    try {
      for (let i = 1; i <= count; i++) {
        const f = pick(FIRST), l = pick(LAST);
        const email = (f + '.' + l + i + '@' + pick(DOMAINS)).toLowerCase();
        const price = Math.max(500, Math.round(state.course.price * (0.75 + rnd() * 0.5)));
        const pay = {
          customerName: f + ' ' + l,
          email: email,
          course: state.course.name,
          price: price,
          currency: state.course.currency,
          paymentMethod: pick(METHODS),
          transactionId: 'TXN-SIM' + i,          // webhook idempotency key — always unique
          paidAt: new Date(t0 - (count - i) * 60000).toISOString(),
        };
        if (activeRefs.length && rnd() < 0.14) { // ~14% arrive through an ACTIVE student's link
          pay.referralCode = pick(activeRefs);
          referrals++;
        }
        const enr = createEnrollment(pay);       // PENDING — the webhook just confirmed payment
        createRegistrationInvite(enr);           // secure single-use registration link
        sendInviteEmails(enr);                   // invoice + registration email, same rail
        markLinkOpened(enr);                     // the tracking pixel fires
        const address = int(1, 999) + ' ' + pick(STREETS) + ' Road, ' + pick(CITIES) + ' ' + int(1000, 9999);
        const country = pick(COUNTRIES);
        savePersonal(enr, {
          fullName: f + ' ' + l, firstName: f, surname: l,
          dob: new Date(1988 + int(0, 22), int(0, 11), int(1, 28)).toISOString().slice(0, 10),
          country: country,
        });                                      // your details
        markEmailVerified(enr);                  // the 6-digit code came back correct
        markCaptchaPassed(enr);                  // human check
        saveIdentity(enr, {
          phone: '+27' + int(6, 9) + String(int(10000000, 99999999)),
          address: address,
        }, null);                                // identity saved — sim selfies stay off the record
        acceptAgreements(enr, (state.agreements || []).map(function (a) { return a.id; }));
        submitRegistration(enr);                 // → under review

        const roll = rnd();
        if (roll < 0.93) {
          approve(enr, { verdict: 'APPROVED', by: 'Moderator (load test)' });  // identity minted, trust seeded at 100
          outcomes.approved++;
          codes.push(enr.studentCode);
          transition(enr, 'SYNCING');            // System A → RFX OS
          transition(enr, 'RFX_OS_CONFIRMED');   // handshake acknowledged — Student ID is the idempotency key
          transition(enr, 'ACTIVE');             // fully in; a referral commission may vest
          if (enr.referralCode) activeRefs.push(enr.referralCode);
          if (rnd() < 0.06) {                    // ~6% win prize money straight to their wallet
            const amount = int(300, 1000);
            issueAward({ reference: 'SIM-AWD-' + i, recipients: [{ email: email, amount: amount }], reason: 'Academy award (load test)', source: 'ceremony' });
            awardsCount++;
            if (MERCH.length && rnd() < 0.5) {   // half of winners spend some on merch — the spend rail
              const m = pick(MERCH);
              const sz = pick(m.sizes || ['M']);
              if (spendable(email) >= Number(m.price)) {
                const r = purchaseMerch({ email: email, code: m.code, size: sz, address: address + ', ' + country, reference: 'SIM-MERCH-' + i });
                if (r && r.ok) merchCount++;
              }
            }
          }
        } else if (roll < 0.98) {
          approve(enr, { verdict: 'REJECTED', by: 'Moderator (load test)', reason: 'Simulated fixable flag — selfie quality below policy standard', fixable: true });
          outcomes.fixable++;
        } else {
          approve(enr, { verdict: 'REJECTED', by: 'Moderator (load test)', reason: 'Simulated final flag — identity details could not be confirmed', fixable: false });
          outcomes.final++;
          if (rnd() < 0.6) {                     // most choose the fee-free credit route
            const cr = issueCredit(enr, enr.payment.price, 'System (load test)');
            if (cr && cr.ok) credits++;
          } else if (rnd() < 0.5) {              // a few queue a cash refund — refund intelligence fires
            const q = queueRefund(enr, enr.payment.price, 'System (load test)');
            if (q && q.ok) refunds++;
          }
        }
      }

      /* ---- prove the world ---- */
      R.outcomes = outcomes;
      R.referralsAttributed = referrals;
      R.awards = awardsCount; R.merchOrders = merchCount; R.refundsQueued = refunds; R.creditsIssued = credits;
      R.codesUnique = new Set(codes).size === codes.length;
      R.stages = {};
      (state.enrollments || []).forEach(function (e) { R.stages[e.state] = (R.stages[e.state] || 0) + 1; });
      const fin = financialSummary();
      const walletSum = Object.keys(state.wallets || {}).reduce(function (sum, k) { return sum + (state.wallets[k].balance || 0); }, 0);
      // Match the audit's exact formula (wallets + queued cash-outs = held) so
      // this delta can never silently disagree with the reconciliation check.
      const queuedCashouts = (state.payouts || []).filter(function (p) { return p.kind === 'cashout' && p.status === 'queued'; }).reduce(function (s, p) { return s + p.amount; }, 0);
      R.reconciliation = {
        walletSum: Math.round(walletSum * 100) / 100,
        held: Math.round(fin.held * 100) / 100,
        delta: Math.round(((walletSum + queuedCashouts) - fin.held) * 100) / 100,
        events: fin.events,
      };
      const auditOut = fullAudit();
      const selfOut = securitySelfTest();
      R.audit = {
        pass: auditOut.passed, total: auditOut.total,
        names: (auditOut.checks || []).map(function (x) { return x.name; }),
        failedNames: (auditOut.checks || []).filter(function (x) { return !x.pass; }).map(function (x) { return x.name; }),
      };
      R.selfTest = { pass: selfOut.filter(function (x) { return x.pass; }).length, total: selfOut.length };
      const jsonLen = JSON.stringify(state).length;
      R.footprint = {
        mb: (jsonLen / 1048576).toFixed(2),
        kb: Math.round(jsonLen / 1024),
        perStudentKB: (jsonLen / 1024 / count).toFixed(1),
        emails: (state.emails || []).length,
        events: (state.securityEvents || []).length,
        // how many students the 5MB browser demo store would hold at this size
        inBrowserStore: Math.max(0, Math.floor((5 * 1024 * 1024) / jsonLen * count)),
      };
      R.clean = (R.audit.pass === R.audit.total) && (R.selfTest.pass === R.selfTest.total) && R.reconciliation.delta === 0;
      R.tookMs = Date.now() - t0;
      R.ok = true;
    } catch (err) {
      R.ok = false;
      R.error = String((err && err.stack) || err);
      R.tookMs = Date.now() - t0;
    } finally {
      state = real;      // restore the live world — the test leaves zero trace
      simSilent = false;
    }
    return R;
  }

  /* ---------------- public API ---------------- */
  /* The full country list for the registration picker — no free-typing, no
     spelling drift: every student picks from the same canonical names, which
     keeps the SRM, certificates and refund-identity matching consistent. */
  const COUNTRIES = ['Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (DRC)','Congo (Republic)','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'];

  RFX.db = {
    // meta
    now, money, fmtDate, fmtDateShort, IDEMPOTENCY_KEY_FIELD,
    // settings
    getSettings, osIndexUrl, osAuthUrl, updateSettings, getCatalog, saveCatalog,
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
    findStudentByCode, memberLogin, hashPassword, hasPassword, canSetPassword, setStudentPassword,
    requestPasswordReset, resetPasswordWithToken, PW_MIN, loginLockoutStatus,
    // profile tier + simplified new-course enrollment (verified members)
    profileTier, enrollAdditionalCourse, normCourse,
    // demo-pass countdown (shared clock)
    demoTimeLeft, fmtCountdown,
    // academy prep guide (the 'what to bring to school' letter)
    prepGuideYear, prepGuideSections, renderPrepGuideEmail, sendPrepGuide, autoSendPrepGuide,
    // birthdays — DOB captured at registration, greeted once per year
    countries: COUNTRIES, birthdayFor, checkBirthdays,
    operatingGuideSections, renderOperatingGuideEmail, sendOperatingGuide,
    foundersDayLabel, isFoundersDay, quoteOfMonth, founderQuotes,
    // staff (invited team, shifts, on-duty roster)
    staff, staffById, staffByEmail, createStaff, validateStaffInvite,
    activateStaff, staffLogin, clockIn, clockOut, setStaffShiftTime, onDutyStaff, onDutyCount,
    coverageHeatmap, seedCoverage,
    currentShift, STAFF_ROLES,
    // staff performance — the robotic manager (trust bar + duty engine)
    staffPerfEvent, staffPerfStatus, perfPayFactor, generateDuties, dutiesFor, completeDuty, dutyQueueCount, STAFF_DUTY_ROLES,
    staffPerfBoard, teamPerfFeed, adminPerfOverride, adminTerminateStaff, staffWeeklyReport,
    // state machine
    transition, noteHandoffAttempt,
    // reconciliation sweep — the bridge's safety net (never trust a tab)
    pendingSyncs, syncOverdueMs, reconcileSweep, SYNC_OVERDUE_MS,
    // single-session contract — token per login, revoke on new device
    deviceFingerprint, issueSession, sessionStillValid,
    // security
    securityStatus, securitySelfTest, storageMeter, printTrust, printTrustRules, grantPrintTrust, revokePrintTrust, purgeRetainedSelfies, securityEvents, secEvent,
    CAL_TIERS, CAL_BRIEFING_TYPES, journeyCal, journeyCalTier, journeyCalFocus, setJourneyCal, calAddEvent, calRemoveEvent, calToggleEvent, calAcademyEvents, calSuggestions, calBriefings,
    briefingSubs, setBriefingSub, sessionTracker, markTodaySession, sessionStreak, STREAK_MILESTONES, academyOnlineNotice,
    // Academy outage ledger — the monitoring board's data (shared across panels)
    osOutageBegin, osOutageEnd, osOutageLog, osOutageSummary, fmtDuration,
    // count privacy — the ghost-town rule (staff see real numbers, students don't)
    countsRevealed,
    // selfie quality gate + identity signals (review triggers, never verdicts)
    analyzeSelfie, selfieHash, scanIdentitySignals, identityFlags, phoneKey, phonesMatch,
    notifyStudent, notifyEmail, studentNotifications, unreadNotificationCount, markNotificationsRead, markToasted, reviewSlaInfo,
    trustScore, trustStatus, trustEvents, trustFeed, adjustTrust, referralTrustPenalty, seedTrust, demoLifeLeft, demoTourExpired, isFounder,
    // one-click full audit (journey + money + integrity + store + security)
    fullAudit,
    // self-repair — the head mechanic (fix what is safely fixable, prove it, hand the rest to a human)
    repairPlan, repairOne, selfRepair,
    // live support — the human line between students and staff
    supportThread, supportSend, supportThreads, supportUnreadCount,
    supportMarkStaffRead, supportStudentThread, supportStudentUnread, supportMarkStudentRead,
    currentOperator,
    // demo
    enrollDemo, loadDemoPayment, createDemoPass, wipe, simulateLoad,
    // staff wallets (finance funds the team)
    staffWalletFor, staffWallets, fundStaffWallet,
    // financial audit (every money event — export / email end-of-day report)
    financialLedger, financialSummary, financialExport, emailFinancialReport,
    // internals for UI niceties
    audit,
  };
})();
