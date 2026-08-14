# FOR-LEE — The Gate Function (System B's side of the gatekeeper contract)

> Written by the System A side so the two systems speak the same contract.
> System A holds ALL the power of who gets in. System B never decides — it
> only follows. This file gives you the exact Cloud Function snippet that
> calls the gate **before** any session is issued, with the failure paths
> spelled out. Companion to FOR-LEE.md §9.61 + §9.62.

---

## 1. The contract (one paragraph)

When the OS is about to let a student in — login, session claim, or any
privileged action — it must FIRST ask System A: *"can this identity come
in?"* The answer is a live read of System A's own throttle record, and it is
**authoritative**. If the gate says locked, no session is issued. There is no
second opinion, no override, no OS-side bypass. The student can recover via
*Forgot password?* on System A — the gate lifts itself when the window
passes or the student recovers.

## 2. The endpoint

```
GET {SYSTEM_A}/api/gate?email=student@example.com
```

- **Unlocked / unknown / expired lockout:**
  ```json
  { "locked": false }
  ```
- **Locked:**
  ```json
  { "locked": true, "lockedUntil": "2026-08-14T18:59:42.217Z", "minutesLeft": 15 }
  ```
- CORS: preflight `OPTIONS` is answered with
  `Access-Control-Allow-Origin: *` and
  `Access-Control-Allow-Headers: Content-Type, X-RFX-Handoff-Key`.

The demo endpoint is `http://127.0.0.1:8125/api/gate`. Production: replace
`SYSTEM_A` with the Firebase-backed URL (or call the Firebase function
directly — same response shape, same meaning).

## 3. The Cloud Function snippet (Node.js / Firebase)

```js
// functions/index.js — the OS's session-gate. Call this BEFORE issuing any
// session (custom token, session doc, or onAuthStateChanged hand-off).
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// System A's gate — production points at the Firebase-backed gate URL.
// The demo server answers this exact shape at /api/gate (see FOR-LEE §9.62).
const SYSTEM_A_GATE = process.env.SYSTEM_A_GATE_URL; // e.g. https://…/api/gate
const GATE_TIMEOUT_MS = 4000; // a slow gate must never stall a login forever

/**
 * askTheGate — the ONLY way the OS learns whether an identity may come in.
 * Returns { allowed:true } or { allowed:false, reason, minutesLeft }.
 * NEVER fails open: if System A is unreachable, the OS refuses the session
 * (the student sees the calm lock screen, not a dead end — the recovery
 * path is System A's Forgot password?, which the OS points to).
 */
async function askTheGate(email) {
  if (!SYSTEM_A_GATE) {
    // Config error — refuse rather than silently let everyone in.
    console.error('askTheGate: SYSTEM_A_GATE_URL is not configured');
    return { allowed: false, reason: 'gate_unconfigured' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${SYSTEM_A_GATE}?email=${encodeURIComponent(email)}`, {
      headers: { 'Accept': 'application/json' },
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('gate http ' + res.status);
    const g = await res.json();
    if (g && g.locked === true) {
      return {
        allowed: false,
        reason: 'locked',
        minutesLeft: g.minutesLeft || null,
        lockedUntil: g.lockedUntil || null,
      };
    }
    return { allowed: true };
  } catch (err) {
    clearTimeout(timer);
    // Fail closed — see the header comment. Log it loudly: the gate is the
    // whole point, and an unreachable gate is an incident, not a shrug.
    console.error('askTheGate: gate unreachable for', email, err.message);
    return { allowed: false, reason: 'gate_unreachable' };
  }
}

// ---- usage: the session claim endpoint, now gate-checked -------------------
exports.claimSession = functions.https.onCall(async (data, context) => {
  const email = String((data && data.email) || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no_email' };

  // 1. THE GATE — System A decides first. Nothing below runs if it says no.
  const gate = await askTheGate(email);
  if (!gate.allowed) {
    admin.firestore().collection('securityEvents').add({
      event: 'GATE_DENIED', email, reason: gate.reason,
      minutesLeft: gate.minutesLeft || null, at: new Date().toISOString(),
    });
    return {
      ok: false,
      reason: gate.reason,
      message: gate.reason === 'locked'
        ? 'Sign-in is temporarily locked. You can try again in a few minutes, or use Forgot password? on the member portal to recover now.'
        : 'The gate could not be reached. Please try again in a moment.',
      minutesLeft: gate.minutesLeft || null,
    };
  }

  // 2. ONLY NOW — identity, entitlement, single-session revocation, and the
  //    custom token / session doc the OS actually uses. (Your existing logic.)
  const student = await admin.firestore().collection('students').doc(email).get();
  if (!student.exists) return { ok: false, reason: 'unknown_identity' };
  // … single-session guard, custom token minting, etc. …

  admin.firestore().collection('securityEvents').add({
    event: 'GATE_ALLOWED', email, at: new Date().toISOString(),
  });
  return { ok: true, studentId: student.data().studentId };
});
```

## 4. The rules that never bend

1. **Gate first, always.** Every session-issuing path (login, claim, refresh)
   calls `askTheGate` before minting anything. If you find a path that skips
   it, that is a bug.
2. **Fail closed.** A locked gate refuses. An *unreachable* gate also refuses
   — with a calm message, never a dead page. The recovery path is System A's
   *Forgot password?*; the OS's lock screen already links there.
3. **No OS-side authorization.** The OS never decides who gets in, never
   overrides, never mints a bypass. It only follows the gate.
4. **Log both sides.** `GATE_DENIED` and `GATE_ALLOWED` land in the security
   event store — every attempt is a trace.

## 5. Verify (do this once, in production)

```bash
# locked student (mint a lockout on System A first: 5 failed logins)
curl "{SYSTEM_A}/api/gate?email=locked-student@example.com"
# → {"locked":true,"lockedUntil":"…","minutesLeft":15}

# unlocked student
curl "{SYSTEM_A}/api/gate?email=student@example.com"
# → {"locked":false}

# the OS refuses a locked student: call claimSession with that email
# → { ok:false, reason:"locked", minutesLeft:15 }  and GATE_DENIED logged
```

✅ *done when: a locked student cannot obtain a session through ANY OS path,
a GATE_DENIED event is logged with the countdown, and the same student after
recovery (or the window passing) is let in with zero code changes.*
