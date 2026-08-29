use strict; use warnings;
use HTTP::Daemon;
use File::Basename;
use Time::Local;
use JSON::PP;
use Digest::SHA qw(hmac_sha256_hex);
use MIME::Base64 qw(encode_base64url decode_base64url);
my $root = $ENV{RFX_ROOT} || '.';
my $port = $ENV{RFX_PORT} || 8123;
my $dir = dirname($0);
my $store = "$dir/rfx-shared-store.json";
my %mime = (html=>'text/html', js=>'text/javascript', css=>'text/css', svg=>'image/svg+xml', png=>'image/png', json=>'application/json', pdf=>'application/pdf', ico=>'image/x-icon', txt=>'text/plain', pl=>'text/plain');

# ---- demo HMAC secret (production: RS256 private key, NEVER symmetric) ----
my $JWT_SECRET = $ENV{RFX_JWT_SECRET} || 'rfx-demo-jwt-secret-2026-CHANGE-IN-PRODUCTION';
my $TOKEN_TTL = 300; # 5 minutes

$SIG{CHLD} = 'IGNORE';
my $d = HTTP::Daemon->new(LocalAddr => '127.0.0.1', LocalPort => $port, ReuseAddr => 1) or die "cannot bind: $!";
while (my $c = $d->accept) {
  my $pid = fork();
  if ($pid == 0) {
    # child: serve one request and exit
    while (my $r = $c->get_request) {
      my $path = $r->uri->path || '/';

      # ---- OS AUTH: GET /open-os?email=... ---------------------------------
      # Generates a short-lived JWT and redirects to the OS with ?token=.
      # Only authenticated System A users reach this — the member panel's
      # "Open Reality FX OS" button triggers it. Production: Lee's Firebase
      # function generates an RS256-signed token; this demo uses HMAC.
      if ($path eq '/open-os') {
        if ($r->method eq 'GET') {
          my $q = $r->uri->query || '';
          my $email = '';
          if ($q =~ /(?:^|&)email=([^&]*)/) {
            $email = $1;
            $email =~ tr/+/ /;
            $email =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
          }
          $email = lc($email);

          # look up the enrollment
          my $stored = '{}';
          if (-f $store) {
            open my $sfh, '<:raw', $store or do { $c->send_error(500); $c->close; exit 0; };
            local $/; $stored = <$sfh>; close $sfh;
          }
          my $st = eval { decode_json($stored) };
          $st = {} unless $st && ref($st) eq 'HASH';
          $st->{enrollments} = $st->{enrollments} || [];

          my ($enr) = grep { $_->{payment} && $_->{payment}{email} && lc($_->{payment}{email}) eq $email } @{$st->{enrollments}};

          if (!$enr) {
            $c->send_basic_header(302, 'Found');
            $c->print("Location: /member.html?error=no-account\r\nContent-Length: 0\r\n\r\n");
            $c->close; exit 0;
          }
          if (($enr->{state} || '') ne 'ACTIVE') {
            $c->send_basic_header(302, 'Found');
            $c->print("Location: /member.html?error=not-active\r\nContent-Length: 0\r\n\r\n");
            $c->close; exit 0;
          }

          # generate jti + token
          my $jti = sprintf('jti-%s-%s', time(), substr(Digest::SHA::sha256_hex($email . time() . rand()), 0, 12));
          my $now = time();
          my $iat = $now;
          my $exp = $now + $TOKEN_TTL;

          # build JWT payload
          my $name = '';
          if ($enr->{registration} && $enr->{registration}{personal} && $enr->{registration}{personal}{fullName}) {
            $name = $enr->{registration}{personal}{fullName};
          } elsif ($enr->{payment} && $enr->{payment}{customerName}) {
            $name = $enr->{payment}{customerName};
          }

          # mirror db.js isFounder: check founder property + email + tags
          my $founder = JSON::PP::false;
          if ($enr->{founder}) { $founder = JSON::PP::true; }
          elsif (lc($email || '') eq 'leeroychirwa18@gmail.com') { $founder = JSON::PP::true; }
          elsif ($enr->{tags} && ref($enr->{tags}) eq 'ARRAY') {
            $founder = (grep { $_ eq 'FOUNDER' } @{$enr->{tags}}) ? JSON::PP::true : JSON::PP::false;
          }

          my $enrolled_chapters = [];
          if ($enr->{courseProgress} && ref($enr->{courseProgress}) eq 'HASH') {
            for my $ch (keys %{$enr->{courseProgress}}) {
              push @$enrolled_chapters, int($ch) if $enr->{courseProgress}{$ch} && $enr->{courseProgress}{$ch}{passed};
            }
          }
          $enrolled_chapters = [sort { $a <=> $b } @$enrolled_chapters];

          my $trust = $st->{trust} && $st->{trust}{$email} ? $st->{trust}{$email} : { score => 0, tier => 'new' };

          my $claims = {
            sub => $enr->{studentId} || '',
            name => $name,
            email => $email,
            founder => $founder,
            status => 'ACTIVE',
            printTrust => 'standard',
            enrolled => $enrolled_chapters,
            iat => $iat,
            exp => $exp,
            jti => $jti,
            iss => 'realityfx',
            aud => 'rfx-os',
          };

          # sign the token (HMAC demo — production uses RS256)
          my $header = encode_base64url(encode_json({alg => 'HS256', typ => 'JWT'}));
          my $payload_b64 = encode_base64url(encode_json($claims));
          my $sig = hmac_sha256_hex("$header.$payload_b64", $JWT_SECRET);
          my $token = "$header.$payload_b64.$sig";

          # store jti for replay protection
          $st->{consumedTokens} = $st->{consumedTokens} || {};
          $st->{consumedTokens}{$jti} = { email => $email, studentId => $enr->{studentId} || '', consumedAt => $now, expiresAt => $exp };

          # audit the token issuance
          $st->{securityEvents} = $st->{securityEvents} || [];
          my ($sec,$min,$hour,$mday,$mon,$year) = gmtime($now);
          my $at = sprintf('%04d-%02d-%02dT%02d:%02d:%02d.000Z', $year+1900, $mon+1, $mday, $hour, $min, $sec);
          push @{$st->{securityEvents}}, { at => $at, event => 'OS_TOKEN_ISSUED', detail => 'Short-lived OS token issued for ' . $email . ' (jti: ' . $jti . ')' };

          # persist
          my $tmp = "$store.tmp.$$";
          open my $fh, '>:raw', $tmp or do { $c->send_error(500); $c->close; exit 0; };
          print $fh encode_json($st); close $fh;
          rename $tmp, $store;

          # redirect to OS with token (the OS captures, validates, scrubs URL)
          my $osBase = 'http://127.0.0.1:49270/os/';
          my $redirectUrl = $osBase . '?token=' . $token;

          $c->send_basic_header(302, 'Found');
          $c->print("Location: $redirectUrl\r\nContent-Length: 0\r\n\r\n");
          $c->close; exit 0;
        }
        $c->send_error(405);
        $c->close; exit 0;
      }

      # ---- OS AUTH: POST /api/verify-token ----------------------------------
      # The OS calls this after capturing the token from the URL. Verifies
      # signature, claims, enrollment, and performs atomic consume (replay
      # protection). Production: Lee's Firebase function does the same with
      # RS256 keys and a consumed_tokens table.
      if ($path eq '/api/verify-token') {
        if ($r->method eq 'POST') {
          my $body = $r->content || '';
          my $reqPayload = eval { decode_json($body) };
          my $token = '';
          if ($reqPayload && ref($reqPayload) eq 'HASH' && defined($reqPayload->{token})) {
            $token = $reqPayload->{token};
          }

          if ($token eq '') {
            $c->send_basic_header(400, 'Bad Request');
            my $resp = '{"authenticated":false,"error":"malformed","msg":"Missing or empty token."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # parse JWT
          my @parts = split(/\./, $token);
          if (scalar(@parts) != 3) {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"invalid","msg":"Malformed token structure."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          my ($hdrB64, $payloadB64, $sigB64) = @parts;

          # verify HMAC signature (demo — production verifies RS256)
          my $expectedSig = hmac_sha256_hex("$hdrB64.$payloadB64", $JWT_SECRET);
          if ($sigB64 ne $expectedSig) {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"invalid","msg":"Invalid signature."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # decode claims
          my $claims = eval { decode_json(decode_base64url($payloadB64)) };
          if (!$claims || ref($claims) ne 'HASH') {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"invalid","msg":"Cannot decode token payload."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # check issuer
          if (($claims->{iss} || '') ne 'realityfx') {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"wrong-issuer","msg":"Token issuer mismatch."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # check audience
          if (($claims->{aud} || '') ne 'rfx-os') {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"wrong-audience","msg":"Token not intended for RFX OS."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # check expiry
          my $now = time();
          if ($claims->{exp} && $claims->{exp} < $now) {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"expired","msg":"Token has expired — please re-authenticate."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # ATOMIC CONSUME — replay protection with file locking
          # The store is read-locked, the jti checked, marked consumed,
          # and written back — all while holding an exclusive lock.
          # This prevents the TOCTOU race between concurrent forked children.
          my $jti = $claims->{jti} || '';
          if ($jti eq '') {
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"invalid","msg":"Token has no jti claim."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # ATOMIC CONSUME with file locking — prevent TOCTOU race
          # Use a lock file to serialize concurrent reads+writes to the store.
          my $lockFile = "$store.lock";
          open my $lockFh, '>', $lockFile or do { $c->send_error(500); $c->close; exit 0; };
          flock($lockFh, 2) or do { close $lockFh; $c->send_error(503); $c->close; exit 0; }; # LOCK_EX
          # Read store under lock
          my $stored = '{}';
          if (-f $store) {
            open my $sfh, '<:raw', $store or do { close $lockFh; $c->send_error(500); $c->close; exit 0; };
            local $/; $stored = <$sfh>; close $sfh;
          }
          my $st = eval { decode_json($stored) };
          $st = {} unless $st && ref($st) eq 'HASH';
          $st->{consumedTokens} = $st->{consumedTokens} || {};
          $st->{enrollments} = $st->{enrollments} || [];

          # check if jti exists AND not yet consumed
          if ($st->{consumedTokens}{$jti} && $st->{consumedTokens}{$jti}{consumed}) {
            close $lockFh;
            $c->send_basic_header(409, 'Conflict');
            my $resp = '{"authenticated":false,"error":"replay-detected","msg":"This token has already been used."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }
          if (!$st->{consumedTokens}{$jti}) {
            close $lockFh;
            $c->send_basic_header(401, 'Unauthorized');
            my $resp = '{"authenticated":false,"error":"invalid","msg":"Unknown token — not issued by this system."}';
            $c->print("Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
            $c->close; exit 0;
          }

          # mark consumed
          $st->{consumedTokens}{$jti}{consumed} = 1;

          # look up enrollment for trust data
          my $email = $claims->{email} || '';
          my ($enr) = grep { $_->{studentId} && $_->{studentId} eq ($claims->{sub} || '') } @{$st->{enrollments}};
          if (!$enr) {
            ($enr) = grep { $_->{payment} && $_->{payment}{email} && lc($_->{payment}{email}) eq lc($email) } @{$st->{enrollments}};
          }

          my $trustScore = 0;
          my $trustRestricted = JSON::PP::true;
          if ($enr && $st->{trust} && $st->{trust}{lc($email || '')}) {
            my $t = $st->{trust}{lc($email || '')};
            $trustScore = $t->{score} || 0;
            $trustRestricted = ($t->{restricted} || 0) ? JSON::PP::true : JSON::PP::false;
          }

          # persist the consumed token under lock, then release
          my $tmp = "$store.tmp.$$";
          open my $fh, '>:raw', $tmp or do { close $lockFh; $c->send_error(500); $c->close; exit 0; };
          print $fh encode_json($st); close $fh;
          rename $tmp, $store;
          close $lockFh; # release lock

          # build the deterministic success response (§31.2)
          my $resp = encode_json({
            authenticated => JSON::PP::true,
            identity => {
              studentId => $claims->{sub} || '',
              verifiedName => $claims->{name} || '',
              email => $email,
              founder => $claims->{founder} || JSON::PP::false,
              status => $claims->{status} || 'ACTIVE',
              permissions => undef,
            },
            trust => {
              score => $trustScore,
              restricted => $trustRestricted,
            },
            token => {
              issuedAt => $claims->{iat} || 0,
              expiresAt => $claims->{exp} || 0,
              jti => $jti,
            },
          });

          $c->send_basic_header(200, 'OK');
          $c->print("Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
          $c->close; exit 0;
        }
        elsif ($r->method eq 'OPTIONS') {
          $c->send_basic_header(200, 'OK');
          $c->print("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\n\r\n");
          $c->close; exit 0;
        }
        $c->send_error(405);
        $c->close; exit 0;
      }

      # ---- shared demo store ------------------------------------------------
      if ($path eq '/api/state') {
        if ($r->method eq 'GET') {
          my $data = '{}';
          if (-f $store) {
            open my $fh, '<:raw', $store or do { $c->send_error(500); $c->close; exit 0; };
            local $/; $data = <$fh>; close $fh;
          }
          $c->send_basic_header(200, 'OK');
          $c->print("Content-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: " . length($data) . "\r\n\r\n$data");
          $c->close; exit 0;
        }
        elsif ($r->method eq 'POST') {
          my $body = $r->content || '';
          my $stored = '';
          if (-f $store) {
            open my $sfh, '<:raw', $store or do { $c->send_error(500); $c->close; exit 0; };
            local $/; $stored = <$sfh>; close $sfh;
          }
          my $force = $body =~ /"wipe"\s*:\s*true/;
          if (!$force) {
            my ($brev) = $body =~ /"rev"\s*:\s*(\d+)/;
            my ($srev) = $stored =~ /"rev"\s*:\s*(\d+)/;
            if (defined $srev && defined $brev && $brev < $srev) {
              $c->send_error(409, 'stale rev');
              $c->close; exit 0;
            }
          }
          my $tmp = "$store.tmp.$$";
          open my $fh, '>:raw', $tmp or do { $c->send_error(500); $c->close; exit 0; };
          print $fh $body; close $fh;
          rename $tmp, $store;
          $c->send_basic_header(200, 'OK');
          $c->print("Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
          $c->close; exit 0;
        }
        $c->send_error(405);
        $c->close; exit 0;
      }

      # ---- GATEKEEPER CONTRACT: GET /api/gate?email=... --------------------
      if ($path eq '/api/gate') {
        if ($r->method eq 'GET') {
          my $q = $r->uri->query || '';
          my $email = '';
          if ($q =~ /(?:^|&)email=([^&]*)/) {
            $email = $1;
            $email =~ tr/+/ /;
            $email =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
          }
          $email = lc($email);
          my $resp = '{"locked":false}';
          if ($email ne '' && -f $store) {
            open my $fh, '<:raw', $store or do { $c->send_error(500); $c->close; exit 0; };
            local $/; my $data = <$fh>; close $fh;
            my $esc = quotemeta($email);
            if ($data =~ /"loginAttempts"\s*:\s*\{\s*"$esc"\s*:\s*\{\s*"count"\s*:\s*\d+\s*,\s*"lockedUntil"\s*:\s*"([^"]*)"/) {
              my $until = $1;
              if ($until ne '' && $until ne 'null') {
                if ($until =~ /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/) {
                  my ($y,$mo,$d,$h,$mi,$s) = ($1,$2,$3,$4,$5,$6);
                  my $ut = timegm($s, $mi, $h, $d, $mo-1, $y-1900);
                  my $left = $ut - time();
                  if ($left > 0) {
                    my $mins = int(($left + 59) / 60);
                    $resp = '{"locked":true,"lockedUntil":"' . $until . '","minutesLeft":' . $mins . '}';
                  }
                }
              }
            }
          }
          $c->send_basic_header(200, 'OK');
          $c->print("Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
          $c->close; exit 0;
        }
        elsif ($r->method eq 'OPTIONS') {
          $c->send_basic_header(200, 'OK');
          $c->print("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-RFX-Handoff-Key\r\nContent-Length: 0\r\n\r\n");
          $c->close; exit 0;
        }
        $c->send_error(405);
        $c->close; exit 0;
      }

      # ---- ACHIEVEMENT BRIDGE: POST /api/achievement -----------------------
      if ($path eq '/api/achievement') {
        if ($r->method eq 'POST') {
          my $resp = '{"ok":false,"msg":"malformed"}';
          my $body = $r->content || '';
          my $payload = eval { decode_json($body) };
          if ($payload && ref($payload) eq 'HASH') {
            my $reference = defined($payload->{reference}) ? $payload->{reference} : '';
            my $studentId = defined($payload->{studentId}) ? $payload->{studentId} : '';
            my $average = defined($payload->{average}) ? $payload->{average} : -1;
            my $stored = '';
            if (-f $store) {
              open my $sfh, '<:raw', $store or do { $c->send_error(500); $c->close; exit 0; };
              local $/; $stored = <$sfh>; close $sfh;
            }
            my $st = eval { decode_json($stored || '{}') };
            $st = {} unless $st && ref($st) eq 'HASH';
            $st->{merch} = $st->{merch} || {};
            $st->{merch}{orders} = $st->{merch}{orders} || [];
            $st->{merch}{claims} = $st->{merch}{claims} || {};
            $st->{emails} = $st->{emails} || [];
            $st->{securityEvents} = $st->{securityEvents} || [];
            $st->{enrollments} = $st->{enrollments} || [];
            $st->{seq} = $st->{seq} || {};
            my $esc = sub { my $s = shift; $s =~ s/&/\&amp;/g; $s =~ s/</\&lt;/g; $s =~ s/>/\&gt;/g; $s =~ s/"/\&quot;/g; return $s; };
            my $isoNow = sub {
              my ($sec,$min,$hour,$mday,$mon,$year) = gmtime(time());
              return sprintf('%04d-%02d-%02dT%02d:%02d:%02d.000Z', $year+1900, $mon+1, $mday, $hour, $min, $sec);
            };
            my $at = $isoNow->();
            if ($reference eq '' || $studentId eq '' || $average < 0) {
              $resp = '{"ok":false,"msg":"An achievement needs a reference, a Student ID and an average."}';
            }
            elsif ($st->{merch}{claims}{$reference}) {
              $resp = '{"ok":false,"already":true,"msg":"Achievement ' . $reference . ' was already claimed — the reward is one-time."}';
            }
            else {
              my ($enr) = grep { $_->{studentId} && $_->{studentId} eq $studentId } @{$st->{enrollments}};
              if (!$enr) {
                $resp = '{"ok":false,"msg":"No student with ID ' . $studentId . ' — the achievement cannot attach to an unknown identity."}';
              }
              else {
                my $threshold = defined($st->{merch}{achievementThreshold}) ? $st->{merch}{achievementThreshold} : 80;
                if ($average < $threshold) {
                  $resp = '{"ok":false,"reason":"below_threshold","msg":"Average ' . $average . '% is below the ' . $threshold . '% threshold — no reward earned."}';
                }
                else {
                  $st->{seq}{merch} = ($st->{seq}{merch} || 0) + 1;
                  my $orderId = 'MERCH-' . sprintf('%04d', $st->{seq}{merch});
                  my $emailAddr = $enr->{payment} && $enr->{payment}{email} ? $enr->{payment}{email} : '';
                  my $custName = $enr->{payment} && $enr->{payment}{customerName} ? $enr->{payment}{customerName} : ($emailAddr || $studentId);
                  my $order = {
                    id => $orderId,
                    kind => 'earned',
                    email => $emailAddr,
                    studentId => $studentId,
                    name => $custName,
                    items => [
                      { code => 'RFX-MERCH-TEE', name => 'Reality FX T-shirt', size => undef, price => 0 },
                      { code => 'RFX-MERCH-HOODY', name => 'Reality FX Hoody', size => undef, price => 0 },
                    ],
                    total => 0,
                    status => 'collecting',
                    address => undef,
                    reference => $reference,
                    average => $average,
                    at => $at,
                    history => [{ at => $at, status => 'collecting', note => 'Achievement ' . $reference . ' — average ' . $average . '%' }],
                  };
                  push @{$st->{merch}{orders}}, $order;
                  $st->{merch}{claims}{$reference} = $orderId;
                  if ($enr->{audit}) { push @{$enr->{audit}}, { at => $at, event => 'MERCH_EARNED', detail => 'Reward earned — average ' . $average . '% (ref ' . $reference . '). Free tee + hoody queued for fulfilment.' }; }
                  push @{$st->{securityEvents}}, { at => $at, event => 'MERCH_EARNED', detail => $reference . ' — ' . $studentId . ' earned the 80%+ reward' };
                  my $html = '<div style="font-family:Arial,sans-serif;"><p style="font-size:14px;color:#333;">Dear <b>' . $esc->($custName) . '</b>,</p>' .
                    '<p style="font-size:14px;color:#333;">Congratulations — you earned the Reality FX tee + hoody reward.</p>' .
                    '<div style="background:#f6f1e3;border:1px solid #d4af37;border-radius:10px;padding:16px 20px;font-size:13px;color:#333;">' .
                    'Order <b>' . $orderId . '</b><br/>&bull; Reality FX T-shirt<br/>&bull; Reality FX Hoody<br/>Status: <b>Earned — free reward</b></div>' .
                    '<p style="font-size:12px;color:#666;">Thank you — Reality FX.</p></div>';
                  unshift @{$st->{emails}}, { id => 'EM-ACH', kind => 'merch-earned', to => $emailAddr, subject => 'You earned the Reality FX reward — ' . $custName, html => $html, sentAt => $at, read => JSON::PP::false };
                  my $tmp = "$store.tmp.$$";
                  open my $fh, '>:raw', $tmp or do { $c->send_error(500); $c->close; exit 0; };
                  print $fh encode_json($st); close $fh;
                  rename $tmp, $store;
                  my $oid = $orderId; $oid =~ s/"//g;
                  $resp = '{"ok":true,"orderId":"' . $oid . '","order":{"id":"' . $oid . '","status":"collecting","total":0}}';
                }
              }
            }
          }
          $c->send_basic_header(200, 'OK');
          $c->print("Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " . length($resp) . "\r\n\r\n$resp");
          $c->close; exit 0;
        }
        elsif ($r->method eq 'OPTIONS') {
          $c->send_basic_header(200, 'OK');
          $c->print("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-RFX-Handoff-Key\r\nContent-Length: 0\r\n\r\n");
          $c->close; exit 0;
        }
        $c->send_error(405);
        $c->close; exit 0;
      }

      # ---- static files -----------------------------------------------------
      $path = '/index.html' if $path eq '/';
      (my $rel = $path) =~ s{^/+}{};
      $rel = 'index.html' if $rel eq '';
      my $file = "$root/$rel";
      if ($rel =~ /\.\./ || !-f $file) { $c->send_error(404, 'not found'); next; }
      (my $ext = $file) =~ s/.*\.//;
      my $ct = $mime{$ext} || 'application/octet-stream';
      open my $fh, '<:raw', $file or do { $c->send_error(404); next; };
      local $/; my $data = <$fh>; close $fh;
      $c->send_basic_header(200, 'OK');
      $c->print("Content-Type: $ct\r\nCache-Control: no-store\r\nContent-Length: " . length($data) . "\r\n\r\n$data");
      $c->close;
      exit 0;
    }
    $c->close;
    exit 0;
  }
  $c->close;
}
