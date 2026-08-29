#!/usr/bin/env node

/**
 * Reality FX — RS256 Key Generation
 * 
 * Generates an RSA key pair for JWT signing.
 * Run once, store private key securely, deploy public key.
 * 
 * Usage:
 *   node generate-keys.js
 * 
 * Output:
 *   private.pem — RS256 private key (NEVER in git, NEVER in frontend)
 *   public.pem  — RS256 public key (safe to share with OS)
 * 
 * After generation:
 *   1. Copy private.pem to a secure location (not in the repo)
 *   2. Set SIGNING_KEY env var: cat private.pem | firebase functions:config:set signing.key="$(cat private.pem)"
 *   3. Set PUBLIC_KEY env var for verification
 *   4. Send public.pem to the OS team
 *   5. Delete private.pem from disk after setting the env var
 * 
 * SECURITY: The private key must NEVER appear in:
 * - Git repositories
 * - Frontend code
 * - Client-side JavaScript
 * - Any publicly accessible file
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_SIZE = 2048; // RSA-2048 (sufficient for JWT, fast verification)
const OUTPUT_DIR = path.join(__dirname, "..");

console.log("🔐 Reality FX — RS256 Key Generation");
console.log("=====================================\n");

console.log(`Generating RSA-${KEY_SIZE} key pair...`);

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: KEY_SIZE,
  publicKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

// Write private key
const privateKeyPath = path.join(OUTPUT_DIR, "private.pem");
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
console.log(`✅ Private key written to: ${privateKeyPath}`);
console.log(`   ⚠️  Set permissions to 600 (owner read/write only)`);
console.log(`   ⚠️  Delete this file after setting the env var\n`);

// Write public key
const publicKeyPath = path.join(OUTPUT_DIR, "public.pem");
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
console.log(`✅ Public key written to: ${publicKeyPath}`);
console.log(`   📤 Send this to the OS team for verification\n`);

// Generate key ID
const keyId = `rfx-key-${Date.now()}`;
console.log(`🔑 Key ID: ${keyId}`);
console.log(`   Set this as KEY_ID env var\n`);

// Print deployment commands
console.log("📋 Deployment Commands:");
console.log("========================\n");

console.log("# 1. Set the signing key (from the private key file):");
console.log(`   firebase functions:config:set signing.key="$(cat private.pem)"`);
console.log(`   firebase functions:config:set signing.keyid="${keyId}"\n`);

console.log("# 2. Set the public key for verification (if using separate verification):");
console.log(`   firebase functions:config:set publickey="$(cat public.pem)"\n`);

console.log("# 3. Set the OS origin:");
console.log(`   firebase functions:config:set os.origin="https://os.realityfx.com"\n`);

console.log("# 4. Deploy:");
console.log("   firebase deploy --only functions\n");

console.log("# 5. Clean up (IMPORTANT):");
console.log("   rm private.pem   # NEVER keep on disk after setting env var\n");

console.log("⚠️  SECURITY REMINDER:");
console.log("   - Private key: NEVER in git, NEVER in frontend, NEVER in repo");
console.log("   - Public key: Safe to share with OS team");
console.log("   - Key ID: Included in JWT header for rotation support");
