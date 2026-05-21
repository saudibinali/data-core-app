# إيقاف API (8080) والواجهة (3000)
$ports = 8080, 3000
foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host "Stopping $($p.ProcessName) (PID $($p.Id)) on port $port"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
    }
}
Write-Host "Done. Close any PowerShell windows that were running pnpm manually (Ctrl+C)."
