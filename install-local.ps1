# install-local.ps1 - Install DSWhale into the local dsh web profile (idempotent).
# Usage: powershell -ExecutionPolicy Bypass -File install-local.ps1
$ErrorActionPreference = 'Stop'

$pkgName = 'dsh-whale-copilot'
$src = Join-Path $PSScriptRoot '.'
$userHome = $env:USERPROFILE
$profileRoot = Join-Path $userHome '.dsh\profiles'
$store = Join-Path $profileRoot 'node_modules'
$webDir = Join-Path $profileRoot 'web'
$pkgDir = Join-Path $store ($pkgName -replace '/', '\')

Write-Host "==> [1/3] copy package to $pkgDir"
$targetParent = Split-Path $pkgDir -Parent
New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
Copy-Item -Recurse -Force $src $pkgDir
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $pkgDir 'install-local.ps1')
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $pkgDir '.git')

Write-Host "==> [2/3] declare dependency in $webDir\package.json"
$pkgJson = Join-Path $webDir 'package.json'
$text = Get-Content $pkgJson -Raw
if ($text -match [regex]::Escape('"dsh-whale-copilot"')) {
  Write-Host '    dependency already present, skip'
} else {
  $needle = '"dependencies": {}'
  if ($text.Contains($needle)) {
    $text = $text.Replace($needle, '"dependencies": { "dsh-whale-copilot": "^1.0.1" }')
  } else {
    $text = $text.Replace('"dependencies": {', '"dependencies": { "dsh-whale-copilot": "^1.0.1",')
  }
  Set-Content -Path $pkgJson -Value $text -Encoding utf8NoBOM -NoNewline
  Write-Host '    dependency written'
}

Write-Host "==> [3/3] append plugin row to $webDir\cordis.patch.yml"
$patchFile = Join-Path $webDir 'cordis.patch.yml'
$patch = Get-Content $patchFile -Raw
if ($patch -match 'name:\s*''dsh-whale-copilot''') {
  Write-Host '    plugin row already present, skip'
} else {
  $insert = @'

# DSWhale pet ( dsh-whale-copilot ) - to disable, replace with:
# - id: whale
#   disabled: true
- insert:
    - id: whale
      name: 'dsh-whale-copilot'
'@
  $trimmed = $patch.TrimEnd()
  if ($trimmed -eq '[]') {
    # Replace the empty root array with the insert list (single top-level array).
    $head = $patch.Substring(0, $patch.LastIndexOf('[]'))
    $patch = $head.TrimEnd() + $insert + "`n"
  } else {
    $patch = $trimmed + $insert + "`n"
  }
  Set-Content -Path $patchFile -Value $patch -Encoding utf8NoBOM
  Write-Host '    plugin row written'
}

Write-Host ''
Write-Host '==> Done. Restart dsh web to see the whale: dsh web'
Write-Host '    Toggle: edit the whale row in cordis.patch.yml (disabled), restart.'
