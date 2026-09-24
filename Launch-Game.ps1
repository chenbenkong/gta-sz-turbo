# 深城纪 · 一键本地启动
# 用法: powershell -ExecutionPolicy Bypass -File .\Launch-Game.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = 8765
while (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue) {
  $port++
}

Write-Host ""
Write-Host "  深城纪 · 一路向海" -ForegroundColor Yellow
Write-Host "  本地服务器端口: $port" -ForegroundColor Gray
Write-Host ""

# Prefer python if present, else PowerShell HttpListener
$started = $false

# Try python
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) { $py = Get-Command $env:MIMO_PYTHON -ErrorAction SilentlyContinue }

if ($py) {
  Write-Host "  使用 Python 静态服务…" -ForegroundColor Gray
  $url = "http://127.0.0.1:$port/"
  Start-Process "http://127.0.0.1:$port/"
  & $py.Source -m http.server $port --bind 127.0.0.1
  $started = $true
}

if (-not $started) {
  # Fallback: .NET HttpListener serving files
  Write-Host "  使用 .NET 静态服务…" -ForegroundColor Gray
  $url = "http://127.0.0.1:$port/"
  Start-Process $url

  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  Write-Host "  按 Ctrl+C 停止。" -ForegroundColor Gray

  $mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".webp" = "image/webp"
    ".svg"  = "image/svg+xml"
    ".glb"  = "model/gltf-binary"
    ".wasm" = "application/wasm"
  }

  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = $req.Url.LocalPath.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
      $file = Join-Path $root $rel
      if ((Test-Path $file) -and (Get-Item $file).PSIsContainer) {
        $file = Join-Path $file "index.html"
      }
      if (Test-Path $file) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $msg = [Text.Encoding]::UTF8.GetBytes("404")
        $res.StatusCode = 404
        $res.OutputStream.Write($msg, 0, $msg.Length)
      }
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
}
