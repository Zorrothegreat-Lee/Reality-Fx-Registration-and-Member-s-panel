#!/usr/bin/env perl
# ============================================================
# Reality FX — tiny static server (zero dependencies)
# Usage:  perl serve.pl [port]        (serves this folder)
# Then open http://localhost:8090
# Works with the perl that ships inside Git for Windows.
# ============================================================
use strict;
use warnings;
use IO::Socket::INET;
use Cwd qw(getcwd abs_path);

my $root = abs_path('.');
my $port = shift(@ARGV) || 8090;

my %mime = (
  '.html'  => 'text/html; charset=utf-8',
  '.htm'   => 'text/html; charset=utf-8',
  '.css'   => 'text/css; charset=utf-8',
  '.js'    => 'application/javascript; charset=utf-8',
  '.json'  => 'application/json',
  '.svg'   => 'image/svg+xml',
  '.png'   => 'image/png',
  '.jpg'   => 'image/jpeg',
  '.jpeg'  => 'image/jpeg',
  '.gif'   => 'image/gif',
  '.ico'   => 'image/x-icon',
  '.txt'   => 'text/plain; charset=utf-8',
  '.woff2' => 'font/woff2',
  '.woff'  => 'font/woff',
  '.md'    => 'text/plain; charset=utf-8',
);

my $sock = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp',
  Listen => 16, ReuseAddr => 1,
) or die "Cannot bind port $port: $!\n";

print "Reality FX serving $root\n";
print "Open  http://localhost:$port\n";
print "Press Ctrl+C to stop.\n";

while (my $c = $sock->accept()) {
  $c->autoflush(1);
  my $req = <$c>;
  my ($method, $path) = split(/\s+/, $req || '');
  while (<$c>) { last if /^\r?$/; }   # drain headers

  # an empty request line (a bare probe / keep-alive ping) must never kill the
  # server — close the socket and keep serving the next connection.
  if (!defined $path || $path eq '') {
    close $c; next;
  }

  if (($method || 'GET') ne 'GET') {
    respond($c, '405 Method Not Allowed', 'text/plain', '');
    close $c; next;
  }
  $path =~ s/\?.*//;
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  $path = '/' . $path unless $path =~ m{^/};
  $path =~ s{/+}{/}g;

  my $file = $root . $path;
  $file = "$root/index.html" if $file =~ m{/$};
  $file = "$file/index.html" if -d $file;

  # path traversal guard
  my $rel = $file;
  $rel =~ s{^\Q$root\E/?}{};
  if ($rel =~ m{(^|/)(\.\.)(/|$)} || $file !~ m{^\Q$root\E}) {
    respond($c, '403 Forbidden', 'text/plain', 'forbidden');
    close $c; next;
  }

  if (-f $file) {
    open(my $fh, '<:raw', $file) or do {
      respond($c, '500 Server Error', 'text/plain', '');
      close $c; next;
    };
    my $data = do { local $/; <$fh> };
    close $fh;
    my ($ext) = $file =~ /(\.[^.]+)$/;
    my $ct = $mime{lc($ext || '')} || 'application/octet-stream';
    respond($c, '200 OK', $ct, $data);
  } else {
    respond($c, '404 Not Found', 'text/plain', 'not found');
  }
  close $c;
}

sub respond {
  my ($c, $status, $ct, $body) = @_;
  print $c "HTTP/1.1 $status\r\nContent-Type: $ct\r\n" .
    "Content-Length: " . length($body) . "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
  print $c $body;
}
