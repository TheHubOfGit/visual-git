<#
  Visual Git installer for Windows. Installs for the current user only and
  never asks for administrator rights.

  What it does:
    1. Copies Visual Git to %LOCALAPPDATA%\VisualGit.
    2. If Node.js 20+ is not already available, puts a private copy in
       %LOCALAPPDATA%\VisualGit\runtime\node (official zip from nodejs.org,
       checksum verified).
    3. If Git is not already available, puts a private copy (MinGit, from the
       official Git for Windows releases) in ...\runtime\git.
    4. Asks for the name and email Git puts on save points, if none is set.
    5. Adds the folder to your user PATH and a shortcut to the Start Menu.

  Usage:
    install.cmd                     normal install (double-click)
    install.cmd -Uninstall          remove everything again
    install.cmd -NodeZip C:\x.zip   use a Node.js zip you downloaded yourself
    install.cmd -GitZip C:\y.zip    use a MinGit zip you downloaded yourself
    install.cmd -NoPath -NoShortcut copy files only
#>
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'VisualGit'),
  [string]$NodeZip,
  [string]$GitZip,
  [switch]$NoPath,
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is far faster without the progress bar
$NodeLine = 'latest-v22.x'
$MinNodeMajor = 20
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Visual Git.lnk'

function Write-Step([string]$Message) { Write-Host "  - $Message" }

function Initialize-Network {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }
  try {
    # Lets downloads pass through a company proxy using the signed-in account.
    [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials
  } catch { }
}

function Get-Arch {
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'Visual Git needs 64-bit Windows.'
  }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { return 'arm64' }
  return 'x64'
}

function Normalize-Dir([string]$Path) {
  if (-not $Path) { return '' }
  return $Path.Trim().TrimEnd('\').ToLowerInvariant()
}

function Get-UserPathEntries {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { return @() }
  return @($current.Split(';') | Where-Object { $_ -and $_.Trim() })
}

function Add-UserPath([string]$Dir) {
  $entries = Get-UserPathEntries
  $wanted = Normalize-Dir $Dir
  if (@($entries | Where-Object { (Normalize-Dir $_) -eq $wanted }).Count -gt 0) { return $false }
  [Environment]::SetEnvironmentVariable('Path', (@($entries) + $Dir) -join ';', 'User')
  return $true
}

function Remove-UserPath([string]$Dir) {
  $entries = Get-UserPathEntries
  $wanted = Normalize-Dir $Dir
  $kept = @($entries | Where-Object { (Normalize-Dir $_) -ne $wanted })
  if ($kept.Count -ne @($entries).Count) {
    [Environment]::SetEnvironmentVariable('Path', $kept -join ';', 'User')
  }
}

function Expand-Zip([string]$Zip, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) {
    # Built into Windows 10 and later, and much faster than Expand-Archive.
    & $tar -xf $Zip -C $Destination
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -Path $Zip -DestinationPath $Destination -Force
}

function Test-FileHash([string]$File, [string]$Expected, [string]$What) {
  $actual = (Get-FileHash -Path $File -Algorithm SHA256).Hash
  if ($actual -ne $Expected.ToUpperInvariant()) {
    throw "$What did not match its published checksum, so it was not installed. Try again, or download it yourself (see README.txt)."
  }
}

function Find-Beside([string]$Pattern) {
  $match = Get-ChildItem -Path $Source -Filter $Pattern -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($match) { return $match.FullName }
  return $null
}

function Test-SystemNode {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) { return $false }
  try {
    $version = (& node -p 'process.versions.node' 2>$null)
    return ([int]($version.Split('.')[0]) -ge $MinNodeMajor)
  } catch {
    return $false
  }
}

