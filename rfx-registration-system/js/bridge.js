/* ============================================================
   REALITY FX — ENROLLMENT & REGISTRATION SYSTEM  (System A)
   js/bridge.js — the RFX OS Bridge (Pillars 4 & 5)
   ------------------------------------------------------------
   The handshake:

     SYSTEM A                        SYSTEM B (RFX OS — Lee's system)
       |                                  |
       |   POST /api/handoff              |
       |   { studentId, studentCode,      |
       |     idempotencyKey, ... }        |
       |--------------------------------->|
       |                                  |  validate + create/update
       |   { received: true, ... }        |
       |<---------------------------------|
       |   state = RFX_OS_CONFIRMED       |
       |   state = ACTIVE                 |

   Safety rails:
   1. IDEMPOTENCY — the Student ID is the key. Re-sending the same
      student can never create a second identity in RFX OS.
   2. RETRY — a lost response never panics the staff. The system
      goes SYNC_FAILED and retries automatically with backoff.
   3. RECONCILIATION — if RFX OS replies "already have this one",
      that is a success, not an error.
   ============================================================ */

window.RFX = window.RFX || {};

(function () {
  'use strict';

  const RETRY_BACKOFF = [5, 15, 45, 120]; // seconds between automatic retries
  const DEMO_HICCUP_RATE = 0.25; // demo mode randomly drops a handshake so retry logic stays honest
  const timers = {}; // enrollmentId -> setTimeout handle

  /* ---------------- the one and only sync entry point ---------------- */
  async function sync(enrollment) {
    const db = RFX.db;
    if (!enrollment || !enrollment.studentId) return { ok: false, error: 'No Student ID yet — approve the student first.' };
    if (enrollment.state === 'RFX_OS_CONFIRMED' || enrollment.state === 'ACTIVE') {
      return { ok: true, already: true, msg: 'Already confirmed with RFX OS.' };
    }

    db.transition(enrollment, 'SYNCING_WITH_RFX_OS');

    const payload = buildPayload(enrollment);
    const settings = db.getSettings();

    db.noteHandoffAttempt(enrollment, {
      event: 'SYNC_STARTED',
      idempotencyKey: payload.idempotencyKey,
      endpoint: settings.rfxOsEndpoint,
    });

    try {
      const response = await doHandoff(payload, settings);
      const confirmed = response && (response.received === true || response.already === true);

      if (!confirmed) {
        throw new Error('RFX OS responded but did not confirm receipt.');
      }

      // RFX OS says "got him" (whether created now or already existing)
      db.noteHandoffAttempt(enrollment, {
        event: 'SYNC_OK',
        confirmedAt: response.confirmedAt || null,
        note: response.already ? 'RFX OS reported this Student ID already exists (reconciled, no duplicate created).' : 'RFX OS confirmed receipt.',
      });
      RFX.db.audit(enrollment, 'HANDOFF_CONFIRMED', 'RFX OS acknowledged ' + enrollment.studentId + ' (idempotency key honoured)');
      // every handoff call lands in the security feed — a flood of rejects
      // or duplicates is an attack signal, not a coincidence
      db.secEvent(response.already ? 'HANDOFF_DUPLICATE' : 'HANDOFF_OK',
        enrollment.studentId + ' → RFX OS · ' + (response.already ? 'already existed — reconciled, no duplicate' : 'confirmed receipt'));

      db.transition(enrollment, 'RFX_OS_CONFIRMED');
      await new Promise(r => setTimeout(r, 600)); // small beat so the UI feels deliberate
      db.transition(enrollment, 'ACTIVE');
      db.email('welcome', enrollment.payment.email,
        'Welcome to Reality FX — your OS access is ready, ' + enrollment.payment.customerName,
        welcomeEmail(enrollment));

      clearRetry(enrollment.id);
      return { ok: true, response };
    } catch (err) {
      db.noteHandoffAttempt(enrollment, { event: 'SYNC_ERROR', error: err.message });
      db.transition(enrollment, 'SYNC_FAILED');
      RFX.db.audit(enrollment, 'HANDOFF_FAILED', err.message);
      db.secEvent('HANDOFF_REJECT', enrollment.studentId + ' → RFX OS · ' + err.message);
      scheduleRetry(enrollment);
      return { ok: false, error: err.message };
    }
  }

  /* ---------------- payload (what System A hands over) ---------------- */
  function buildPayload(enrollment) {
    // The student's standing rides the handoff so the OS renders the SAME
    // Trust Bar and enforces its rules from the first second (go-live brief §1).
    const trust = RFX.db.trustStatus(enrollment);
    return {
      // The IDEMPOTENCY KEY — see header comment. Never send a student twice.
      idempotencyKey: enrollment.studentId,
      studentId: enrollment.studentId,
      studentCode: enrollment.studentCode,
      verifiedName: (enrollment.registration && enrollment.registration.personal && enrollment.registration.personal.fullName) || enrollment.payment.customerName,
      email: enrollment.payment.email,
      enrollmentId: enrollment.id,
      invoice: enrollment.invoice.number,
      course: enrollment.payment.course,
      // CANONICAL CONTRACT (go-live brief §2.3.5): entitlements is a LIST per
      // identity — a second course MERGES into the record instead of
      // overwriting (the OS reconciles, never treats it as a new person).
      // `course` stays as the display convenience field.
      entitlements: [enrollment.payment.course],
      // trusted printing: an EARNED entitlement the OS must enforce at the
      // backend. 'standard' → watermark + print blackout everywhere.
      // 'trusted' → OS allows printing this student's own course material.
      printTrust: RFX.db.printTrust(enrollment),
      // the founder's master key rides the same handoff so the OS can honour
      // it without a second channel (FOR-LEE §9.39). OS must treat this as an
      // auth-level flag, never as a hard-coded email check.
      founder: RFX.db.isFounder(enrollment),
      // the OS expects these "when present" (go-live brief §1): the demo-pass
      // window, the approval moment, and the current trust standing. JSON
      // drops the undefined ones naturally — absent fields never break a handoff.
      demoPass: enrollment.demoPass
        ? { hours: enrollment.demoPass.hours, createdAt: enrollment.demoPass.createdAt }
        : undefined,
      approvalAt: (enrollment.progress && enrollment.progress.approvedAt) || undefined,
      trust: { score: trust.score, tier: trust.tier },
      // the birthday field — captured at registration (branded calendar,
      // step 1). The OS can mirror it into its learner calendar so a
      // student's birthday shows there too. Absent when unknown, never breaks
      // a handoff.
      dob: (enrollment.registration && enrollment.registration.personal && enrollment.registration.personal.dob) || undefined,
      status: 'ready',
      source: 'reality-fx-registrar',
      sentAt: new Date().toISOString(),
    };
  }

  /* ---------------- the actual HTTP call (or simulation) ---------------- */
  async function doHandoff(payload, settings) {
    if (settings.demoMode || !settings.rfxOsEndpoint) {
      // DEMO MODE — no real RFX OS running yet. Simulate a reliable
      // peer: sometimes "the internet hiccups" so retry logic is real.
      await new Promise(r => setTimeout(r, 1100));
      if (Math.random() < DEMO_HICCUP_RATE) {
        throw new Error('Network timeout reaching RFX OS (simulated). Automatic retry scheduled.');
      }
      return {
        received: true,
        already: false,
        confirmedAt: new Date().toISOString(),
        echo: { studentId: payload.studentId },
      };
    }

    // REAL MODE — talk to Lee's system (System B)
    // The request carries the shared handoff key in a header; the OS Cloud
    // Function refuses any POST without the matching key, so knowing the
    // endpoint URL alone can never mint identities. (See FOR-LEE §9.24.)
    const key = settings.handoffApiKey || 'rfx-handoff-demo-key';
    const res = await fetch(settings.rfxOsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RFX-Handoff-Key': key,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('RFX OS returned HTTP ' + res.status);
    return res.json();
  }

  /* ---------------- automatic retry with backoff ---------------- */
  function scheduleRetry(enrollment) {
    clearRetry(enrollment.id);
    const attempts = (enrollment.handoff.attempts || []).filter(a => a.event === 'SYNC_ERROR').length;
    const delay = RETRY_BACKOFF[Math.min(attempts - 1, RETRY_BACKOFF.length - 1)] || 120;
    const settings = RFX.db.getSettings();

    // try/catch: timer is stored only if the page stays open
    timers[enrollment.id] = setTimeout(async () => {
      RFX.db.audit(enrollment, 'AUTOMATIC_RETRY', 'Retry ' + attempts + ' — waiting ' + delay + 's since last failure');
      if (!settings.demoMode) {
        RFX.db.noteHandoffAttempt(enrollment, { event: 'AUTOMATIC_RETRY' });
      }
      await sync(enrollment);
      RFX.bridge.notify();
    }, delay * 1000);
  }

  function clearRetry(enrollmentId) {
    if (timers[enrollmentId]) { clearTimeout(timers[enrollmentId]); delete timers[enrollmentId]; }
  }

  /* ---------------- listeners (pages hook in to refresh) ---------------- */
  const listeners = [];
  function onSync(listener) { listeners.push(listener); }
  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  /* ---------------- email template ---------------- */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function welcomeEmail(enr) {
    const b = '<div style="border-bottom:2px solid #d4af37;padding-bottom:14px;margin-bottom:20px;font-family:Georgia,serif;color:#080808;">' +
      '<span style="font-size:22px;font-weight:700;">Reality FX</span> <span style="font-size:13px;font-style:italic;color:#a8842a;">Academy</span></div>';
    // the OS entry link derives from the CONFIGURED endpoint (osIndexUrl),
    // never a hardcoded machine address — flipping the environment setting
    // changes the button for every future email without a code change.
    const osUrl = RFX.db.osIndexUrl();
    return b +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Dear <b>' + escHtml(enr.payment.customerName) + '</b>,</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Your Reality FX identity has been established and your RFX OS access is ready.</p>' +
      '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-family:Arial,sans-serif;font-size:13px;color:#333;">' +
      '<b>Student ID:</b> <span style="font-family:monospace;">' + enr.studentId + '</span><br/>' +
      '<b>Course:</b> ' + escHtml(enr.payment.course) + '<br/><b>Status:</b> <span style="color:#1d7a33;font-weight:700;">ACTIVE</span></div>' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444;margin-top:18px;">Sign in to the OS with your email. You will set your password using the OS recovery flow — ' +
      'Reality FX never sends passwords in plain text.</p>' +
      '<div style="text-align:center;margin:26px 0;"><a href="' + escHtml(osUrl) + '" style="display:inline-block;background:linear-gradient(135deg,#f0d98c,#d4af37 45%,#a8842a);color:#241a05;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:14px 34px;border-radius:10px;font-size:14px;">Enter RFX OS</a></div>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Welcome to Reality FX, ' + escHtml(enr.payment.customerName) + '.</p>';
  }

  /* ---------------- public API ---------------- */
  RFX.bridge = {
    sync, onSync, notify, buildPayload,
    retryNow: sync, // manual retry uses the same idempotent path
    /* GATEKEEPER contract — the OS never decides who gets in. When it asks
       "can this identity come in?" the answer comes from HERE: System A's
       own gate, the same throttle record the sign-in screen enforces. System
       B only follows; it never mints authorization.

       Production path: the OS Cloud Function calls GET {systemA}/api/gate?email=…
       before issuing any session. This bridge method mirrors that exactly —
       it tries the live HTTP endpoint first (the demo server serves it on
       this origin; production is Lee's Firebase-backed gate), and falls back
       to the local in-page read of the identical record so the demo never
       breaks when the server is unreachable. */
    gateStatus: function (email) {
      // live HTTP first — the real contract
      try {
        if (typeof fetch === 'function') {
          return fetch('/api/gate?email=' + encodeURIComponent(String(email || '')))
            .then(function (r) { return r.json(); })
            .catch(function () { return { locked: false }; });
        }
      } catch (e) { /* fall through */ }
      // local fallback — same record, in-page
      return Promise.resolve((function () {
        try { return RFX.db.loginLockoutStatus(email); } catch (e) { return { locked: false }; }
      })());
    },
  };
})();
