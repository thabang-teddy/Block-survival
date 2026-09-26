<#
.SYNOPSIS
  Builds the Block Survival Host installer: out\BlockSurvivalHost-<version>.msi.

.DESCRIPTION
  1. builds pc-host (it bundles the game code from server\, which needs `npm ci` there)
     and packages it with this PC's node.exe and production node_modules;
  2. adds WinSW (the Windows service wrapper) as pc-host\pc-host-service.exe;
  3. publishes the app self-contained for win-x64 (no .NET install needed on the host PC);
  4. builds the MSI with WiX 5;
  5. signs the app and the MSI when a code-signing certificate is configured.

  Windows Smart App Control and SmartScreen block unsigned installers. Signing needs a
  real code-signing certificate - e.g. Azure Trusted Signing, or an OV/EV certificate -
  and signtool.exe from the Windows SDK. Set one of:
    BSH_SIGN_THUMBPRINT   a certificate in the current user's store (signtool /sha1)
    BSH_SIGN_ARGS         the full signtool arguments before the file names (e.g. Trusted
                          Signing's /dlib and /dmdf), used as-is
  Without either the build finishes unsigned and says so.

.PARAMETER WinSW
  WinSW-x64.exe v2.12 (https://github.com/winsw/winsw/releases). Defaults to
  ..\pc-host\pc-host-service.exe, the copy the dev PC's service already uses.
#>
param(
    [string]$Version = "1.0.0",
    [string]$WinSW = (Join-Path $PSScriptRoot "..\pc-host\pc-host-service.exe"),
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$out = Join-Path $PSScriptRoot "out"
$stage = Join-Path $out "stage"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
# native tools report through their exit code; what they print on stderr (esbuild, npm) is not an error
function Run($exe, [string[]]$arguments, $dir) {
    Push-Location $dir
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $exe @arguments 2>&1 | ForEach-Object { "$_" }
        if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') failed ($LASTEXITCODE)" }
    } finally {
        $ErrorActionPreference = $saved
        Pop-Location
    }
}

if (-not (Test-Path $WinSW)) { throw "WinSW not found at $WinSW - download WinSW-x64.exe v2.12 and pass -WinSW <path>." }

Step "pc-host"
if (-not (Test-Path (Join-Path $root "server\node_modules"))) { Run "npm" @("ci") (Join-Path $root "server") }
Run "npm" @("ci") (Join-Path $root "pc-host")
if (-not $SkipTests) { Run "npm" @("test") (Join-Path $root "pc-host") }
Run "npm" @("run", "package") (Join-Path $root "pc-host")

Step "app"
if (-not $SkipTests) { Run "dotnet" @("test", "--configuration", "Release") $PSScriptRoot }
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
$appDir = Join-Path $stage "app"
$pcHostDir = Join-Path $stage "pc-host"
Run "dotnet" @("publish", "src\BlockSurvivalHost", "--configuration", "Release", "--runtime", "win-x64", "--self-contained",
    "-p:Version=$Version", "--output", $appDir) $PSScriptRoot

Step "staging"
Copy-Item (Join-Path $root "pc-host\release\pc-host") $pcHostDir -Recurse
Copy-Item $WinSW (Join-Path $pcHostDir "pc-host-service.exe")
# pc-host's hand-setup files are not part of an install: setup writes the service definition
Remove-Item (Join-Path $pcHostDir "pc-host-service.xml"), (Join-Path $pcHostDir "pc-host.cmd"), (Join-Path $pcHostDir "config.example.json") -ErrorAction SilentlyContinue

$signArgs = $null
if ($env:BSH_SIGN_ARGS) { $signArgs = $env:BSH_SIGN_ARGS -split ' ' }
elseif ($env:BSH_SIGN_THUMBPRINT) { $signArgs = @("sign", "/sha1", $env:BSH_SIGN_THUMBPRINT, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256") }
$signtool = $null
if ($signArgs) {
    $signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
    if (-not $signtool) {
        $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
    }
    if (-not $signtool) { throw "Signing was asked for but signtool.exe was not found (install the Windows SDK)." }
    Step "signing the app"
    Run $signtool ($signArgs + @((Join-Path $appDir "BlockSurvivalHost.exe"))) $PSScriptRoot
}

Step "installer"
Run "dotnet" @("build", "installer", "--configuration", "Release", "-p:ProductVersion=$Version", "-p:AppDir=$appDir", "-p:PcHostDir=$pcHostDir", "--output", $out) $PSScriptRoot
$msi = Join-Path $out "BlockSurvivalHost-$Version.msi"

if ($signtool) {
    Step "signing the installer"
    Run $signtool ($signArgs + @($msi)) $PSScriptRoot
    Write-Host "`nSigned: $msi" -ForegroundColor Green
} else {
    Write-Warning "The installer is NOT signed. Windows Smart App Control and SmartScreen will block it on most PCs. See the notes at the top of build.ps1."
    Write-Host "`nBuilt: $msi" -ForegroundColor Green
}