function Install-PrivateNode([string]$Zip) {
  $target = Join-Path $InstallDir 'runtime\node'
  $staging = Join-Path $InstallDir 'runtime\_node'
  $downloaded = $null

  if (-not $Zip) {
    Initialize-Network
    $arch = Get-Arch
    $base = "https://nodejs.org/dist/$NodeLine"
    Write-Step 'Node.js not found. Downloading a private copy from nodejs.org...'
    $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = $sums -split "`n" | Where-Object { $_ -match "\snode-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { throw 'Could not find a Node.js build for this computer on nodejs.org.' }
    $parts = $line.Trim() -split '\s+'
    $downloaded = Join-Path $env:TEMP $parts[1]
    Invoke-WebRequest -Uri "$base/$($parts[1])" -OutFile $downloaded -UseBasicParsing
    Test-FileHash $downloaded $parts[0] 'The Node.js download'
    $Zip = $downloaded
  } else {
    Write-Step "Using the Node.js zip at $Zip"
  }

  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  Expand-Zip $Zip $staging
  $inner = Get-ChildItem -Path $staging -Directory | Select-Object -First 1
  $root = if ((Test-Path (Join-Path $staging 'node.exe'))) { $staging } elseif ($inner) { $inner.FullName } else { $null }
  if (-not $root -or -not (Test-Path (Join-Path $root 'node.exe'))) {
    throw 'That zip does not contain node.exe. Use the "Windows Binary (.zip)" download from nodejs.org.'
  }
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item -Path $root -Destination $target
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  if ($downloaded) { Remove-Item -Force $downloaded -ErrorAction SilentlyContinue }
  Write-Step 'Node.js is ready (private copy; nothing else on this computer is changed).'
}

function Install-PrivateGit([string]$Zip) {
  $target = Join-Path $InstallDir 'runtime\git'
  $downloaded = $null

  if (-not $Zip) {
    Initialize-Network
    $arch = Get-Arch
    $suffix = if ($arch -eq 'arm64') { 'arm64' } else { '64-bit' }
    Write-Step 'Git not found. Downloading a private copy (MinGit) from the Git for Windows releases...'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'visual-git-installer' }
    $asset = $release.assets | Where-Object { $_.name -match "^MinGit-[\d.]+(-\d+)?-$suffix\.zip$" } | Select-Object -First 1
    if (-not $asset) { throw 'Could not find a MinGit download for this computer.' }
    $downloaded = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloaded -UseBasicParsing
    if ($asset.digest -and $asset.digest -like 'sha256:*') {
      Test-FileHash $downloaded ($asset.digest.Substring(7)) 'The Git download'
    }
    $Zip = $downloaded
  } else {
    Write-Step "Using the Git zip at $Zip"
  }

  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Expand-Zip $Zip $target
  if (-not (Test-Path (Join-Path $target 'cmd\git.exe'))) {
    throw 'That zip does not contain cmd\git.exe. Use a "MinGit" zip from the Git for Windows releases page.'
  }
  if ($downloaded) { Remove-Item -Force $downloaded -ErrorAction SilentlyContinue }
  Write-Step 'Git is ready (private copy, used only by Visual Git).'
}

function Set-GitIdentity {
  # Git refuses to save anything until it knows who is saving. Ask once, here,
  # because a private Git copy is not on the person's PATH to fix it later.
  $privateGit = Join-Path $InstallDir 'runtime\git\cmd\git.exe'
  $git = if (Test-Path $privateGit) { $privateGit } else { 'git' }
  $name = (& $git config --global user.name 2>$null)
  $email = (& $git config --global user.email 2>$null)
  if ($name -and $email) { return }
  if (-not [Environment]::UserInteractive) { return }

  Write-Host ''
  Write-Host '  Git labels every save point with a name and email. These stay on this computer'
  Write-Host '  unless you later upload your work. Press Enter to skip and set them later.'
  if (-not $name) {
    $name = (Read-Host '    Your name').Trim()
    if ($name) { & $git config --global user.name $name }
  }
  if (-not $email) {
    $email = (Read-Host '    Your email').Trim()
    if ($email) { & $git config --global user.email $email }
  }
  if ($name -and $email) { Write-Step 'Saved your name and email for Git.' }
}

