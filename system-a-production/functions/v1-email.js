/**
 * Reality FX — v1 Cloud Functions
 * 
 * These functions use Firebase v1 (Google Cloud Functions v1) which
 * works without Cloud Run billing. They handle:
 * - sendEmail: Resend email delivery
 * - payfastInit: Payfast payment form generation
 * - payfastItn: Payfast ITN callback
 * 
 * v2 functions (openOs, verifyToken) remain in index.js.
 */

const functions = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

// Initialize Firebase Admin (only once per process)
try {
  initializeApp();
} catch (e) { /* already initialized */ }
const db = getFirestore();

// ---- Configuration ----
const RESEND_API_KEY = process.env.RESEND_API_KEY || functions.config().resend?.key || null;
const RESEND_FROM = process.env.RESEND_FROM || "Reality FX <realityfx20@gmail.com>";

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || functions.config().payfast?.merchant_id || "";
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || functions.config().payfast?.merchant_key || "";
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE || functions.config().payfast?.passphrase || "";
const PAYFAST_SANDBOX = (process.env.PAYFAST_SANDBOX || functions.config().payfast?.sandbox || "true") === "true";

const PAYFAST_URL = PAYFAST_SANDBOX
  ? "https://sandbox.payfast.co.za/eng/process"
  : "https://www.payfast.co.za/eng/process";

const SYSTEM_A_BASE = process.env.SYSTEM_A_BASE || "https://reality-fx-production-25796.web.app";

// ===================================================================
// EMAIL DELIVERY (Resend)
// ===================================================================

exports.sendEmail = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

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

    const emailData = {
      from: RESEND_FROM,
      to: [to],
      subject: subject,
      html: html,
    };
    if (replyTo && typeof replyTo === "string") {
      emailData.replyTo = replyTo;
    }

    const result = await resend.emails.send(emailData);

    if (result.error) {
      console.error("Resend error:", result.error);
      res.status(502).json({ ok: false, error: "Email delivery failed: " + result.error.message });
      return;
    }

    // Audit
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

// ===================================================================
// PAYFAST INTEGRATION
// ===================================================================

function payfastSignature(params, passphrase) {
  const filtered = Object.keys(params)
    .filter(k => k !== "signature" && params[k] !== "" && params[k] != null)
    .sort()
    .reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});

  let str = Object.keys(filtered)
    .map(k => `${k}=${encodeURIComponent(filtered[k]).replace(/%20/g, "+")}`)
    .join("&");

  if (passphrase) {
    str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`;
  }

  return crypto.createHash("md5").update(str).digest("hex");
}

exports.payfastInit = functions.https.onRequest(async (req, res) => {
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
  if (!programme) {
    res.status(400).json({ ok: false, error: "Invalid tier: " + tier });
    return;
  }

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

exports.payfastItn = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  try {
    const body = req.body || {};

    // 1. Verify ITN signature
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

    // 2. Check payment status
    const paymentStatus = (body.payment_status || "").toUpperCase();
    const paymentId = body.m_payment_id || "";

    if (!paymentId) { res.status(400).send("Missing payment ID"); return; }

    // 3. Get payment record
    const paymentRef = db.collection("payments").doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      res.status(404).send("Payment not found");
      return;
    }

    const payment = paymentDoc.data();

    // 4. Idempotency
    if (payment.status === "COMPLETE") { res.status(200).send("OK"); return; }

    // 5. Update payment record
    await paymentRef.update({
      status: paymentStatus,
      payfastPaymentId: body.pf_payment_id || "",
      payfastAmount: body.amount_gross || payment.price,
      payfastFee: body.amount_fee || "0",
      payfastNet: body.amount_net || payment.price,
      completedAt: paymentStatus === "COMPLETE" ? new Date().toISOString() : null,
      itnReceivedAt: new Date().toISOString(),
    });

    // 6. If COMPLETE, create enrollment
    if (paymentStatus === "COMPLETE") {
      const existingEnrollment = await db.collection("enrollments")
        .where("payment.transactionId", "==", paymentId)
        .limit(1)
        .get();

      if (existingEnrollment.empty) {
        const enrollmentId = "ENR-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
        const studentId = "RFX-" + (10000 + Math.floor(Math.random() * 90000));

        await db.collection("enrollments").doc(enrollmentId).set({
          id: enrollmentId,
          studentId,
          createdAt: new Date().toISOString(),
          state: "PENDING",
          payment: {
            customerName: payment.studentName,
            email: payment.email,
            course: payment.course,
            tier: payment.tier,
            price: payment.price,
            currency: payment.currency,
            transactionId: paymentId,
            paymentMethod: "Payfast",
            phone: payment.phone || "",
            paidAt: new Date().toISOString(),
          },
          invoice: {
            number: "INV-" + new Date().getFullYear() + "-" + crypto.randomBytes(2).readUInt16BE(0).toString().padStart(4, "0"),
            issuedAt: new Date().toISOString(),
            status: "PAID",
          },
          registration: null,
          handoff: { attempts: [], confirmedAt: null, lastError: null },
          audit: [{
            at: new Date().toISOString(),
            event: "PAYFAST_PAYMENT_COMPLETE",
            detail: `Payment ${paymentId} confirmed via Payfast ITN`,
          }],
          progress: {
            purchase: true,
            invoiceEmail: false,
            registrationEmail: false,
            registrationSubmitted: false,
            approved: false,
          },
        });

        await db.collection("securityEvents").add({
          at: new Date().toISOString(),
          event: "ENROLLMENT_CREATED_VIA_PAYFAST",
          detail: `Enrollment ${enrollmentId} from Payfast ${paymentId} — ${payment.studentName} — ${payment.course}`,
          email: payment.email,
          studentId,
        });
      }
    }

    res.status(200).send("OK");

  } catch (err) {
    console.error("Payfast ITN error:", err);
    res.status(200).send("OK");
  }
});
