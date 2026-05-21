# مرة واحدة فقط: تأكيد وجود super_admin في قاعدة .env
$Root = $PSScriptRoot
Set-Location $Root

$envFile = Join-Path $Root ".env"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim()
  }
}

if (-not $env:DATABASE_URL) {
  Write-Error "DATABASE_URL missing in .env"
  exit 1
}

Write-Host "Ensuring platform owner in database..."
pnpm --filter @workspace/scripts run setup-owner

Write-Host ""
Write-Host "Verify (API must be running):"
Write-Host "  Invoke-RestMethod http://localhost:8080/api/setup/status"
Write-Host "Expected: initialized=True, databaseReady=True"
