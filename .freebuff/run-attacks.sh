#!/bin/bash
BASE="http://127.0.0.1:8125"
PASS=0; FAIL=0; TOTAL=0

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       RFX OS — AUTH ATTACK HARNESS · BOUNDARY PROOF        ║"
echo "║       Every attack runs against live System A endpoints     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

check() {
  local id="$1" result="$2" detail="$3" verdict="$4"
  TOTAL=$((TOTAL+1))
  if [ "$result" = "PASS" ]; then
    echo "  ✅ BLOCKED — $verdict"
    echo "  Detail: $detail"
    PASS=$((PASS+1))
  else
    echo "  ❌ BREACH — $verdict"
    echo "  Detail: $detail"
    FAIL=$((FAIL+1))
  fi
  echo ""
}

PJ() { perl -MJSON::PP -e 'my $d=eval{decode_json(<STDIN>)}; print $d ? ($d->{"'"$1"'"} // shift // "none") : "parse-error"' 2>/dev/null; }
PJID() { perl -MJSON::PP -e 'my $d=eval{decode_json(<STDIN>)}; print $d && $d->{identity} ? ($d->{identity}->{"'"$1"'"} // "none") : "no-identity"' 2>/dev/null; }

# ── A: Direct access without token ──
echo "━━━ ATTACK A: Direct OS access — no token ━━━"
R=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d '{}')
check "A" "$(echo "$R" | PJ authenticated false)" \
  "authenticated=$(echo "$R" | PJ authenticated false) error=$(echo "$R" | PJ error none)" \
  "System A refuses to authenticate without a token"

# ── B: Manufacture a JWT ──
echo "━━━ ATTACK B: Manufacture a JWT from scratch ━━━"
HDR=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
PLD=$(printf '{"sub":"RFX-99999","name":"Hacker","email":"hacker@evil.com","founder":true,"status":"ACTIVE","iss":"realityfx","aud":"rfx-os","iat":1787190000,"exp":1787193600,"jti":"forged-x"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
FAKE="${HDR}.${PLD}.fakesig123456789012345678901234567890"
R=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$FAKE\"}")
check "B" "$([ \"$(echo "$R" | PJ authenticated false)\" = "false" ] && echo PASS || echo FAIL)" \
  "error=$(echo "$R" | PJ error none)" \
  "Forged signature rejected"

# ── C: Modify claims in valid JWT ──
echo "━━━ ATTACK C: Modify claims in a valid JWT ━━━"
RT=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=leeroychirwa18@gmail.com" | sed 's/.*token=//')
OH=$(echo "$RT" | cut -d. -f1)
OP=$(echo "$RT" | cut -d. -f2)
OS=$(echo "$RT" | cut -d. -f3)
NP=$(echo "$OP" | base64 -d 2>/dev/null | perl -MJSON::PP -e 'my $d=decode_json(<STDIN>); $d->{email}="hacker@evil.com"; $d->{founder}=1; $d->{sub}="RFX-99999"; print encode_json($d)' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
TAMPERED="${OH}.${NP}.${OS}"
R=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$TAMPERED\"}")
check "C" "$([ \"$(echo "$R" | PJ authenticated false)\" = "false" ] && echo PASS || echo FAIL)" \
  "error=$(echo "$R" | PJ error none)" \
  "Tampered claims break the signature"

# ── D: Replay ──
echo "━━━ ATTACK D: Replay a consumed JWT ━━━"
FT=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=leeroychirwa18@gmail.com" | sed 's/.*token=//')
F1=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$FT\"}" | PJ authenticated false)
F2=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$FT\"}" | PJ error none)
check "D" "$([ \"$F1\" = "true" ] && [ \"$F2\" = "replay-detected" ] && echo PASS || echo FAIL)" \
  "First: auth=$F1 · Replay: error=$F2" \
  "Token consumed on first use, replay rejected"

# ── E: Cross-account ──
echo "━━━ ATTACK E: Cross-account token misuse ━━━"
TA=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=leeroychirwa18@gmail.com" | sed 's/.*token=//')
TB=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=sipho.ngubane@gmail.com" | sed 's/.*token=//')
IDA=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$TA\"}" | PJID studentId none)
IDB=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$TB\"}" | PJID studentId none)
check "E" "$([ \"$IDA\" != \"$IDB\" ] && [ \"$IDA\" != "none" ] && [ \"$IDB\" != "none" ] && echo PASS || echo FAIL)" \
  "Token A → $IDA · Token B → $IDB" \
  "Each token resolves to its own identity"

# ── F: Client-side claim modification ──
echo "━━━ ATTACK F: Client-side claim modification ━━━"
TF=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=leeroychirwa18@gmail.com" | sed 's/.*token=//')
V1F=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$TF\"}" | PJID founder false)
V2F=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$TF\",\"founder\":true,\"trust\":{\"score\":100}}" | PJID founder false)
check "F" "$([ \"$V1F\" = \"$V2F\" ] && echo PASS || echo FAIL)" \
  "Normal: founder=$V1F · With forged extras: founder=$V2F" \
  "Client-supplied overrides ignored — server response is deterministic"

