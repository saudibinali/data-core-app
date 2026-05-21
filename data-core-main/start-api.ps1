# تشغيل API مع تحميل .env تلقائياً (مستقر بعد إعادة تشغيل Cursor)
$Root = $PSScriptRoot
Set-Location $Root

$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  Write-Error ".env not found in $Root"
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim()
  }
}

$env:NODE_ENV = "development"

Write-Host "DATABASE_URL = $env:DATABASE_URL"
$apiPort = if ($env:PORT) { $env:PORT } else { "8080" }
Write-Host "Starting API on port $apiPort..."
pnpm --filter @workspace/api-server run start
