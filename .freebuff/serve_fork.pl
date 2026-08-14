use strict; use warnings;
use HTTP::Daemon;
use File::Basename;
use Time::Local;
my $root = $ENV{RFX_ROOT} || '.';
my $port = $ENV{RFX_PORT} || 8123;
my $dir = dirname($0);
my $store = "$dir/rfx-shared-store.json";
my %mime = (html=>'text/html', js=>'text/javascript', css=>'text/css', svg=>'image/svg+xml', png=>'image/png', json=>'application/json', pdf=>'application/pdf', ico=>'image/x-icon', txt=>'text/plain', pl=>'text/plain');
$SIG{CHLD} = 'IGNORE';
my $d = HTTP::Daemon->new(LocalAddr => '127.0.0.1', LocalPort => $port, ReuseAddr => 1) or die "cannot bind: $!";
while (my $c = $d->accept) {
  my $pid = fork();
  if ($pid == 0) {
    # child: serve one request and exit
    while (my $r = $c->get_request) {
      my $path = $r->uri->path || '/';

      # ---- shared demo store ------------------------------------------------
      # The whole demo runs in the browser; without this, data lives only in
      # the localStorage of the browser that created it and a registration
      # link opened from ANY OTHER browser says "not recognised". This tiny
      # endpoint keeps the state in ONE JSON file on the machine, so the demo
      # works in every browser that can reach this server (localhost only).
      # Production replaces this with Lee's Firebase entirely.
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
          # rev guard: never let a stale browser clobber a newer one.
          # EXCEPTION: the demo's wipe() sends "wipe":true — a reset must
          # always win, even against a stale high-rev state on the server.
          my $force = $body =~ /"wipe"\s*:\s*true/;
          if (!$force) {
            my ($brev) = $body =~ /"rev"\s*:\s*(\d+)/;
            my ($srev) = $stored =~ /"rev"\s*:\s*(\d+)/;
            if (defined $srev && defined $brev && $brev < $srev) {
              $c->send_error(409, 'stale rev');
              $c->close; exit 0;
            }
          }
          my $tmp = "$store.tmp.$$";  # unique per forked child — concurrent writes can't collide
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

      # ---- GATEKEEPER CONTRACT: GET /api/gate?email=… ------------------------
      # System A holds ALL the power of who gets in. The OS (System B) never
      # decides — it only follows. When the OS asks "can this identity come
      # in?", THIS endpoint answers, from the SAME throttle record the sign-in
      # screen enforces. Production: this exact response shape is what Lee's
      # OS Cloud Function calls before issuing any session.
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
            # locate THIS email's record inside loginAttempts — the key is
            # JSON-quoted, so match the quoted address directly. The record
            # shape is { "count":N, "lockedUntil":"ISO|null" }.
            my $esc = quotemeta($email);
            if ($data =~ /"loginAttempts"\s*:\s*\{\s*"$esc"\s*:\s*\{\s*"count"\s*:\s*\d+\s*,\s*"lockedUntil"\s*:\s*"([^"]*)"/) {
              my $until = $1;
              if ($until ne '' && $until ne 'null') {
                # parse ISO 8601 "YYYY-MM-DDTHH:MM:SS(.sss)Z"
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
          # CORS preflight — the OS (a different origin) must be able to call
          # the gate. Allow any origin + the header the OS sends.
          $c->send_basic_header(200, 'OK');
          $c->print("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-RFX-Handoff-Key\r\nContent-Length: 0\r\n\r\n");
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
