/**
 * Reality FX System A — Authentication Authority / The Fort
 * 
 * Production Cloud Functions:
 * - openOs: Generate RS256-signed JWT, redirect to OS with ?token=
 * - verifyToken: Verify signature, claims, jti, enrollment, atomic consume
 * 
 * Email and Payfast functions are v1 Cloud Functions (at the bottom of this file)
 * that bypass the Cloud Run billing requirement.
 * 
 * Architecture: RFX-SESSION-AUTH-ARCHITECTURE.md §30-§33
 * Contract: FOR-LEE-OS-INTEGRATION-CONTRACT.md
 * 
 * SECURITY-FROZEN: 20 August 2026
 * No architecture changes without documented security reason + founder approval.
 */

const { onCall, onRequest } = require("firebase-functions/v2/https");
const f1 = require("firebase-functions"); // v1 API for functions that bypass Cloud Run billing
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// ---- Initialize Firebase Admin ----
initializeApp();
const db = getFirestore();

// ---- Configuration ----
const TOKEN_TTL = 300; // 5 minutes
const ISSUER = "reality-fx-system-a";
const AUDIENCE = "reality-fx-os";
const OS_ORIGIN = process.env.OS_ORIGIN || "https://os.realityfx.com";

// CORS allowed origins
const ALLOWED_ORIGINS = [
  "https://os.realityfx.com",
  "https://realityfx.netlify.app",
  "http://127.0.0.1:49270",
  "http://127.0.0.1:8125",
];
function setCors(res, req) {
  const origin = req.headers.origin || "";
  if (!ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return;
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

// ---- Load signing key from environment ----
const PRIVATE_KEY = process.env.SIGNING_KEY || null;
const KEY_ID = process.env.KEY_ID || "rfx-key-1";

if (!PRIVATE_KEY) {
  console.error("CRITICAL: SIGNING_KEY environment variable not set. Token generation will fail.");
}

/**
 * GET /open-os?email=...
 * 
 * Generates a short-lived RS256-signed JWT and redirects to the OS.
 */
exports.openOs = onRequest(async (req, res) => {
  setCors(res, req);
  
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method-not-allowed" }); return; }
  if (!PRIVATE_KEY) { res.status(500).json({ error: "server-error", msg: "Signing key not configured." }); return; }
  
  const email = ((req.query.email || "") + "").toLowerCase().trim();
  if (!email) { res.status(400).json({ error: "malformed", msg: "Missing email parameter." }); return; }
  
  try {
    const enrollmentsRef = db.collection("enrollments");
    const snapshot = await enrollmentsRef.where("payment.email", "==", email).limit(1).get();
    
    let enrollment;
    if (snapshot.empty) {
      const snapshot2 = await enrollmentsRef.where("email", "==", email).limit(1).get();
      if (snapshot2.empty) { res.redirect(302, `${OS_ORIGIN}/member.html?error=no-account`); return; }
      enrollment = snapshot2.docs[0].data();
    } else {
      enrollment = snapshot.docs[0].data();
    }
    
    if (enrollment.state !== "ACTIVE") { res.redirect(302, `${OS_ORIGIN}/member.html?error=not-active`); return; }
    
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const name = enrollment.registration?.personal?.fullName || enrollment.payment?.customerName || "";
    const founder = !!enrollment.founder || email === "leeroychirwa18@gmail.com" || (enrollment.tags && enrollment.tags.includes("FOUNDER"));
    
    const enrolledChapters = [];
    if (enrollment.courseProgress) {
      for (const [ch, data] of Object.entries(enrollment.courseProgress)) {
        if (data && data.passed) enrolledChapters.push(parseInt(ch));
      }
    }
    enrolledChapters.sort((a, b) => a - b);
    
    const commercialTier = enrollment.payment?.tier || "CORE";
    
    const claims = {
      sub: enrollment.studentId || "",
      name, email, founder,
      status: "ACTIVE",
      printTrust: "standard",
      enrolled: enrolledChapters,
      commercialTier,
      iat: now,
      exp: now + TOKEN_TTL,
      jti,
      iss: ISSUER,
      aud: AUDIENCE,
    };
    
    await db.collection("consumed_tokens").doc(jti).set({
      jti, email, studentId: enrollment.studentId || "",
      consumed: false, createdAt: now, expiresAt: now + TOKEN_TTL,
    });
    
    const token = jwt.sign(claims, PRIVATE_KEY, {
      algorithm: "RS256",
      header: { alg: "RS256", typ: "JWT", kid: KEY_ID },
    });
    
    await db.collection("securityEvents").add({
      at: new Date().toISOString(),
      event: "OS_TOKEN_ISSUED",
      detail: `Short-lived OS token issued for ${email} (jti: ${jti})`,
      email, studentId: enrollment.studentId || "",
    });
    
    res.redirect(302, `${OS_ORIGIN}/os/?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("openOs error:", err);
    res.status(500).json({ error: "server-error", msg: "An unexpected error occurred." });
  }
});

/**
 * POST /api/verify-token
 * 
 * Verifies a JWT token from the OS. Returns deterministic §31.2 response.
 */
exports.verifyToken = onRequest(async (req, res) => {
  setCors(res, req);
  
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method-not-allowed" }); return; }
  
  const body = req.body || {};
  const token = body.token || "";
  
  if (!token || typeof token !== "string") {
    res.status(400).json({ valid: false, error: "malformed", msg: "Missing or empty token." });
    return;
  }
  
  let claims;
  try {
    claims = jwt.verify(token, getPublicKey(), { algorithms: ["RS256"], issuer: ISSUER, audience: AUDIENCE });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ valid: false, error: "expired", msg: "Token has expired — please re-authenticate." });
      return;
    }
    if (err.name === "JsonWebTokenError") {
      const msg = err.message.includes("issuer") ? "Token issuer mismatch."
        : err.message.includes("audience") ? "Token not intended for RFX OS."
        : "Invalid token signature.";
      res.status(401).json({ valid: false, error: "invalid", msg });
      return;
    }
    res.status(401).json({ valid: false, error: "invalid", msg: "Token verification failed." });
    return;
  }
  
  if (!claims.jti || typeof claims.jti !== "string") {
    res.status(401).json({ valid: false, error: "invalid", msg: "Token missing jti claim." });
    return;
  }
  if (!claims.sub || typeof claims.sub !== "string") {
    res.status(401).json({ valid: false, error: "invalid", msg: "Token missing subject claim." });
    return;
  }
  
  const jti = claims.jti;
  const tokenRef = db.collection("consumed_tokens").doc(jti);
  
  try {
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(tokenRef);
      if (!doc.exists) return { status: "unknown", msg: "Unknown token — not issued by this system." };
      if (doc.data().consumed) return { status: "replay", msg: "This token has already been used." };
      transaction.update(tokenRef, { consumed: true, consumedAt: Math.floor(Date.now() / 1000) });
      return { status: "ok" };
    });
    
    if (result.status === "unknown") { res.status(401).json({ valid: false, error: "invalid", msg: result.msg }); return; }
    if (result.status === "replay") { res.status(409).json({ valid: false, error: "replay-detected", msg: result.msg }); return; }
  } catch (err) {
    console.error("Atomic consume error:", err);
    res.status(500).json({ valid: false, error: "server-error", msg: "Verification service temporarily unavailable." });
    return;
  }
  
  let trustScore = 0;
  let trustRestricted = true;
  
  try {
    const enrollmentSnapshot = await db.collection("enrollments").where("studentId", "==", claims.sub).limit(1).get();
    if (!enrollmentSnapshot.empty) {
      const enrollment = enrollmentSnapshot.docs[0].data();
      if (enrollment.state !== "ACTIVE") {
        res.status(403).json({ valid: false, error: "not-permitted", msg: "Student enrollment is not active." });
        return;
      }
      if (enrollment.trust) { trustScore = enrollment.trust.score || 0; trustRestricted = !!enrollment.trust.restricted; }
    }
  } catch (err) { console.error("Enrollment lookup error:", err); }
  
  res.status(200).json({
    valid: true,
    identity: {
      studentId: claims.sub || "",
      verifiedName: claims.name || "",
      email: claims.email || "",
      founder: claims.founder || false,
      status: claims.status || "ACTIVE",
      commercialTier: claims.commercialTier || "CORE",
      permissions: null,
    },
    trust: { score: trustScore, restricted: trustRestricted },
    token: { issuedAt: claims.iat || 0, expiresAt: claims.exp || 0, jti },
  });
});

function getPublicKey() {
  if (process.env.PUBLIC_KEY) return process.env.PUBLIC_KEY;
  throw new Error("PUBLIC_KEY env var not set. Cannot verify tokens.");
}

// ===================================================================
// v1 CLOUD FUNCTIONS — Email & Payfast (bypass Cloud Run billing)
// ===================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || f1.config().resend?.key || null;
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev"; // Use verified domain or Resend default for testing

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || f1.config().payfast?.merchant_id || "";
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || f1.config().payfast?.merchant_key || "";
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE || f1.config().payfast?.passphrase || "";
const PAYFAST_SANDBOX = (process.env.PAYFAST_SANDBOX || f1.config().payfast?.sandbox || "true") === "true";

const PAYFAST_URL = PAYFAST_SANDBOX
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";

const SYSTEM_A_BASE = process.env.SYSTEM_A_BASE || "https://reality-fx-production-25796.web.app";

/**
 * POST /api/send-email
 * v1 Cloud Function — Resend email delivery
 */
exports.sendEmail = f1.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method-not-allowed" }); return; }

  if (!RESEND_API_KEY) {
    console.error("CRITICAL: RESEND_API_KEY not configured.");
    res.status(500).json({ ok: false, error: "Email service not configured." });
    return;
  }

  const { to, subject, html, replyTo } = req.body || {};
  if (!to || typeof to !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    res.status(400).json({ ok: false, error: "Invalid or missing 'to' email address." });
    return;
  }
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    res.status(400).json({ ok: false, error: "Missing 'subject'." });
    return;
  }
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    res.status(400).json({ ok: false, error: "Missing 'html' body." });
    return;
  }

  try {
    const { Resend } = require("resend");
    const resend = new Resend(RESEND_API_KEY);

    const emailData = { from: RESEND_FROM, to: [to], subject, html };
    if (replyTo && typeof replyTo === "string") emailData.replyTo = replyTo;

    const result = await resend.emails.send(emailData);
    if (result.error) {
      console.error("Resend error:", result.error);
      res.status(502).json({ ok: false, error: "Email delivery failed: " + result.error.message });
      return;
    }

    await db.collection("securityEvents").add({
      at: new Date().toISOString(),
      event: "EMAIL_SENT",
      detail: `Email sent to ${to} — subject: ${subject.substring(0, 60)}`,
      email: to,
    });

    res.status(200).json({ ok: true, id: result.data?.id || null });
  } catch (err) {
    console.error("sendEmail error:", err);
    res.status(500).json({ ok: false, error: "Email service temporarily unavailable." });
  }
});

function payfastSignature(params, passphrase) {
  const filtered = Object.keys(params)
    .filter(k => k !== "signature" && params[k] !== "" && params[k] != null)
    .sort()
    .reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});
  let str = Object.keys(filtered)
    .map(k => `${k}=${encodeURIComponent(filtered[k]).replace(/%20/g, "+")}`)
    .join("&");
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

/**
 * POST /api/payfast-init
 * v1 Cloud Function — Generate signed Payfast payment form
 */
exports.payfastInit = f1.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method-not-allowed" }); return; }

  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) {
    res.status(500).json({ ok: false, error: "Payfast not configured." });
    return;
  }

  const { tier, email, studentName, phone } = req.body || {};
  if (!tier || !email || !studentName) {
    res.status(400).json({ ok: false, error: "Missing required fields: tier, email, studentName." });
    return;
  }

  const TIERS = {
    BASIC:   { name: "Reality FX — BASIC",   price: "1500.00" },
    CORE:    { name: "Reality FX — CORE",    price: "2600.00" },
    PRO:     { name: "Reality FX — PRO",     price: "4500.00" },
    ELITE:   { name: "Reality FX — ELITE",   price: "6000.00" },
    MASTERY: { name: "Reality FX — MASTERY", price: "10000.00" },
  };

  const programme = TIERS[String(tier).toUpperCase()];
  if (!programme) { res.status(400).json({ ok: false, error: "Invalid tier: " + tier }); return; }

  const paymentId = "RFX-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  await db.collection("payments").doc(paymentId).set({
    paymentId,
    tier: String(tier).toUpperCase(),
    course: programme.name,
    price: parseFloat(programme.price),
    currency: "ZAR",
    email: email.toLowerCase().trim(),
    studentName,
    phone: phone || "",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });

  const params = {
    merchant_id: PAYFAST_MERCHANT_ID,
    merchant_key: PAYFAST_MERCHANT_KEY,
    return_url: `${SYSTEM_A_BASE}/payment-complete.html?id=${paymentId}&status=success`,
    cancel_url: `${SYSTEM_A_BASE}/payment-complete.html?id=${paymentId}&status=cancelled`,
    notify_url: `${SYSTEM_A_BASE}/api/payfast-itn`,
    email_confirmation: 1,
    confirmation_address: email,
    m_payment_id: paymentId,
    amount: programme.price,
    item_name: programme.name,
    item_description: `${programme.name} — Reality FX Trading Academy`,
    custom_str1: String(tier).toUpperCase(),
    custom_str2: email.toLowerCase().trim(),
  };

  params.signature = payfastSignature(params, PAYFAST_PASSPHRASE);

  const formFields = Object.keys(params)
    .map(k => `<input type="hidden" name="${k}" value="${String(params[k]).replace(/"/g, '&quot;')}">`)
    .join("\n    ");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reality FX — Redirecting to Payfast...</title></head>
<body style="margin:0;padding:0;background:#0e0d0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Georgia,serif;">
<div style="text-align:center;color:#E5C158;">
  <div style="font-size:24px;margin-bottom:16px;">⏳</div>
  <div style="font-size:18px;">Redirecting to Payfast...</div>
  <div style="font-size:13px;color:#888;margin-top:8px;">If the page does not redirect automatically, click the button below.</div>
  <form id="pf" method="POST" action="${PAYFAST_URL}" style="margin-top:20px;">
    ${formFields}
    <button type="submit" style="background:#E5C158;color:#0e0d0a;border:none;padding:12px 30px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">Pay Now</button>
  </form>
  <script>document.getElementById('pf').submit();</script>
</div>
</body>
</html>`;

  res.status(200).json({ ok: true, form: html });
});

/**
 * POST /api/payfast-itn
 * v1 Cloud Function — Payfast Instant Transaction Notification
 */
exports.payfastItn = f1.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  try {
    const body = req.body || {};
    const receivedSignature = body.signature;
    const calculatedSignature = payfastSignature(body, PAYFAST_PASSPHRASE);

    if (receivedSignature !== calculatedSignature) {
      console.error("Payfast ITN signature mismatch");
      await db.collection("securityEvents").add({
        at: new Date().toISOString(),
        event: "PAYFAST_ITN_SIGNATURE_FAIL",
        detail: `ITN signature mismatch for payment ${body.m_payment_id}`,
      });
      res.status(400).send("Invalid signature");
      return;
    }

    const paymentStatus = (body.payment_status || "").toUpperCase();
    const paymentId = body.m_payment_id || "";
    if (!paymentId) { res.status(400).send("Missing payment ID"); return; }

    const paymentRef = db.collection("payments").doc(paymentId);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) { res.status(404).send("Payment not found"); return; }
    const payment = paymentDoc.data();
    if (payment.status === "COMPLETE") { res.status(200).send("OK"); return; }

    await paymentRef.update({
      status: paymentStatus,
      payfastPaymentId: body.pf_payment_id || "",
      payfastAmount: body.amount_gross || payment.price,
      payfastFee: body.amount_fee || "0",
      payfastNet: body.amount_net || payment.price,
      completedAt: paymentStatus === "COMPLETE" ? new Date().toISOString() : null,
      itnReceivedAt: new Date().toISOString(),
    });

    if (paymentStatus === "COMPLETE") {
      const existingEnrollment = await db.collection("enrollments")
        .where("payment.transactionId", "==", paymentId).limit(1).get();

      if (existingEnrollment.empty) {
        const enrollmentId = "ENR-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
        const studentId = "RFX-" + (10000 + Math.floor(Math.random() * 90000));

        await db.collection("enrollments").doc(enrollmentId).set({
          id: enrollmentId, studentId,
          createdAt: new Date().toISOString(),
          state: "PENDING",
          payment: {
            customerName: payment.studentName, email: payment.email,
            course: payment.course, tier: payment.tier,
            price: payment.price, currency: payment.currency,
            transactionId: paymentId, paymentMethod: "Payfast",
            phone: payment.phone || "", paidAt: new Date().toISOString(),
          },
          invoice: {
            number: "INV-" + new Date().getFullYear() + "-" + crypto.randomBytes(2).readUInt16BE(0).toString().padStart(4, "0"),
            issuedAt: new Date().toISOString(), status: "PAID",
          },
          registration: null,
          handoff: { attempts: [], confirmedAt: null, lastError: null },
          audit: [{ at: new Date().toISOString(), event: "PAYFAST_PAYMENT_COMPLETE",
            detail: `Payment ${paymentId} confirmed via Payfast ITN` }],
          progress: { purchase: true, invoiceEmail: false, registrationEmail: false,
            registrationSubmitted: false, approved: false },
        });

        await db.collection("securityEvents").add({
          at: new Date().toISOString(),
          event: "ENROLLMENT_CREATED_VIA_PAYFAST",
          detail: `Enrollment ${enrollmentId} from Payfast ${paymentId} — ${payment.studentName} — ${payment.course}`,
          email: payment.email, studentId,
        });
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Payfast ITN error:", err);
    res.status(200).send("OK");
  }
});
