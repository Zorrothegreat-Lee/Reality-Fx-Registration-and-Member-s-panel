$root = 'C:/Users/leero/Downloads/realitforextradingacedemy/realityforextradingacedemy'
$env:RFX_ROOT = "$root/rfx-registration-system"
$env:RFX_PORT = '8125'
$log = "$root/.freebuff/preview-4f40a73f-3234-4c50-9a13-44a3e0ccf6df.log"
$err = "$root/.freebuff/preview-4f40a73f-3234-4c50-9a13-44a3e0ccf6df.log.err"
$p = Start-Process -FilePath 'perl.exe' -ArgumentList "$root/.freebuff/serve_fork.pl" `
  -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru
$p.Id
