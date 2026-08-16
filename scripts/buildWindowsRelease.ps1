param(
  [string]$Version = '1.0.0',
  [string]$OutputDirectory = 'release',
  [string]$NodeExecutable = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outputRoot = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
$rootPrefix = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
if (-not $outputRoot.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Le dossier de sortie doit rester dans le projet.'
}

$serverBundle = Join-Path $root 'apps\server\dist\server.cjs'
$clientBundle = Join-Path $root 'apps\client\dist\index.html'
if (-not (Test-Path -LiteralPath $serverBundle)) {
  throw 'Le bundle serveur manque. Lancez pnpm build:release.'
}
if (-not (Test-Path -LiteralPath $clientBundle)) {
  throw 'Le bundle client manque. Lancez pnpm build:release.'
}

if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $NodeExecutable = (Get-Command node -ErrorAction Stop).Source
}
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
if (-not (Test-Path -LiteralPath $NodeExecutable)) {
  throw "Node.js introuvable : $NodeExecutable"
}

if (Test-Path -LiteralPath $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$packageName = "civilisation-emergente-v$Version-windows-x64"
$packageRoot = Join-Path $outputRoot $packageName
New-Item -ItemType Directory -Force -Path `
  $packageRoot, `
  (Join-Path $packageRoot 'client'), `
  (Join-Path $packageRoot 'server'), `
  (Join-Path $packageRoot 'runtime'), `
  (Join-Path $packageRoot 'scripts') | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'apps\server\dist\server.cjs') -Destination (Join-Path $packageRoot 'server\server.cjs')
Copy-Item -Path (Join-Path $root 'apps\client\dist\*') -Destination (Join-Path $packageRoot 'client') -Recurse -Force
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $packageRoot 'runtime\node.exe')
$nodeLicense = Join-Path (Split-Path -Parent $NodeExecutable) 'LICENSE'
if (Test-Path -LiteralPath $nodeLicense) {
  Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $packageRoot 'runtime\NODE-LICENSE.txt')
}
Copy-Item -LiteralPath (Join-Path $root 'distribution\windows\Lancer le jeu.cmd') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $root 'distribution\windows\LISEZ-MOI.txt') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $root 'distribution\windows\scripts\start.ps1') -Destination (Join-Path $packageRoot 'scripts\start.ps1')

$archivePath = Join-Path $outputRoot "$packageName.zip"
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal

$archive = Get-Item -LiteralPath $archivePath
Write-Host "Release Windows creee : $($archive.FullName) ($([math]::Round($archive.Length / 1MB, 1)) Mo)"
