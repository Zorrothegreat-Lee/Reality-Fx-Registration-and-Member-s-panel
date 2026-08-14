use strict; use warnings;
use HTTP::Daemon;
use HTTP::Status;
my $root = $ENV{RFX_ROOT} || '.';
my $port = $ENV{RFX_PORT} || 8123;
my %mime = (html=>'text/html', js=>'text/javascript', css=>'text/css', svg=>'image/svg+xml', png=>'image/png', json=>'application/json', pdf=>'application/pdf', ico=>'image/x-icon', txt=>'text/plain', pl=>'text/plain');
my $d = HTTP::Daemon->new(LocalAddr => '127.0.0.1', LocalPort => $port, ReuseAddr => 1) or die "cannot bind: $!";
while (my $c = $d->accept) {
  while (my $r = $c->get_request) {
    my $path = $r->uri->path || '/';
    $path = '/index.html' if $path eq '/';
    (my $rel = $path) =~ s{^/+}{};
    $rel = 'index.html' if $rel eq '';
    my $file = "$root/$rel";
    if ($rel =~ /\.\./ || !-f $file) {
      $c->send_error(404, 'not found');
      next;
    }
    (my $ext = $file) =~ s/.*\.//;
    my $ct = $mime{$ext} || 'application/octet-stream';
    open my $fh, '<:raw', $file or do { $c->send_error(404); next; };
    local $/; my $data = <$fh>; close $fh;
    my $res = HTTP::Response->new(200, 'OK', [ 'Content-Type' => $ct, 'Content-Length' => length($data) ], $data);
    $c->send_response($res);
  }
  $c->close;
}
