#!/bin/bash
# Reality FX — Firebase Environment Setup
# Run this once to configure the signing keys

export PATH="/c/Program Files/nodejs:/c/Users/leero/AppData/Roaming/npm:$PATH"
cd "$(dirname "$0")"

echo "🔐 Setting up Firebase environment variables..."

# Read the keys
PRIVATE_KEY=$(cat private.pem)
PUBLIC_KEY=$(cat public.pem)
KEY_ID="rfx-key-$(date +%s)"

echo "Setting SIGNING_KEY..."
echo "$PRIVATE_KEY" | firebase functions:config:set signing.key="$(cat private.pem)"

echo "Setting PUBLIC_KEY..."
echo "$PUBLIC_KEY" | firebase functions:config:set publickey="$(cat public.pem)"

echo "Setting KEY_ID..."
firebase functions:config:set signing.keyid="$KEY_ID"

echo "Setting OS_ORIGIN..."
firebase functions:config:set os.origin="https://os.realityfx.com"

echo ""
echo "✅ Environment variables set!"
echo "Key ID: $KEY_ID"
echo ""
echo "Now deploy with: firebase deploy --only functions"
