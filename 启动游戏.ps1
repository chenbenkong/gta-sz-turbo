# 深城纪 TURBO — 一键启动
# 双击本文件即可游玩（Windows）

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "  ╔══════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "  ║   深城纪 TURBO · 一路向海        ║" -ForegroundColor Yellow
Write-Host "  ║   一键本地版                     ║" -ForegroundColor Yellow
Write-Host "  ╚══════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

# 1) first run: bake original GLB into streamable chunks
if (-not (Test-Path (Join-Path $root "city-opt\index.json"))) {
  Write-Host "  首次启动，正在优化原版模型（1–2 分钟）…" -ForegroundColor Cyan
  $node = $env:MIMO_NODE
  if (-not $node) {
    $cand = Get-Command node -ErrorAction SilentlyContinue
    if ($cand) { $node = $cand.Source }
  }
  if (-not $node) {
    Write-Host "  未找到 Node.js，请先安装 https://nodejs.org" -ForegroundColor Red
    pause
    exit 1
  }
  & $node tools\optimize-city.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  优化失败" -ForegroundColor Red
    pause
    exit 1
  }
  Write-Host "  优化完成。" -ForegroundColor Green
}

# 2) pick free port
$port = 8787
while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $port++ }

$py = $null
foreach ($n in @("python", "python3", "py")) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c) { $py = $c.Source; break }
}
if (-not $py -and $env:MIMO_PYTHON -and (Test-Path $env:MIMO_PYTHON)) { $py = $env:MIMO_PYTHON }

$url = "http://127.0.0.1:$port/"
Write-Host "  启动游戏服务（端口 $port）…" -ForegroundColor Gray

# open browser after short delay
Start-Process "msedge.exe" -ArgumentList "--app=$url" -ErrorAction SilentlyContinue
Start-Process "chrome.exe" -ArgumentList "--app=$url" -ErrorAction SilentlyContinue
Start-Process $url

if ($py) {
  Write-Host "  按 Ctrl+C 关闭游戏。" -ForegroundColor DarkGray
  & $py -m http.server $port --bind 127.0.0.1
} else {
  # .NET fallback server
  Write-Host "  按 Ctrl+C 关闭游戏。" -ForegroundColor DarkGray
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  $mime = @{
    ".html"="text/html; charset=utf-8"; ".js"="application/javascript; charset=utf-8"
    ".css"="text/css; charset=utf-8"; ".json"="application/json; charset=utf-8"
    ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".webp"="image/webp"
    ".svg"="image/svg+xml"; ".glb"="model/gltf-binary"; ".bin"="application/octet-stream"
  }
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = $ctx.Request.Url.LocalPath.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
      $file = Join-Path $root $rel
      if ((Test-Path $file) -and -not (Get-Item $file).PSIsContainer) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {}
    finally { try { $ctx.Response.OutputStream.Close() } catch {} }
  }
}
