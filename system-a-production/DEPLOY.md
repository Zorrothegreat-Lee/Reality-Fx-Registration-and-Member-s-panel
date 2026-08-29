# Reality FX — System A Production Deployment

> **The Fort goes live.** This document is the step-by-step guide to deploying
> System A's authentication authority to production.

---

## Prerequisites

- [ ] Node.js 18+ installed
- [ ] Firebase CLI installed (`npm install -g firebase-tools`)
- [ ] Firebase project created (`firebase login` then `firebase init`)
- [ ] Netlify credits available (for hosting)

---

## Step 1: Generate RS256 Keys

```bash
cd system-a-production/functions
node generate-keys.js
```

This creates:
- `private.pem` — RS256 signing key (NEVER in git)
- `public.pem` — RS256 verification key (safe to share)

**CRITICAL:** After setting the environment variable, delete `private.pem` from disk.

---

## Step 2: Configure Firebase

```bash
cd system-a-production

# Set the project
firebase use --add realityfx  # or your project ID

# Set environment variables
firebase functions:config:set \
  signing.key="$(cat functions/private.pem)" \
  signing.keyid="rfx-key-1" \
  os.origin="https://os.realityfx.com"
```

---

## Step 3: Initialize Firestore

```bash
# Create the consumed_tokens collection
# (Firestore creates collections automatically on first write)
# The /open-os function will create the document on first token issuance
```

**Firestore Security Rules** (if needed):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // consumed_tokens — only server can write
    match /consumed_tokens/{jti} {
      allow read, write: if false;  // Cloud Functions only
    }
    
    // enrollments — only server can write
    match /enrollments/{id} {
      allow read, write: if false;  // Cloud Functions only
    }
    
    // securityEvents — only server can write
    match /securityEvents/{id} {
      allow read, write: if false;  // Cloud Functions only
    }
  }
}
```

---

## Step 4: Deploy

```bash
cd system-a-production
firebase deploy --only functions
```

This deploys:
- `openOs` — Token generation endpoint
- `verifyToken` — Token verification endpoint

**Expected output:**
```
✔  Deploy complete!
```

**Function URLs:**
- `https://us-central1-<project>.cloudfunctions.net/openOs`
- `https://us-central1-<project>.cloudfunctions.net/verifyToken`

---

## Step 5: Verify Deployment

```bash
cd functions
node test-verify.js https://us-central1-<project>.cloudfunctions.net
```

**Expected:** All 11 proofs pass (✅).

---

## Step 6: Configure Hosting (if using Firebase Hosting)

```bash
# Update firebase.json with your project's hosting config
# Then deploy hosting:
firebase deploy --only hosting
```

**Rewrites in firebase.json** route:
- `/open-os` → `openOs` Cloud Function
- `/api/verify-token` → `verifyToken` Cloud Function

---

## Step 7: Update the OS

The OS needs to know the System A origin for token verification.

**In the OS config:**
```javascript
const SYSTEM_A_ORIGIN = "https://us-central1-<project>.cloudfunctions.net";
// or if using Firebase Hosting:
const SYSTEM_A_ORIGIN = "https://<project>.web.app";
```

**The OS `rfxAuthGate()` calls:**
```
POST {SYSTEM_A_ORIGIN}/verifyToken
Body: { "token": "<jwt>" }
```

---

## Step 8: Update the Member Panel

The member panel's "Open Reality FX OS" button needs to redirect to:

```
{SYSTEM_A_ORIGIN}/openOs?email={student@email.com}
```

This generates the JWT and redirects to the OS with `?token=`.

---

## Step 9: Run Integration Tests

Once both systems are deployed:

1. **Test 1:** Unauthenticated access → redirect to System A
2. **Test 2:** Valid token → authenticated Academy session
3. **Test 3:** Expired token → redirect to System A
4. **Test 4:** Invalid signature → redirect to System A
5. **Test 5:** Replay (same token twice) → redirect to System A
6. **Test 6:** System A unavailable → redirect fails gracefully
7. **Test 7:** Token in URL scrubbed after capture
8. **Test 8:** Logout banks session, clears AUTH, redirects to System A
9. **Test 9:** Direct URL navigation without token → redirect to System A
10. **Test 10:** Multiple tabs → single-session guard works
11. **Test 11:** Tab refresh → requires re-authentication
12. **Test 12:** TRUST_VERIFIED only true after verified System A response

---

## Step 10: Security Hardening

After deployment, verify:

- [ ] **HTTPS enforced** — All traffic over TLS
- [ ] **HSTS enabled** — `Strict-Transport-Security` header
- [ ] **Security headers** — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- [ ] **Private key not in repo** — Git scan confirms no `.pem` files
- [ ] **Environment variables set** — `SIGNING_KEY`, `KEY_ID`, `OS_ORIGIN`
- [ ] **Firestore rules** — `consumed_tokens` is server-only

---

## Step 11: Record Evidence

After all tests pass, update `FOR-LEE.md` §18:

```
## §18 · Production Verification — COMPLETE

| Proof | Status | Evidence |
|-------|--------|----------|
| 1 — Legitimate Flow | ✅ | [screenshot/recording] |
| 2 — Replay | ✅ | [curl output] |
| 3 — Expiry | ✅ | [curl output] |
| 4 — Signature Tampering | ✅ | [curl output] |
| 5 — Wrong Issuer | ✅ | [curl output] |
| 6 — Wrong Audience | ✅ | [curl output] |
| 7 — Unknown JTI | ✅ | [curl output] |
| 8 — Race Condition | ✅ | [concurrent curl output] |
| 9 — Key Isolation | ✅ | [repo scan result] |
| 10 — Fail-Closed | ✅ | [error test output] |
| 11 — No Error Leakage | ✅ | [error test output] |

**System A is now PROVEN IN PRODUCTION.**
```

---

## Architecture Summary

```
Student → System A Login → Authenticated
                              ↓
                    /open-os?email=...
                              ↓
                    RS256-signed JWT (5-min, unique jti)
                              ↓
                    Redirect to OS: /os/?token=...
                              ↓
                    OS captures token, scrubs URL
                              ↓
                    POST /api/verify-token
                              ↓
                    System A: RS256 verify + atomic consume
                              ↓
                    Returns verified identity + trust
                              ↓
                    OS creates AUTH + OS_SESSION
                              ↓
                    Student enters the Academy
```

---

**Security-Frozen:** 20 August 2026
**Production-Ready:** Awaiting deployment
**Next:** Lee deploys, runs battery, records evidence
