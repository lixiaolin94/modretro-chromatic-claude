# A thin PowerShell entrypoint. The Node coordinator owns prerequisite checks
# and delegates installation to the existing supported setup scripts.
[CmdletBinding(PositionalBinding = $false)]
param(
    [string] $ToolchainRoot,
    [string] $PayloadRoot,
    [string] $MarketplaceRoot,
    [string] $MarketplaceName,
    [string] $Python,
    [switch] $WithDesktop,
    [switch] $SkipEmulator,
    [switch] $UseExisting,
    [switch] $ReplaceLink,
    [switch] $DryRun,
    [switch] $Json,
    [switch] $Help
)

$ErrorActionPreference = 'Stop'

function Resolve-GbSetupPhysicalPath {
    param([string] $Candidate, [int] $Depth = 0)
    if ($Depth -gt 32) { throw 'Too many filesystem links while locating Node.js.' }
    $gbSetupProviderPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Candidate)
    $gbSetupFullPath = [System.IO.Path]::GetFullPath($gbSetupProviderPath)
    $gbSetupRoot = [System.IO.Path]::GetPathRoot($gbSetupFullPath)
    $gbSetupParts = @($gbSetupFullPath.Substring($gbSetupRoot.Length) -split '[\\/]' | Where-Object { $_ -ne '' })
    $gbSetupCurrent = $gbSetupRoot
    for ($gbSetupIndex = 0; $gbSetupIndex -lt $gbSetupParts.Length; $gbSetupIndex++) {
        $gbSetupCurrent = Join-Path $gbSetupCurrent $gbSetupParts[$gbSetupIndex]
        $gbSetupItem = Get-Item -LiteralPath $gbSetupCurrent -Force
        if (($gbSetupItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { continue }
        $gbSetupTarget = @($gbSetupItem.Target)[0]
        if ([string]::IsNullOrWhiteSpace($gbSetupTarget)) { throw 'An executable path uses an unsupported reparse point.' }
        if ($gbSetupTarget.StartsWith('\??\')) { $gbSetupTarget = $gbSetupTarget.Substring(4) }
        if ($gbSetupTarget.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
            $gbSetupTarget = '\\' + $gbSetupTarget.Substring(8)
        } elseif ($gbSetupTarget.StartsWith('\\?\')) {
            $gbSetupTarget = $gbSetupTarget.Substring(4)
        }
        if (-not [System.IO.Path]::IsPathRooted($gbSetupTarget)) {
            $gbSetupTarget = Join-Path ([System.IO.Path]::GetDirectoryName($gbSetupCurrent)) $gbSetupTarget
        }
        for ($gbSetupRest = $gbSetupIndex + 1; $gbSetupRest -lt $gbSetupParts.Length; $gbSetupRest++) {
            $gbSetupTarget = Join-Path $gbSetupTarget $gbSetupParts[$gbSetupRest]
        }
        return Resolve-GbSetupPhysicalPath -Candidate $gbSetupTarget -Depth ($Depth + 1)
    }
    return $gbSetupCurrent
}

function Test-GbSetupWithinRoot {
    param([string] $Root, [string] $Candidate)
    $gbSetupPrefix = $Root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    return $Candidate.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase) -or
        $Candidate.StartsWith($gbSetupPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

if ($env:OS -ne 'Windows_NT') {
    throw 'This entrypoint supports Windows x64. Use the existing npm setup:compiler and setup:emulator commands on macOS/Linux.'
}
if ((Get-Location).Provider.Name -ne 'FileSystem') {
    throw 'Run ModRetro Chromatic setup from a filesystem directory in PowerShell.'
}

$gbSetupSource = Resolve-GbSetupPhysicalPath -Candidate (Join-Path $PSScriptRoot '..')
$gbSetupWorkingDirectory = Resolve-GbSetupPhysicalPath -Candidate (Get-Location).ProviderPath
$gbSetupRejectedRoots = @($gbSetupSource, $gbSetupWorkingDirectory)
if (-not [string]::IsNullOrWhiteSpace($env:GB_STUDIO_PROJECT_ROOT)) {
    try { $gbSetupRejectedRoots += Resolve-GbSetupPhysicalPath -Candidate $env:GB_STUDIO_PROJECT_ROOT } catch { }
}
$gbSetupToolchain = $gbSetupSource
if (-not [string]::IsNullOrWhiteSpace($ToolchainRoot)) {
    $gbSetupToolchain = Resolve-GbSetupPhysicalPath -Candidate $ToolchainRoot
} elseif (-not [string]::IsNullOrWhiteSpace($env:GB_STUDIO_TOOLCHAIN_ROOT)) {
    $gbSetupToolchain = Resolve-GbSetupPhysicalPath -Candidate $env:GB_STUDIO_TOOLCHAIN_ROOT
}
$gbSetupRejectedRoots += $gbSetupToolchain
$gbSetupLocal = Join-Path $gbSetupToolchain '.local'
$gbSetupLocalEntries = @(Get-ChildItem -LiteralPath $gbSetupToolchain -Force | Where-Object { $_.Name -ieq '.local' })
if ($gbSetupLocalEntries.Length -gt 1) { throw 'The game toolchain has ambiguous .local directory entries.' }
if ($gbSetupLocalEntries.Length -eq 1) {
    $gbSetupPhysicalLocal = Resolve-GbSetupPhysicalPath -Candidate $gbSetupLocal
    if (-not [System.IO.Path]::GetFileName($gbSetupPhysicalLocal).Equals('.local', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'A linked game toolchain must resolve to an actual .local directory.'
    }
    $gbSetupLocalItem = Get-Item -LiteralPath $gbSetupPhysicalLocal -Force
    if (-not $gbSetupLocalItem.PSIsContainer) { throw 'The toolchain .local path must be a directory.' }
    $gbSetupRejectedRoots += $gbSetupPhysicalLocal
    $gbSetupRejectedRoots += [System.IO.Path]::GetDirectoryName($gbSetupPhysicalLocal)
}
# Native processes do not always share PowerShell's runspace location. Forward
# explicit absolute selections instead of relying on a process-wide cwd.
$ToolchainRoot = $gbSetupToolchain
if (-not [string]::IsNullOrWhiteSpace($PayloadRoot)) {
    $PayloadRoot = [System.IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PayloadRoot))
}
if (-not [string]::IsNullOrWhiteSpace($MarketplaceRoot)) {
    $MarketplaceRoot = [System.IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($MarketplaceRoot))
}

$gbSetupNode = $null
foreach ($gbSetupRawDirectory in ($env:PATH -split ';')) {
    $gbSetupDirectory = $gbSetupRawDirectory.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($gbSetupDirectory) -or -not [System.IO.Path]::IsPathRooted($gbSetupDirectory)) { continue }
    try {
        $gbSetupCandidate = Resolve-GbSetupPhysicalPath -Candidate (Join-Path $gbSetupDirectory 'node.exe')
        $gbSetupNodeItem = Get-Item -LiteralPath $gbSetupCandidate -Force
        if ($gbSetupNodeItem.PSIsContainer -or (($gbSetupNodeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { continue }
        $gbSetupRejected = $false
        foreach ($gbSetupRoot in $gbSetupRejectedRoots) {
            if (Test-GbSetupWithinRoot -Root $gbSetupRoot -Candidate $gbSetupCandidate) { $gbSetupRejected = $true; break }
        }
        if ($gbSetupRejected) { continue }
        $gbSetupNode = $gbSetupCandidate
        break
    } catch {
        # Never substitute node.cmd, an alias, or a checkout-controlled executable.
    }
}
if ($null -eq $gbSetupNode) {
    throw 'Install a current supported Node.js 22 or 24 LTS distribution with npm, reopen PowerShell, and rerun setup. A trusted node.exe on an absolute PATH entry outside this checkout is required.'
}

$gbSetupArguments = @()
foreach ($gbSetupOption in @(
    @('--toolchain-root', $ToolchainRoot),
    @('--payload-root', $PayloadRoot),
    @('--marketplace-root', $MarketplaceRoot),
    @('--marketplace-name', $MarketplaceName),
    @('--python', $Python)
)) {
    if (-not [string]::IsNullOrWhiteSpace($gbSetupOption[1])) { $gbSetupArguments += $gbSetupOption }
}
foreach ($gbSetupFlag in @(
    @('--with-desktop', $WithDesktop),
    @('--skip-emulator', $SkipEmulator),
    @('--use-existing', $UseExisting),
    @('--replace-link', $ReplaceLink),
    @('--dry-run', $DryRun),
    @('--json', $Json),
    @('--help', $Help)
)) {
    if ($gbSetupFlag[1]) { $gbSetupArguments += $gbSetupFlag[0] }
}

# These affect Node before our JavaScript can sanitize subprocess environments.
$gbSetupSavedNodeOptions = [Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
$gbSetupSavedNodePath = [Environment]::GetEnvironmentVariable('NODE_PATH', 'Process')
$gbSetupExitCode = 1
try {
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_PATH', $null, 'Process')
    & $gbSetupNode (Join-Path $PSScriptRoot 'setup-windows.mjs') @gbSetupArguments
    $gbSetupExitCode = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $gbSetupSavedNodeOptions, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_PATH', $gbSetupSavedNodePath, 'Process')
}
exit $gbSetupExitCode
