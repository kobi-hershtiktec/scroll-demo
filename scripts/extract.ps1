# Split source/coffee.mp4 into WebP frames for the scroll animation.
# One full turn of the cup = 0 to 15.92s (the loop point was measured against frame 0).
# Every source frame is kept (24fps -> <1 degree per frame) so slow scrolling stays fluid.
# Frames are cropped to the cup (x 480-1380 of 1920); the rest of the footage is pure
# black like the page, so smaller frames decode faster without changing the look.
# Usage: powershell -File scripts/extract.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src  = Join-Path $root 'source/coffee.mp4'
$out  = Join-Path $root 'public/frames'
$dur  = 15.92
$crop = 'crop=900:1080:480:0'

foreach ($d in 'desktop', 'mobile') {
  $dir = Join-Path $out $d
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Force $dir | Out-Null
}

# Desktop: native resolution crop, 900x1080
ffmpeg -v error -y -t $dur -i $src -vf "$crop" `
  -c:v libwebp -quality 80 -compression_level 6 (Join-Path $out 'desktop/%04d.webp')

# Mobile: same crop at 600x720
ffmpeg -v error -y -t $dur -i $src -vf "$crop,scale=600:-2:flags=lanczos" `
  -c:v libwebp -quality 78 -compression_level 6 (Join-Path $out 'mobile/%04d.webp')

foreach ($d in 'desktop', 'mobile') {
  $files = Get-ChildItem (Join-Path $out $d) -Filter *.webp
  $mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 2)
  Write-Output "$d : $($files.Count) frames, $mb MB"
}
