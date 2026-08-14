use strict; use warnings;
use HTTP::Server::Simple::CGI;
my $root = $ENV{RFX_ROOT} || '.';
my $port = $ENV{RFX_PORT} || 8123;
my $srv = HTTP::Server::Simple::CGI->new($port);
$srv->run(sub {
  my ($cgi) = @_;
  my $path = $cgi->path_info || '/';
  $path = '/index.html' if $path eq '/';
  (my $rel = $path) =~ s{^/+}{};
  $rel =~ s/\?.*$//;
  $rel = 'index.html' if $rel eq '';
  my $file = "$root/$rel";
  if ($rel =~ /\.\./ || !-f $file) {
    print "HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\n\r\nnot found";
    return;
  }
  my %mime = (html=>'text/html', js=>'text/javascript', css=>'text/css', svg=>'image/svg+xml', png=>'image/png', json=>'application/json', pdf=>'application/pdf');
  (my $ext = $file) =~ s/.*\.//;
  my $ct = $mime{$ext} || 'application/octet-stream';
  open my $fh, '<:raw', $file or do { print "HTTP/1.0 404 Not Found\r\n\r\n"; return; };
  local $/; my $data = <$fh>;
  print "HTTP/1.0 200 OK\r\nContent-Type: $ct\r\nContent-Length: ".length($data)."\r\n\r\n$data";
});
