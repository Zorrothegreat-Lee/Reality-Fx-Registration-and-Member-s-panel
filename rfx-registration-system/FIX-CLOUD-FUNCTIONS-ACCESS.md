# 🫡 FIX: Cloud Functions 403 Forbidden

The new Cloud Functions (sendEmail, payfastInit, payfastItn) are returning **403 Forbidden** because Cloud Run IAM hasn't been configured to allow unauthenticated access.

The old functions (openOs, verifyToken) already have this permission.

## Run this command in Google Cloud Console:

### Option 1: Google Cloud Console (easiest)

1. Go to: https://console.cloud.google.com/run?project=reality-fx-production-25796
2. Click on each of these services:
   - `sendemail-qnadxzwqlq`
   - `payfastinit-qnadxzwqlq`
   - `payfastitn-qnadxzwqlq`
3. For each service:
   - Click **"Permissions"** tab
   - Click **"Grant Access"**
   - In "New principals", type: `allUsers`
   - In "Select a role", choose: **Cloud Run > Cloud Run Invoker**
   - Click **Save**

### Option 2: gcloud CLI (if installed)

```bash
# For each function, run:
gcloud run services add-iam-policy-binding sendemail-qnadxzwqlq \
  --region=us-central1 \
  --project=reality-fx-production-25796 \
  --member=allUsers \
  --role=roles/run.invoker

gcloud run services add-iam-policy-binding payfastinit-qnadxzwqlq \
  --region=us-central1 \
  --project=reality-fx-production-25796 \
  --member=allUsers \
  --role=roles/run.invoker

gcloud run services add-iam-policy-binding payfastitn-qnadxzwqlq \
  --region=us-central1 \
  --project=reality-fx-production-25796 \
  --member=allUsers \
  --role=roles/run.invoker
```

## After fixing, test:

```bash
curl -X POST "https://sendemail-qnadxzwqlq-uc.a.run.app" \
  -H "Content-Type: application/json" \
  -d '{"to":"realityfx20@gmail.com","subject":"Reality FX — Email Test","html":"<p style=\"color:#E5C158;font-family:Arial;\">Email delivery test from Reality FX.</p>"}'
```

Expected response: `{"ok":true,"id":"..."}`

## Why this happened

Firebase v2 Cloud Functions deploy to Cloud Run. By default, Cloud Run requires authentication. Firebase should auto-configure `allUsers` access during deploy, but sometimes the IAM policy doesn't apply to newly created services while existing services retain their permissions.

This only affects NEW functions — existing ones (openOs, verifyToken) work fine.
