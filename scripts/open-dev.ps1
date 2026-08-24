# Arrenca DB (idempotent) + servidor dev si no corre, espera resposta i obre el navegador.

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# 1) Base de dades (idempotent: si ja escolta, no fa res)
$null = & npm run db 2>&1

function Test-Port3000 {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

if (-not (Test-Port3000)) {
  Write-Host "Arrencant next dev en segon pla..."
  $log = Join-Path $env:TEMP "lexicat-dev.log"
  $proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev > `"$log`" 2>&1" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden -PassThru
  Write-Host "PID $($proc.Id) · log: $log"

  $ready = $false
  foreach ($i in 1..60) {
    Start-Sleep -Seconds 2
    if (Test-Port3000) { $ready = $true; break }
  }
  if (-not $ready) {
    Write-Host "El servidor no respon encara. Últimes línies del log:"
    Get-Content $log -Tail 25 -ErrorAction SilentlyContinue
    exit 1
  }
}

Write-Host "Servidor a http://localhost:3000 — obrint navegador..."
Start-Process "http://localhost:3000"
