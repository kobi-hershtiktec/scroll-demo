# Split source/coffee.mp4 into WebP frames for the scroll animation.
# One full turn of the cup = 0 to 15.92s (the loop point was measured against frame 0).
# Usage: powershell -File scripts/extract.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src  = Join-Path $root 'source/coffee.mp4'
$out  = Join-Path $root 'public/frames'
$fps  = 12
$dur  = 15.92

foreach ($d in 'desktop', 'mobile') {
  $dir = Join-Path $out $d
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Force $dir | Out-Null
}

# Desktop: full 16:9 frame, 1920px wide
ffmpeg -v error -y -t $dur -i $src -vf "fps=$fps,scale=1920:-2:flags=lanczos" `
  -c:v libwebp -quality 82 -compression_level 6 (Join-Path $out 'desktop/%04d.webp')

# Mobile: portrait crop around the cup (it sits at x~560-1330 of 1920), 750px wide
ffmpeg -v error -y -t $dur -i $src -vf "fps=$fps,crop=900:1080:480:0,scale=750:-2:flags=lanczos" `
  -c:v libwebp -quality 80 -compression_level 6 (Join-Path $out 'mobile/%04d.webp')

foreach ($d in 'desktop', 'mobile') {
  $files = Get-ChildItem (Join-Path $out $d) -Filter *.webp
  $mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 2)
  Write-Output "$d : $($files.Count) frames, $mb MB"
}
