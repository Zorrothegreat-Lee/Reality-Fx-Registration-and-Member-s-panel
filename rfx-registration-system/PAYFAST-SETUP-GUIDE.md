# 🫡 PAYFAST SETUP GUIDE — For the Founder

## What you need to do

The Payfast integration is built and ready. You need to:

1. **Create a Payfast merchant account** (or use your existing one)
2. **Get your credentials** (merchant_id + merchant_key)
3. **Configure the environment variables**
4. **Deploy the Cloud Functions**
5. **Test in sandbox mode**

---

## Step 1: Create a Payfast Account

1. Go to **https://www.payfast.co.za**
2. Click **"Sign Up"** or **"Get Started"**
3. Complete the merchant registration
4. You'll receive:
   - **Merchant ID** (e.g., `10000100`)
   - **Merchant Key** (e.g., `46f0cd694581a`)

---

## Step 2: Get Your Credentials

### For Testing (Sandbox):
1. Log into Payfast
2. Go to **Settings → Integration**
3. You'll see your **Sandbox** credentials:
   - Sandbox Merchant ID
   - Sandbox Merchant Key

### For Production (Live):
1. Go to **Settings → Integration**
2. You'll see your **Live** credentials:
   - Live Merchant ID
   - Live Merchant Key

---

## Step 3: Configure Environment Variables

Add these to your `.env` file in `system-a-production/functions/`:

```
PAYFAST_MERCHANT_ID=your_merchant_id_here
PAYFAST_MERCHANT_KEY=your_merchant_key_here
PAYFAST_PASSPHRASE=your_passphrase_here
PAYFAST_SANDBOX=true
SYSTEM_A_BASE=https://reality-fx-production-25796.web.app
```

**For production:** Change `PAYFAST_SANDBOX` to `false`.

---

## Step 4: Deploy

```bash
cd system-a-production/functions
npm install
firebase deploy --only functions
```

---

## Step 5: Test

### Sandbox Test Card:
- Card number: `4000 0000 0000 0002`
- Expiry: Any future date
- CVV: `123`

### Test Flow:
1. Open `https://reality-fx-production-25796.web.app/payment.html`
2. Select a programme
3. Enter name + email
4. Click "Pay Now"
5. Complete payment on Payfast sandbox
6. Verify:
   - Payment record created in Firestore
   - Enrollment created automatically
   - Redirect to payment-complete.html shows success

---

## What's Automated

| Step | Automated? |
|------|-----------|
| Student selects programme | ✅ |
| Payment form generated | ✅ |
| Student pays on Payfast | ✅ |
| ITN received & verified | ✅ |
| Enrollment created | ✅ |
| Student redirected to registration | ✅ |

---

## Troubleshooting

**"Payfast not configured" error:**
→ Check that PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY are set

**ITN not received:**
→ Check that the notify_url is correct:
`https://us-central1-reality-fx-production-25796.cloudfunctions.net/payfastItn`

**Signature mismatch:**
→ Check that PAYFAST_PASSPHRASE matches your Payfast account

---

## Support

If you get stuck, contact Payfast support:
- Email: support@payfast.co.za
- Phone: 087 550 3810
- Docs: https://developers.payfast.co.za
