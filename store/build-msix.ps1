<#
  Сборка пакета MSIX для Microsoft Store.

  Store сам подписывает MSIX — свой сертификат не нужен. Загружайте в
  Partner Center НЕподписанный файл, который сделает этот скрипт.

  Значения берутся из Partner Center → ваше приложение → Product management →
  Product identity. Их можно передать параметрами или переменными окружения
  TULPAR_STORE_IDENTITY, TULPAR_STORE_PUBLISHER, TULPAR_STORE_PUBLISHER_NAME.

  Пример:
    .\store\build-msix.ps1 -IdentityName "12345Artur.Tulpar" `
      -Publisher "CN=ABCD1234-5678-..." -PublisherDisplayName "Artur"

  Нужен Windows SDK (ставится с Visual Studio Build Tools, «Разработка на C++»).
#>
param(
  [string]$IdentityName = $env:TULPAR_STORE_IDENTITY,
  [string]$Publisher = $env:TULPAR_STORE_PUBLISHER,
  [string]$PublisherDisplayName = $env:TULPAR_STORE_PUBLISHER_NAME,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $IdentityName -or -not $Publisher -or -not $PublisherDisplayName) {
  throw "Укажите -IdentityName, -Publisher и -PublisherDisplayName (Partner Center → Product identity)."
}

# Версия: 0.3.0 → 0.3.0.0 (четвёртая цифра в Store должна быть 0)
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = ($pkg.version -replace '-.*$', '') + ".0"
Write-Host "Tulpar $version для Microsoft Store"

if (-not $SkipBuild) {
  # Сборка без установщика; VITE_TULPAR_STORE выключает проверку обновлений через GitHub
  $env:VITE_TULPAR_STORE = "1"
  npm run tauri build -- --no-bundle
  if ($LASTEXITCODE -ne 0) { throw "Сборка не удалась" }
}

$exe = Join-Path $root "src-tauri\target\release\tulpar.exe"
if (-not (Test-Path $exe)) { throw "Не найден $exe" }

$stage = Join-Path $root "store\out\package"
$out = Join-Path $root "store\out"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $stage "Assets") | Out-Null
Copy-Item $exe $stage

# Иконки для Store — из src-tauri/icons/icon.png
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Join-Path $root "src-tauri\icons\icon.png"))
function Save-Logo([string]$name, [int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $size = [Math]::Min($w, $h)
  $g.DrawImage($src, [int](($w - $size) / 2), [int](($h - $size) / 2), $size, $size)
  $bmp.Save((Join-Path $stage "Assets\$name"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Save-Logo "StoreLogo.png" 50 50
Save-Logo "Square44x44Logo.png" 44 44
Save-Logo "Square150x150Logo.png" 150 150
Save-Logo "Wide310x150Logo.png" 310 150
$src.Dispose()

# Манифест
$manifest = Get-Content (Join-Path $root "store\AppxManifest.xml") -Raw -Encoding UTF8
$esc = { param($v) [System.Security.SecurityElement]::Escape($v) }
$manifest = $manifest.Replace("{{IDENTITY_NAME}}", (& $esc $IdentityName))
$manifest = $manifest.Replace("{{PUBLISHER}}", (& $esc $Publisher))
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $esc $PublisherDisplayName))
$manifest = $manifest.Replace("{{VERSION}}", $version)
[System.IO.File]::WriteAllText((Join-Path $stage "AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding $false))

# makeappx из Windows SDK
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "Не найден makeappx.exe — установите Windows SDK (Visual Studio Installer → «Разработка классических приложений на C++»)." }

$msix = Join-Path $out "Tulpar_${version}_x64.msix"
Remove-Item $msix -ErrorAction SilentlyContinue
& $makeappx.FullName pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx не смог собрать пакет" }

Write-Host ""
Write-Host "Готово: $msix" -ForegroundColor Green
Write-Host "Загрузите этот файл в Partner Center → Packages (подписывать НЕ нужно — Store подпишет сам)."
