$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $packageRoot 'runtime\node.exe'
$serverPath = Join-Path $packageRoot 'server\server.cjs'
$clientPath = Join-Path $packageRoot 'client'
$savePath = Join-Path $packageRoot 'saves'
$logPath = Join-Path $packageRoot 'logs'

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Moteur Node.js introuvable : $nodePath"
}
if (-not (Test-Path -LiteralPath $serverPath)) {
  throw "Serveur du jeu introuvable : $serverPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $clientPath 'index.html'))) {
  throw "Interface du jeu introuvable : $clientPath"
}

New-Item -ItemType Directory -Force -Path $savePath, $logPath | Out-Null

$env:NODE_ENV = 'production'
$env:CIV_HOST = '127.0.0.1'
$env:CIV_PORT = '8787'
$env:CIV_CLIENT_DIR = $clientPath
$env:CIV_SAVE_DIR = $savePath
$env:CIV_LOG_LEVEL = 'warn'

$serverLog = Join-Path $logPath 'server.log'
$browserJob = Start-Job -ScriptBlock {
  $healthUrl = 'http://127.0.0.1:8787/health'
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1 | Out-Null
      Start-Process 'http://127.0.0.1:8787/'
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
} 

Write-Host ''
Write-Host '  Civilisation emergente est en cours de lancement...' -ForegroundColor Green
Write-Host '  Le navigateur va s ouvrir automatiquement.'
Write-Host '  Gardez cette fenetre ouverte pendant la partie.'
Write-Host '  Fermez-la pour arreter le jeu.'
Write-Host ''

try {
  & $nodePath $serverPath 2>&1 | Tee-Object -FilePath $serverLog
  if ($LASTEXITCODE -ne 0) {
    throw "Le serveur s'est arrete avec le code $LASTEXITCODE."
  }
} finally {
  Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
  Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
