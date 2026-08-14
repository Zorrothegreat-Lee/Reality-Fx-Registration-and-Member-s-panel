use strict; use warnings;
use HTTP::Daemon;
use File::Basename;
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
