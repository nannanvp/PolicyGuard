@echo off
setlocal
set "POLICYGUARD_SETUP_FILE=%~f0"
echo PolicyGuard - download, set up, and run locally
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$body=[IO.File]::ReadAllText($env:POLICYGUARD_SETUP_FILE); $parts=[regex]::Split($body,'(?m)^# POWERSHELL-BEGIN\r?$'); if($parts.Length -ne 2){throw 'Setup file is incomplete'}; & ([scriptblock]::Create($parts[1]))"
set "POLICYGUARD_SETUP_RESULT=%errorlevel%"
if not "%POLICYGUARD_SETUP_RESULT%"=="0" echo Setup did not finish. Read the message above, then run this file again.
if not "%POLICYGUARD_SETUP_NO_PAUSE%"=="1" pause
exit /b %POLICYGUARD_SETUP_RESULT%
# POWERSHELL-BEGIN
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'nannanvp/PolicyGuard'
$installRoot = if ($env:POLICYGUARD_INSTALL_ROOT) { [IO.Path]::GetFullPath($env:POLICYGUARD_INSTALL_ROOT) } else { Join-Path $env:LOCALAPPDATA 'PolicyGuard' }
$appRoot = Join-Path $installRoot 'app'
$workRoot = Join-Path $installRoot 'downloads'
$sourceMarker = Join-Path $installRoot 'source.json'
$runtimeMarker = Join-Path $installRoot 'runtime.json'
$lockHandle = $null