function Copy-App {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  if ((Normalize-Dir $Source) -eq (Normalize-Dir $InstallDir)) { return }
  if (-not (Test-Path (Join-Path $Source 'app\build\cli.mjs'))) {
    throw "This folder is incomplete (app\build\cli.mjs is missing). Unzip the whole Visual Git archive first, then run install.cmd from inside it."
  }
  $oldApp = Join-Path $InstallDir 'app'
  if (Test-Path $oldApp) { Remove-Item -Recurse -Force $oldApp }
  Copy-Item -Path (Join-Path $Source 'app') -Destination $InstallDir -Recurse -Force
  foreach ($name in 'visualgit.cmd', 'start-visualgit.cmd', 'install.cmd', 'install.ps1', 'uninstall.cmd', 'README.txt', 'VERSION', 'visualgit.ico') {
    $file = Join-Path $Source $name
    if (Test-Path $file) { Copy-Item -Path $file -Destination $InstallDir -Force }
  }
  # Files unzipped from a download carry a "came from the internet" mark that
  # makes Windows warn on every launch. Clearing it on our own files needs no admin.
  Get-ChildItem -Path $InstallDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  Write-Step "Copied Visual Git to $InstallDir"
}

function New-StartMenuShortcut {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = Join-Path $InstallDir 'start-visualgit.cmd'
  $shortcut.WorkingDirectory = $env:USERPROFILE
  $shortcut.Description = 'See a project''s Git history as a map'
  $icon = Join-Path $InstallDir 'visualgit.ico'
  if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
  $shortcut.Save()
  Write-Step 'Added "Visual Git" to the Start Menu.'
}

function Invoke-Uninstall {
  Write-Host 'Removing Visual Git...'
  if (Test-Path $ShortcutPath) { Remove-Item -Force $ShortcutPath; Write-Step 'Removed the Start Menu shortcut.' }
  Remove-UserPath $InstallDir
  Write-Step 'Removed it from your PATH.'
  Set-Location $env:TEMP
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    if (Test-Path $InstallDir) {
      Write-Step "Some files in $InstallDir are still in use. Close Visual Git and delete that folder by hand."
    } else {
      Write-Step "Deleted $InstallDir"
    }
  }
  Write-Host 'Visual Git has been removed. Your projects were not touched.'
}

try {
  if ($Uninstall) {
    Invoke-Uninstall
    exit 0
  }

  $version = ''
  $versionFile = Join-Path $Source 'VERSION'
  if (Test-Path $versionFile) { $version = (Get-Content $versionFile -TotalCount 1).Trim() }
  Write-Host "Installing Visual Git $version for $env:USERNAME (no admin rights needed)..."

  Copy-App

  if (-not $NodeZip) { $NodeZip = Find-Beside 'node-v*-win-*.zip' }
  if ($NodeZip) {
    Install-PrivateNode $NodeZip
  } elseif (Test-Path (Join-Path $InstallDir 'runtime\node\node.exe')) {
    Write-Step 'Node.js: using the private copy from an earlier install.'
  } elseif (Test-SystemNode) {
    Write-Step 'Node.js: using the one already on this computer.'
  } else {
    Install-PrivateNode $null
  }

  if (-not $GitZip) { $GitZip = Find-Beside 'MinGit-*.zip' }
  if ($GitZip) {
    Install-PrivateGit $GitZip
  } elseif (Test-Path (Join-Path $InstallDir 'runtime\git\cmd\git.exe')) {
    Write-Step 'Git: using the private copy from an earlier install.'
  } elseif (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Step 'Git: using the one already on this computer.'
  } else {
    Install-PrivateGit $null
  }

  Set-GitIdentity

  if (-not $NoPath) {
    if (Add-UserPath $InstallDir) { Write-Step 'Added the "visualgit" command to your PATH.' }
    else { Write-Step 'The "visualgit" command was already on your PATH.' }
  }
  if (-not $NoShortcut) { New-StartMenuShortcut }

  Write-Host ''
  Write-Host 'Done. Two ways to open it:'
  Write-Host '  * Start Menu > Visual Git, then pick a project folder.'
  Write-Host '  * Open a NEW terminal in a project folder and type:  visualgit'
  exit 0
}
catch {
  Write-Host ''
  Write-Host "Install stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Nothing outside your user profile was changed.'
  Write-Host 'If this computer blocks downloads, see the "No internet" section of README.txt.'
  exit 1
}
