/**
 * TEMPORARY — Seed test enrollment for production proof battery.
 * REMOVE AFTER TESTING.
 */
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.seedTestData = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const secret = req.body.secret || "";
  if (secret !== "rfx-seed-2026") {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    // Create test enrollment
    const studentId = "RFX-PROD-TEST-001";
    const email = "prodtest@rfx.test";

    await db.collection("enrollments").doc(studentId).set({
      studentId,
      email,
      state: "ACTIVE",
      registration: {
        personal: { fullName: "Production Test Student" },
      },
      payment: {
        email,
        customerName: "Production Test Student",
      },
      trust: { score: 85, tier: "trusted", restricted: false },
      tags: ["TEST"],
      courseProgress: { "1": { passed: true }, "2": { passed: true }, "3": { passed: true } },
      founder: false,
      createdAt: new Date().toISOString(),
    });

    res.status(200).json({
      ok: true,
      msg: "Test enrollment created",
      studentId,
      email,
    });
  } catch (err) {
    console.error("Seed error:", err);
    res.status(500).json({ error: "seed-failed", msg: err.message });
  }
});

exports.cleanupTestData = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const secret = req.body.secret || "";
  if (secret !== "rfx-seed-2026") {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    const studentId = "RFX-PROD-TEST-001";
    await db.collection("enrollments").doc(studentId).delete();
    // Clean up consumed tokens for this student
    const tokens = await db.collection("consumed_tokens").where("studentId", "==", studentId).get();
    const batch = db.batch();
    tokens.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    // Clean up security events
    const events = await db.collection("securityEvents").where("studentId", "==", studentId).get();
    const batch2 = db.batch();
    events.docs.forEach(doc => batch2.delete(doc.ref));
    await batch2.commit();

    res.status(200).json({ ok: true, msg: "Test data cleaned up" });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ error: "cleanup-failed", msg: err.message });
  }
});
