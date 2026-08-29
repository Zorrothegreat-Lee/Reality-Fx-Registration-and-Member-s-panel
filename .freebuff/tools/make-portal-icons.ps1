Add-Type -AssemblyName System.Drawing
function New-Icon([int]$size, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $bg = [System.Drawing.Color]::FromArgb(255, 14, 13, 10)
  $g.Clear($bg)
  $s = [double]$size / 24.0
  $gold = [System.Drawing.Color]::FromArgb(255, 212, 175, 55)
  $w = [single]([Math]::Max(1.8, $s * 1.9))
  $pen = New-Object System.Drawing.Pen($gold, $w)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $gw = [single]([Math]::Max(5, $s * 4.5))
  $glow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 212, 175, 55), $gw)
  $glow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = @(
    (New-Object System.Drawing.PointF([single](4 * $s), [single](16.5 * $s))),
    (New-Object System.Drawing.PointF([single](3 * $s), [single](7 * $s))),
    (New-Object System.Drawing.PointF([single](9 * $s), [single](11 * $s))),
    (New-Object System.Drawing.PointF([single](12 * $s), [single](5 * $s))),
    (New-Object System.Drawing.PointF([single](15 * $s), [single](11 * $s))),
    (New-Object System.Drawing.PointF([single](21 * $s), [single](7 * $s))),
    (New-Object System.Drawing.PointF([single](20 * $s), [single](16.5 * $s)))
  )
  $g.DrawPolygon($glow, $pts)
  $g.DrawPolygon($pen, $pts)
  $g.DrawLine($glow, (New-Object System.Drawing.PointF([single](2 * $s), [single](19.5 * $s))), (New-Object System.Drawing.PointF([single](22 * $s), [single](19.5 * $s))))
  $g.DrawLine($pen, (New-Object System.Drawing.PointF([single](2 * $s), [single](19.5 * $s))), (New-Object System.Drawing.PointF([single](22 * $s), [single](19.5 * $s))))
  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  # pixel-content check: count pixels that differ from the background
  $lit = 0; $total = 0
  for ($y = 0; $y -lt $size; $y += 4) {
    for ($x = 0; $x -lt $size; $x += 4) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.R -ne 14 -or $c.G -ne 13 -or $c.B -ne 10) { $lit++ }
      $total++
    }
  }
  $bmp.Dispose()
  Write-Output ("{0}: {1}x{1}, lit-pixels {2}/{3} ({4:P0})" -f $out, $size, $lit, $total, ($lit / $total))
}
New-Icon 192 "C:\Users\leero\Downloads\realitforextradingacedemy\realityforextradingacedemy\rfx-registration-system\assets\icon-192.png"
New-Icon 512 "C:\Users\leero\Downloads\realitforextradingacedemy\realityforextradingacedemy\rfx-registration-system\assets\icon-512.png"