# ── G: Stolen localStorage data ──
echo "━━━ ATTACK G: Stolen localStorage data ━━━"
SH=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
SP=$(printf '{"sub":"RFX-10482","name":"Leeroy Chirwa","founder":true,"status":"ACTIVE","iss":"realityfx","aud":"rfx-os","iat":1787190000,"exp":1787193600,"jti":"stolen-x"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
ST="${SH}.${SP}.badsig"
R=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$ST\"}")
check "G" "$([ \"$(echo "$R" | PJ authenticated false)\" = "false" ] && echo PASS || echo FAIL)" \
  "error=$(echo "$R" | PJ error none)" \
  "Stolen data rejected — cannot authenticate without valid signature"

# ── H: Expired token ──
echo "━━━ ATTACK H: Expired token ━━━"
EH=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
EP=$(printf '{"sub":"RFX-10482","name":"Leeroy Chirwa","email":"leeroychirwa18@gmail.com","founder":false,"status":"ACTIVE","iss":"realityfx","aud":"rfx-os","iat":1787180000,"exp":1787180300,"jti":"expired-x"}' | base64 -w0 2>/dev/null | tr '+/' '-_' | tr -d '=')
ET="${EH}.${EP}.anysig"
R=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$ET\"}")
check "H" "$([ \"$(echo "$R" | PJ authenticated false)\" = "false" ] && echo PASS || echo FAIL)" \
  "error=$(echo "$R" | PJ error none)" \
  "Expired token rejected"

# ── I: Non-existent student ──
echo "━━━ ATTACK I: Non-existent student ━━━"
REDIR=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=ghost@nowhere.com")
check "I" "$(echo "$REDIR" | grep -q 'error=no-account' && echo PASS || echo FAIL)" \
  "Redirect: $REDIR" \
  "No token generated for non-existent student"

# ── J: Inactive student ──
echo "━━━ ATTACK J: Inactive student ━━━"
REDIR=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=davidchirwa20@gmail.com")
check "J" "$(echo "$REDIR" | grep -q 'error=not-active' && echo PASS || echo FAIL)" \
  "Redirect: $REDIR" \
  "Pending student cannot get a token"

# ── K: Race condition ──
echo "━━━ ATTACK K: Concurrent replay (race condition) ━━━"
RT=$(curl -s -m 5 -o /dev/null -w "%{redirect_url}" "$BASE/open-os?email=zanele.dube@gmail.com" | sed 's/.*token=//')
curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$RT\"}" > /tmp/race-a.json 2>&1 &
PIDA=$!
curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d "{\"token\":\"$RT\"}" > /tmp/race-b.json 2>&1 &
PIDB=$!
wait $PIDA $PIDB 2>/dev/null
RA=$(cat /tmp/race-a.json 2>/dev/null | PJ authenticated false)
RB=$(cat /tmp/race-b.json 2>/dev/null | PJ authenticated false)
EA=$(cat /tmp/race-a.json 2>/dev/null | PJ error none)
EB=$(cat /tmp/race-b.json 2>/dev/null | PJ error none)
check "K" "$([ \"$RA\" != \"$RB\" ] && echo PASS || echo FAIL)" \
  "Request A: auth=$RA err=$EA · Request B: auth=$RB err=$EB" \
  "$([ \"$RA\" != \"$RB\" ] && echo 'Atomic consume holds — exactly one succeeded' || echo 'Race condition exploited')"

# ── L: Frozen Invariants ──
echo "━━━ ATTACK L: Seven Frozen Invariants ━━━"
I1=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d '{"token":"fake.token.value"}' | PJ authenticated false)
I3=$(curl -s -m 5 -X POST $BASE/api/verify-token -H "Content-Type: application/json" -d '{"token":"fake","founder":true}' | PJ authenticated false)
echo "  Invariant 1 (AUTH only through verification): $([ \"$I1\" = "false" ] && echo 'HOLD' || echo 'BROKEN')"
echo "  Invariant 3 (client fields ignored): $([ \"$I3\" = "false" ] && echo 'HOLD' || echo 'BROKEN')"
check "L" "$([ \"$I1\" = "false" ] && [ \"$I3\" = "false" ] && echo PASS || echo FAIL)" \
  "Invariant 1: $I1 · Invariant 3: $I3" \
  "Structural invariants hold"

# ══════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    ATTACK HARNESS RESULTS                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Total attacks: %-3d                                        ║\n" $TOTAL
printf "║  Blocked:       %-3d                                        ║\n" $PASS
printf "║  Breached:      %-3d                                        ║\n" $FAIL
echo "║                                                            ║"
if [ "$FAIL" -eq 0 ]; then
echo "║  ✅ ALL ATTACKS BLOCKED — THE BOUNDARY HOLDS              ║"
echo "║  System A is the only authentication authority.            ║"
echo "║  No forged, tampered, replayed, or cross-account token     ║"
echo "║  was accepted. The Fort is secure.                         ║"
else
echo "║  ❌ $FAIL BREACH DETECTED — INVESTIGATION REQUIRED         ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
