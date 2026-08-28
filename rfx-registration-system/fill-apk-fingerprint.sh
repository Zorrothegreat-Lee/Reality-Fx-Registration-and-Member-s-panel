#!/usr/bin/env bash
# ============================================================
# Reality FX — fill the real SHA-256 into the APK delivery email
#
# The delivery letter must NEVER go out with the all-zeros
# placeholder. Run this on the machine that holds the real
# RFX-OS-Android.apk:
#
#     bash fill-apk-fingerprint.sh /path/to/RFX-OS-Android.apk
#
# It computes the SHA-256 of the actual APK and patches
# RFX-APK-DELIVERY-EMAIL-READY.html with the real fingerprint.
# The email is then ready to send.
# ============================================================
set -euo pipefail

APK="${1:-}"
EMAIL="RFX-APK-DELIVERY-EMAIL-READY.html"

if [ -z "$APK" ]; then
  echo "usage: bash fill-apk-fingerprint.sh /path/to/RFX-OS-Android.apk" >&2
  exit 1
fi
if [ ! -f "$APK" ]; then
  echo "error: no such file: $APK" >&2
  exit 1
fi
if [ ! -f "$EMAIL" ]; then
  echo "error: $EMAIL not found next to this script" >&2
  exit 1
fi

echo "computing SHA-256 of: $APK ..."
HASH=$(sha256sum "$APK" | awk '{print $1}')
if [ -z "$HASH" ] || [ ${#HASH} -ne 64 ]; then
  echo "error: could not compute a 64-char SHA-256 (got '${HASH}')" >&2
  exit 1
fi
echo "SHA-256: $HASH"

# replace the placeholder span (or any previous hash) with the real one
perl -0777 -i -pe "s{<span style=\"color:#c0392b;font-weight:700;\">[^<]*</span>}{$HASH}" "$EMAIL"
perl -0777 -i -pe "s/SHA-256: [0-9a-fA-F]{64}/SHA-256: $HASH/" "$EMAIL"

# sanity: confirm exactly one real hash is present now, and no placeholder survives
COUNT=$(grep -oE "SHA-256: [0-9a-fA-F]{64}" "$EMAIL" | wc -l)
LEFT=$(grep -c "REPLACE WITH REAL FINGERPRINT" "$EMAIL" || true)
if [ "$COUNT" -ne 1 ] || [ "$LEFT" -ne 0 ]; then
  echo "error: expected exactly one fingerprint line and no placeholder, found $COUNT hashes / $LEFT placeholders — email NOT safe to send" >&2
  exit 1
fi

echo
echo "done — $EMAIL is now ready to send."
echo "final fingerprint: $HASH"