function Write-JsonFile($value, $target) {
    $value | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $target -Encoding UTF8
}
function Get-SHA256($file) {
    $stream = [IO.File]::OpenRead($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Download-File($uri, $target) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $target -Headers @{ 'User-Agent' = 'PolicyGuard-Windows-Setup' } -TimeoutSec 180; return }
        catch { if ($attempt -eq 3) { throw }; Write-Host 'Download interrupted; retrying...'; Start-Sleep -Seconds 2 }
    }
}
function Assert-WithinInstall($candidate) {
    $resolved = [IO.Path]::GetFullPath($candidate)
    if (!$resolved.StartsWith($installRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing a path outside this installation.' }
    return $resolved
}
function Expand-CheckedZip($archive, $destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $targetRoot = [IO.Path]::GetFullPath($destination).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $entryPath = [IO.Path]::GetFullPath((Join-Path $targetRoot $entry.FullName))
            if (!$entryPath.StartsWith($targetRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive contains an unsafe path.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination)
}

try {
    Write-Host "Installation folder: $installRoot"
    Write-Host 'No administrator rights or Git installation are required.'
    New-Item -ItemType Directory -Force -Path $installRoot,$workRoot | Out-Null
    try { $lockHandle = [IO.File]::Open((Join-Path $installRoot 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another PolicyGuard setup is already running. Close it before trying again.' }

    if (!(Test-Path -LiteralPath $sourceMarker)) {
        if (Test-Path -LiteralPath $appRoot) { throw "An unrecognised app folder already exists at $appRoot. Nothing was overwritten. Choose a different POLICYGUARD_INSTALL_ROOT." }
        Write-Host '[1/5] Downloading the public GitHub project...'
        $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/main" -Headers @{ 'User-Agent' = 'PolicyGuard-Windows-Setup' } -TimeoutSec 60
        $revision = [string]$commit.sha
        if ($revision -notmatch '^[a-f0-9]{40}$') { throw 'GitHub did not return a valid project revision.' }
        $zipPath = Join-Path $workRoot "source-$revision.zip"
        Download-File "https://codeload.github.com/$repo/zip/$revision" $zipPath
        $unpack = Join-Path $workRoot ('source-' + [Guid]::NewGuid().ToString('N'))
        Expand-CheckedZip $zipPath $unpack
        $source = Join-Path $unpack "PolicyGuard-$revision"
        foreach ($required in @('package.json','package-lock.json','app-server.js','scripts/launch-local.js','contracts/CustomerLedger.sol','contracts/AgentLedger.sol')) {
            if (!(Test-Path -LiteralPath (Join-Path $source $required))) { throw "Downloaded project is missing $required" }
        }
        $moveSource = Assert-WithinInstall $source
        $moveTarget = Assert-WithinInstall $appRoot
        Move-Item -LiteralPath $moveSource -Destination $moveTarget
        Write-JsonFile @{ repository=$repo; revision=$revision; installedAt=[DateTime]::UtcNow.ToString('o') } $sourceMarker
    } else {
        $saved = Get-Content -LiteralPath $sourceMarker -Raw | ConvertFrom-Json
        if ($saved.repository -ne $repo -or !(Test-Path -LiteralPath (Join-Path $appRoot 'package-lock.json'))) { throw 'Existing installation is incomplete or belongs to another project. No files were replaced.' }
        Write-Host '[1/5] Existing project found. Keeping its code and saved data.'
    }

    $nodeFolder = $null
    if (Test-Path -LiteralPath $runtimeMarker) {
        $runtime = Get-Content -LiteralPath $runtimeMarker -Raw | ConvertFrom-Json
        $candidate = Assert-WithinInstall (Join-Path $installRoot $runtime.folder)
        if ((Test-Path -LiteralPath (Join-Path $candidate 'node.exe')) -and (Test-Path -LiteralPath (Join-Path $candidate 'node_modules/npm/bin/npm-cli.js'))) { $nodeFolder = $candidate }
    }
    if (!$nodeFolder) {
        Write-Host '[2/5] Downloading a private Node.js 24 runtime from nodejs.org...'
        $machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $architecture = switch ($machine.ToUpperInvariant()) { 'AMD64' { 'x64' }; 'ARM64' { 'arm64' }; default { throw '64-bit Windows 10/11 is required.' } }
        $checksPath = Join-Path $workRoot 'SHASUMS256.txt'
        Download-File 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' $checksPath
        $line = Get-Content -LiteralPath $checksPath | Where-Object { $_ -match "^[a-f0-9]{64}\s+node-v24\.\d+\.\d+-win-$architecture\.zip$" } | Select-Object -First 1
        if (!$line) { throw 'Could not find the official Windows Node.js 24 download.' }
        $fields = $line -split '\s+'
        $expectedHash = $fields[0]; $filename = $fields[1]
        $archivePath = Join-Path $workRoot $filename
        Download-File "https://nodejs.org/dist/latest-v24.x/$filename" $archivePath
        if ((Get-SHA256 $archivePath) -ne $expectedHash) { throw 'Node.js checksum verification failed. The downloaded runtime was not executed.' }
        $runtimeArea = Join-Path $installRoot ('runtime/' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path (Split-Path $runtimeArea) | Out-Null
        Expand-CheckedZip $archivePath $runtimeArea
        $nodeFolder = Join-Path $runtimeArea ($filename -replace '\.zip$','')
        $relativeRuntime = $nodeFolder.Substring($installRoot.Length).TrimStart('\')
        Write-JsonFile @{ folder=$relativeRuntime; sha256=$expectedHash } $runtimeMarker
    } else { Write-Host '[2/5] Private Node.js runtime already installed.' }
    $node = Join-Path $nodeFolder 'node.exe'
    $npm = Join-Path $nodeFolder 'node_modules/npm/bin/npm-cli.js'
    $env:PATH = "$nodeFolder;$env:PATH"
    & $node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 could not run on this computer.' }

    Write-Host '[3/5] Checking and installing project dependencies...'
    $lockHash = Get-SHA256 (Join-Path $appRoot 'package-lock.json')
    $dependenciesMarker = Join-Path $installRoot 'dependencies.txt'
    $dependenciesReady = (Test-Path -LiteralPath $dependenciesMarker) -and ((Get-Content -LiteralPath $dependenciesMarker -Raw).Trim() -eq $lockHash) -and (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules/ganache/package.json'))
    Push-Location $appRoot
    try {
        if (!$dependenciesReady) {
            & $node $npm ci --no-audit --no-fund --loglevel=error
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection, then rerun setup.' }
            Set-Content -LiteralPath $dependenciesMarker -Value $lockHash -Encoding ASCII
        }
        Write-Host '[4/5] Preparing your own local blockchain data and sample accounts...'
        $env:POLICYGUARD_DATA = Join-Path $appRoot 'data'
        if (!(Test-Path -LiteralPath $env:POLICYGUARD_DATA)) {
            & $node scripts/sample-data.js
            if ($LASTEXITCODE -ne 0) { throw 'Initial sample setup did not finish. Existing partial data was preserved. Read the recovery instructions in docs/TEAMMATE_SETUP.md.' }
        } else { Write-Host 'Existing accounts and blockchain history are being preserved.' }
    } finally { Pop-Location }

    Write-Host '[5/5] Creating your launcher and desktop shortcuts...'
    $runtimeRelative = $nodeFolder.Substring($installRoot.Length).TrimStart('\').Replace('/','\')
    $launcher = Join-Path $installRoot 'Start PolicyGuard.bat'
    $launcherText = @"
@echo off
setlocal
cd /d "%~dp0app"
set "POLICYGUARD_DATA=%~dp0app\data"
"%~dp0$runtimeRelative\node.exe" scripts\launch-local.js
if not "%POLICYGUARD_SETUP_NO_PAUSE%"=="1" pause
"@
    [IO.File]::WriteAllText($launcher, $launcherText.Replace("`n","`r`n"), [Text.Encoding]::ASCII)
    if ($env:POLICYGUARD_SETUP_NO_SHORTCUTS -ne '1') {
        try {
            $desktop = [Environment]::GetFolderPath('Desktop')
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut((Join-Path $desktop 'PolicyGuard.lnk'))
            $shortcut.TargetPath = $launcher; $shortcut.WorkingDirectory = $installRoot; $shortcut.Description = 'Run PolicyGuard locally'; $shortcut.Save()
            $logins = Join-Path $appRoot 'data/SAMPLE_ACCOUNTS.txt'
            if (Test-Path -LiteralPath $logins) {
                $shortcut = $shell.CreateShortcut((Join-Path $desktop 'PolicyGuard Login Details.lnk'))
                $shortcut.TargetPath = $logins; $shortcut.Description = 'Private sample account passwords'; $shortcut.Save()
            }
        } catch { Write-Host "Desktop shortcuts were unavailable. Use this launcher instead: $launcher" }
    }
    Write-Host "`nSetup complete. Next time, open the PolicyGuard desktop shortcut."
    Write-Host "Sample passwords: $(Join-Path $appRoot 'data/SAMPLE_ACCOUNTS.txt')"
    Write-Host "Administrator password: $(Join-Path $appRoot 'data/INITIAL_ADMIN.txt')"
    Write-Host 'Your laptop has its own accounts and chains; it does not synchronise data with your teammate.'
    $lockHandle.Dispose(); $lockHandle = $null
    if ($env:POLICYGUARD_SETUP_NO_LAUNCH -ne '1') {
        Push-Location $appRoot
        try { & $node scripts/launch-local.js; if ($LASTEXITCODE -ne 0) { throw 'The website could not start. Read the message above.' } }
        finally { Pop-Location }
    }
} catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Your installation and any existing data were kept at: $installRoot"
    exit 1
} finally { if ($lockHandle) { $lockHandle.Dispose() } }
