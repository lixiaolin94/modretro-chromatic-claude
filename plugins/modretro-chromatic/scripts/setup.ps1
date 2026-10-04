#requires -Version 5.1
# Packaged, Node-independent Windows entrypoint. Do not add a param block:
# PowerShell's parameter binder must not reinterpret the shared --option argv.
# Doctor/plan never install. Node --version is only a bootstrap prerequisite
# check; named component probes belong to setup.mjs and require --probes.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$gbSetupOriginalArguments = [string[]] @($args)
$script:gbSetupJson = $gbSetupOriginalArguments -ccontains '--json'
$script:gbSetupStage = $null
$script:gbSetupCleanupError = $null
$script:gbSetupBootstrapInstalled = $false
$script:gbSetupPendingLock = $null
$script:gbSetupLockAcquired = $false
$script:gbSetupVersionChecked = $false
$script:gbSetupDetectedVersion = ''
$script:gbSetupNodeStatus = 'missing'
$script:gbSetupExitCode = 1
$gbSetupOwner = 'codex-gb-studio-setup'

function Read-GbSetupArguments {
    param([string[]] $Arguments)
    if ($null -eq $Arguments) { $Arguments = @() }
    $gbParsed = [ordered] @{
        Command = 'doctor'; OriginalCommand = 'doctor'; Root = $null
        Components = 'runtime,build,emulator'; Probes = ''; Json = $false
        Yes = $false; DryRun = $false; Help = $false
    }
    $gbSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $gbIndex = 0
    if ($Arguments.Count -gt 0 -and -not $Arguments[0].StartsWith('--') -and $Arguments[0] -cne '-h') {
        if (@('doctor', 'plan', 'apply') -cnotcontains $Arguments[0]) {
            throw 'Expected doctor, plan, or apply as the first argument.'
        }
        $gbParsed.Command = $Arguments[0]
        $gbParsed.OriginalCommand = $Arguments[0]
        $gbIndex = 1
    }
    while ($gbIndex -lt $Arguments.Count) {
        $gbFlag = $Arguments[$gbIndex]
        if ($gbFlag -ceq '-h') { $gbFlag = '--help' }
        if (-not $gbSeen.Add($gbFlag)) { throw "Duplicate argument: $gbFlag" }
        switch -CaseSensitive ($gbFlag) {
            { $_ -ceq '--root' -or $_ -ceq '--components' -or $_ -ceq '--probes' } {
                $gbIndex++
                if ($gbIndex -ge $Arguments.Count -or [string]::IsNullOrWhiteSpace($Arguments[$gbIndex]) -or $Arguments[$gbIndex].StartsWith('--')) {
                    throw "$gbFlag requires a separate nonempty value."
                }
                switch -CaseSensitive ($gbFlag) {
                    '--root' { $gbParsed.Root = $Arguments[$gbIndex] }
                    '--components' { $gbParsed.Components = $Arguments[$gbIndex] }
                    '--probes' { $gbParsed.Probes = $Arguments[$gbIndex] }
                }
            }
            '--json' { $gbParsed.Json = $true }
            '--yes' { $gbParsed.Yes = $true }
            '--dry-run' { $gbParsed.DryRun = $true }
            '--help' { $gbParsed.Help = $true }
            default { throw "Unknown argument: $gbFlag. Use --help for supported options." }
        }
        $gbIndex++
    }
    foreach ($gbList in @(
        @{ Name = '--components'; Value = $gbParsed.Components; Allowed = @('runtime', 'build', 'emulator', 'desktop') },
        @{ Name = '--probes'; Value = $gbParsed.Probes; Allowed = @('cli-version', 'gbdk-version', 'emulator-import') }
    )) {
        if ($gbList.Name -ceq '--probes' -and $gbList.Value -ceq '') { continue }
        $gbItems = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        foreach ($gbItem in ($gbList.Value -split ',')) {
            if ($gbList.Allowed -cnotcontains $gbItem -or -not $gbItems.Add($gbItem)) {
                throw "Invalid or duplicate value in $($gbList.Name): $gbItem"
            }
        }
    }
    if ($gbParsed.DryRun) { $gbParsed.Command = 'plan' }
    if ($gbParsed.Probes -cne '' -and $gbParsed.Command -cne 'doctor') {
        throw '--probes is available only for doctor, never plan or --dry-run.'
    }
    if ($gbParsed.Yes -and $gbParsed.OriginalCommand -cne 'apply') {
        throw '--yes is supported only with apply; doctor and plan never install.'
    }
    if ($gbParsed.Command -ceq 'apply' -and -not $gbParsed.Yes -and -not $gbParsed.Help) {
        throw 'apply requires --yes after reviewing the plan and its sources/destinations.'
    }
    return [pscustomobject] $gbParsed
}

function Write-GbSetupHelp {
    @'
ModRetro Chromatic dependency setup (Windows x64, PowerShell 5.1+)

  powershell.exe -NoProfile -File scripts/setup.ps1 [doctor|plan|apply] [options]

  --root PATH               Absolute, owned dependency root (outside the plugin)
                            Default: GB_STUDIO_SETUP_ROOT, otherwise
                            LOCALAPPDATA\modretro-chromatic
  --components LIST         runtime,build,emulator,desktop (default: first three)
  --probes LIST             doctor only: cli-version,gbdk-version,emulator-import
  --yes                     Explicit permission for apply downloads/changes
  --json                    Machine-readable report
  --dry-run                 Plan only; never install or run component probes
  --help, -h                Show this help

Doctor/plan do not install, create the root, or change PATH/profiles. A runnable
Node 22+ is needed for complete discovery. If it is absent, this launcher reports
only bootstrap readiness and the exact pinned official Node source/destination.
An apply with --yes may install that Node into the selected owned root, then
delegate the original arguments to the shared dependency manager. The desktop
editor is optional and is not needed to build/play through the plugin.
'@
}

function Test-GbSetupWithinRoot {
    param([string] $Root, [string] $Candidate)
    $gbPrefix = $Root.TrimEnd('\', '/') + '\'
    return $Candidate.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase) -or
        $Candidate.StartsWith($gbPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-GbSetupPhysicalPath {
    param([string] $Path, [int] $Depth = 0)
    if ($Depth -gt 32) { throw 'Too many reparse points while resolving a package or executable path.' }
    $gbFullPath = [System.IO.Path]::GetFullPath($Path)
    $gbVolume = [System.IO.Path]::GetPathRoot($gbFullPath)
    $gbCurrent = $gbVolume
    $gbParts = @($gbFullPath.Substring($gbVolume.Length) -split '[\\/]' | Where-Object { $_ -cne '' })
    for ($gbIndex = 0; $gbIndex -lt $gbParts.Count; $gbIndex++) {
        $gbCurrent = [System.IO.Path]::Combine($gbCurrent, $gbParts[$gbIndex])
        $gbItem = Get-Item -LiteralPath $gbCurrent -Force
        if (($gbItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { continue }
        $gbTargets = @($gbItem.Target)
        $gbTarget = [string] $gbTargets[0]
        if ([string]::IsNullOrWhiteSpace($gbTarget)) { throw "Unsupported reparse point: $gbCurrent" }
        if ($gbTarget.StartsWith('\??\')) { $gbTarget = $gbTarget.Substring(4) }
        if ($gbTarget.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
            $gbTarget = '\\' + $gbTarget.Substring(8)
        } elseif ($gbTarget.StartsWith('\\?\')) { $gbTarget = $gbTarget.Substring(4) }
        if (-not [System.IO.Path]::IsPathRooted($gbTarget)) {
            $gbTarget = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($gbCurrent), $gbTarget)
        }
        for ($gbRest = $gbIndex + 1; $gbRest -lt $gbParts.Count; $gbRest++) {
            $gbTarget = [System.IO.Path]::Combine($gbTarget, $gbParts[$gbRest])
        }
        return Resolve-GbSetupPhysicalPath -Path $gbTarget -Depth ($Depth + 1)
    }
    return $gbCurrent
}

function Get-GbSetupLocalPath {
    param([string] $Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate) -or $Candidate -notmatch '^[A-Za-z]:[\\/]') {
        throw '--root must be an absolute local filesystem path, not a relative, UNC, device, or provider path.'
    }
    if ($Candidate -match '[<>"|?*\x00-\x1f]' -or $Candidate.Substring(2).Contains(':')) {
        throw 'Setup paths must not contain control characters, wildcards, device syntax, or alternate data streams.'
    }
    $gbPieces = $Candidate.Substring(3) -split '[\\/]'
    for ($gbPartIndex = 0; $gbPartIndex -lt $gbPieces.Count; $gbPartIndex++) {
        $gbPart = $gbPieces[$gbPartIndex]
        if ($gbPart -ceq '' -and $gbPartIndex -eq $gbPieces.Count - 1) { continue }
        if ($gbPart -ceq '' -or $gbPart -ceq '.' -or $gbPart -ceq '..' -or $gbPart -match '[ .]$' -or
            $gbPart -match '^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw 'Setup paths must not contain empty/dot components, reserved device names, or trailing dots/spaces.'
        }
    }
    return [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
}

function Assert-GbSetupNoReparsePoints {
    param([string] $Path, [switch] $Directory)
    $gbVolume = [System.IO.Path]::GetPathRoot($Path)
    $gbCurrent = $gbVolume
    $gbParts = @($Path.Substring($gbVolume.Length) -split '[\\/]' | Where-Object { $_ -cne '' })
    $gbPaths = @($gbVolume)
    foreach ($gbPart in $gbParts) {
        $gbCurrent = [System.IO.Path]::Combine($gbCurrent, $gbPart)
        $gbPaths += $gbCurrent
    }
    for ($gbPathIndex = 0; $gbPathIndex -lt $gbPaths.Count; $gbPathIndex++) {
        $gbCurrent = $gbPaths[$gbPathIndex]
        try { $gbAttributes = [System.IO.File]::GetAttributes($gbCurrent) }
        catch [System.IO.FileNotFoundException] { continue }
        catch [System.IO.DirectoryNotFoundException] { continue }
        if (($gbAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing a reparse-point path: $gbCurrent"
        }
        if (($Directory -or $gbPathIndex -lt $gbPaths.Count - 1) -and
            ($gbAttributes -band [System.IO.FileAttributes]::Directory) -eq 0) {
            throw "Expected a directory, not an existing file: $gbCurrent"
        }
    }
}

function Read-GbSetupJsonFile {
    param([string] $Path, [int] $MaxBytes = 8192)
    Assert-GbSetupNoReparsePoints -Path $Path
    $gbFile = Get-Item -LiteralPath $Path -Force
    if ($gbFile.PSIsContainer -or $gbFile.Length -gt $MaxBytes) { throw "Invalid setup receipt: $Path" }
    return [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
}

function Test-GbSetupOwner {
    param($Receipt)
    try {
        return $null -ne $Receipt -and ($Receipt.schemaVersion -is [int] -or $Receipt.schemaVersion -is [long]) -and
            $Receipt.schemaVersion -eq 1 -and $Receipt.owner -ceq 'codex-gb-studio-setup'
    } catch { return $false }
}

function Assert-GbSetupRoot {
    param([string] $Root)
    Assert-GbSetupNoReparsePoints -Path $Root -Directory
    $gbMarker = [System.IO.Path]::Combine($Root, '.gb-studio-setup.json')
    Assert-GbSetupNoReparsePoints -Path $gbMarker
    if ([System.IO.File]::Exists($gbMarker) -or [System.IO.Directory]::Exists($gbMarker)) {
        if (-not (Test-GbSetupOwner (Read-GbSetupJsonFile -Path $gbMarker -MaxBytes 256))) {
            throw "Invalid ownership marker; will not adopt or modify $Root"
        }
    } elseif ([System.IO.Directory]::Exists($Root)) {
        if (@(Get-ChildItem -LiteralPath $Root -Force | Select-Object -First 1).Count -gt 0) {
            throw "Existing --root is not empty or setup-owned: $Root. Select a new empty directory."
        }
    }
}

function Write-GbSetupJsonNew {
    param([string] $Path, $Value)
    Assert-GbSetupNoReparsePoints -Path $Path
    $gbStream = $null
    try {
        $gbStream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $gbBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 12) + "`n")
        $gbStream.Write($gbBytes, 0, $gbBytes.Length)
        $gbStream.Flush($true)
    } finally {
        if ($null -ne $gbStream) { $gbStream.Dispose() }
    }
}

function Get-GbSetupHash {
    param([string] $Path)
    $gbStream = $null
    $gbHash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $gbStream = [System.IO.File]::OpenRead($Path)
        return [System.BitConverter]::ToString($gbHash.ComputeHash($gbStream)).Replace('-', '').ToLowerInvariant()
    } finally {
        if ($null -ne $gbStream) { $gbStream.Dispose() }
        $gbHash.Dispose()
    }
}

function Get-GbSetupNodeVersion {
    param([string] $Executable)
    $script:gbSetupVersionChecked = $true
    $script:gbSetupDetectedVersion = ''
    $gbProcess = New-Object System.Diagnostics.Process
    try {
        $gbProcess.StartInfo.FileName = $Executable
        $gbProcess.StartInfo.Arguments = '--version'
        $gbProcess.StartInfo.UseShellExecute = $false
        $gbProcess.StartInfo.CreateNoWindow = $true
        $gbProcess.StartInfo.RedirectStandardOutput = $true
        $gbProcess.StartInfo.RedirectStandardError = $true
        $gbProcess.StartInfo.EnvironmentVariables.Remove('NODE_OPTIONS')
        $gbProcess.StartInfo.EnvironmentVariables.Remove('NODE_PATH')
        if (-not $gbProcess.Start()) { return $false }
        $gbOutputTask = $gbProcess.StandardOutput.ReadToEndAsync()
        $gbErrorTask = $gbProcess.StandardError.ReadToEndAsync()
        if (-not $gbProcess.WaitForExit(10000)) {
            $gbProcess.Kill()
            $gbProcess.WaitForExit()
            return $false
        }
        $gbOutput = $gbOutputTask.GetAwaiter().GetResult().Trim()
        $null = $gbErrorTask.GetAwaiter().GetResult()
        if ($gbProcess.ExitCode -ne 0 -or $gbOutput -cnotmatch '^v([0-9]+)\.([0-9]+)\.([0-9]+)$') { return $false }
        $script:gbSetupDetectedVersion = $gbOutput
        return [int64] $Matches[1] -ge 22
    } catch {
        return $false
    } finally {
        # This process was started by this check; never stop another task's Node.
        try { if ($gbProcess.Id -gt 0 -and -not $gbProcess.HasExited) { $gbProcess.Kill(); $gbProcess.WaitForExit() } } catch { }
        $gbProcess.Dispose()
    }
}

function Test-GbSetupManagedNode {
    param([string] $Directory, [string] $Executable, [string] $ReceiptPath, $Release)
    try {
        Assert-GbSetupNoReparsePoints -Path $Directory -Directory
        Assert-GbSetupNoReparsePoints -Path $Executable
        $gbReceipt = Read-GbSetupJsonFile -Path $ReceiptPath
        if (-not (Test-GbSetupOwner $gbReceipt) -or $gbReceipt.platform -cne 'win32-x64' -or
            $gbReceipt.version -cne $Release.version -or $gbReceipt.sourceUrl -cne $Release.url -or
            $gbReceipt.archiveSha256 -cne $Release.sha256 -or
            -not [string]::Equals($gbReceipt.executablePath, $Executable, [System.StringComparison]::OrdinalIgnoreCase) -or
            $gbReceipt.executableSha256 -cnotmatch '^[0-9a-f]{64}$' -or
            (Get-GbSetupHash $Executable) -cne $gbReceipt.executableSha256) { return $false }
        $gbNpm = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($Executable), 'node_modules\npm\bin\npm-cli.js')
        Assert-GbSetupNoReparsePoints -Path $gbNpm
        if (-not [System.IO.File]::Exists($gbNpm)) { return $false }
        return (Get-GbSetupNodeVersion $Executable) -and $script:gbSetupDetectedVersion -ceq "v$($Release.version)"
    } catch {
        return $false
    }
}

function Invoke-GbSetupManager {
    param([string] $Executable, [string] $Manager, [string[]] $Arguments)
    $gbOldOptions = [Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
    $gbOldPath = [Environment]::GetEnvironmentVariable('NODE_PATH', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
        [Environment]::SetEnvironmentVariable('NODE_PATH', $null, 'Process')
        # Avoid PS7 native-error preferences changing the manager's exit status.
        $PSNativeCommandUseErrorActionPreference = $false
        & $Executable $Manager @Arguments
        $script:gbSetupExitCode = $LASTEXITCODE
    } finally {
        [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $gbOldOptions, 'Process')
        [Environment]::SetEnvironmentVariable('NODE_PATH', $gbOldPath, 'Process')
    }
}

function Write-GbSetupBootstrapReport {
    param($Options, $Release, [string] $Root, [string] $Executable, [string] $ScriptPath)
    $gbReport = [ordered] @{
        schemaVersion = 1; bootstrapOnly = $true; command = $Options.Command
        setupRoot = $Root; selectedComponents = $Options.Components
        runtime = [ordered] @{
            status = $script:gbSetupNodeStatus; requiredVersion = '>=22'
            managedVersion = $Release.version; detectedVersion = $script:gbSetupDetectedVersion
            platform = 'win32-x64'; sourceUrl = $Release.url; archiveSha256 = $Release.sha256
            executablePath = $Executable
        }
        bootstrapVersionCheckPerformed = $script:gbSetupVersionChecked
        componentProbesExecuted = @(); requestedProbes = $Options.Probes
        nextCommand = @('powershell.exe', '-NoProfile', '-File', $ScriptPath, 'apply', '--root', $Root, '--components', $Options.Components, '--yes')
        note = 'Bootstrap only: complete dependency discovery requires Node 22+. No component probe or installation was performed.'
    }
    if ($Options.Json) {
        $gbReport | ConvertTo-Json -Depth 12
        return
    }
    Write-Output "Node runtime: $($script:gbSetupNodeStatus) (required >=22; managed $($Release.version))"
    if ($script:gbSetupDetectedVersion -cne '') { Write-Output "Detected version: $($script:gbSetupDetectedVersion)" }
    Write-Output "Dependency root: $Root"
    Write-Output "Official source: $($Release.url)"
    Write-Output "SHA-256: $($Release.sha256)"
    Write-Output "Destination: $Executable"
    Write-Output 'After reviewing the plan, permit setup explicitly:'
    $gbQuoted = @($gbReport.nextCommand | ForEach-Object { "'" + $_.Replace("'", "''") + "'" })
    Write-Output ('  & ' + ($gbQuoted -join ' '))
    Write-Output $gbReport.note
    if ($script:gbSetupVersionChecked) { Write-Output 'Only Node --version was used to check the bootstrap prerequisite.' }
    if ($Options.Probes -cne '') { Write-Output "Requested component probes are unavailable until Node is ready: $($Options.Probes)" }
}

function Enter-GbSetupLock {
    param([string] $Root)
    $gbLock = [System.IO.Path]::Combine($Root, '.setup-lock')
    Assert-GbSetupNoReparsePoints -Path $gbLock -Directory
    $gbToken = [guid]::NewGuid().ToString('N')
    $gbClaim = [System.IO.Path]::Combine($Root, ".setup-lock.claim-$PID-$gbToken")
    Assert-GbSetupNoReparsePoints -Path $gbClaim -Directory
    if ([System.IO.Directory]::Exists($gbClaim) -or [System.IO.File]::Exists($gbClaim)) { throw 'Unexpected existing lock claim; no path was replaced.' }
    $script:gbSetupPendingLock = [pscustomobject] @{ Path = $gbLock; Token = $gbToken }
    $gbClaimCreated = $false
    try {
        $null = [System.IO.Directory]::CreateDirectory($gbClaim)
        $gbClaimCreated = $true
        $gbOwner = [ordered] @{
            schemaVersion = 1; pid = $PID; startedAt = [DateTime]::UtcNow.ToString('o')
            owner = 'codex-gb-studio-setup'; phase = 'node-bootstrap'; token = $gbToken
        }
        Write-GbSetupJsonNew -Path ([System.IO.Path]::Combine($gbClaim, 'owner.json')) -Value $gbOwner
        # Same-root directory rename acquires the lock atomically and publishes
        # its owner in the same operation. It never merges into an existing lock.
        try { [System.IO.Directory]::Move($gbClaim, $gbLock) }
        catch {
            throw "Another setup owns $gbLock, or the lock could not be acquired. Inspect owner.json and wait for that operation. Never remove a live lock; verify its process has stopped before manually removing only a stale lock directory."
        }
        $script:gbSetupLockAcquired = $true
    } finally {
        # Also runs if writing owner.json fails or is cancelled. Remove only
        # this invocation's unique claim and expected file, never a peer lock.
        if ($gbClaimCreated -and [System.IO.Directory]::Exists($gbClaim)) {
            try {
                Assert-GbSetupNoReparsePoints -Path $gbClaim -Directory
                $gbClaimEntries = @(Get-ChildItem -LiteralPath $gbClaim -Force)
                if (@($gbClaimEntries | Where-Object { $_.Name -cne 'owner.json' -or $_.PSIsContainer }).Count -gt 0) {
                    throw "Unexpected lock-claim contents; retained $gbClaim"
                }
                $gbClaimOwner = [System.IO.Path]::Combine($gbClaim, 'owner.json')
                Assert-GbSetupNoReparsePoints -Path $gbClaimOwner
                [System.IO.File]::Delete($gbClaimOwner)
                [System.IO.Directory]::Delete($gbClaim, $false)
            } catch { $script:gbSetupCleanupError = $_.Exception.Message }
        }
    }
    return $script:gbSetupPendingLock
}

function Exit-GbSetupLock {
    param($Lock, [switch] $IgnoreUnowned)
    if ($null -eq $Lock) { return }
    Assert-GbSetupNoReparsePoints -Path $Lock.Path -Directory
    $gbOwnerPath = [System.IO.Path]::Combine($Lock.Path, 'owner.json')
    try { $gbOwner = Read-GbSetupJsonFile $gbOwnerPath }
    catch { if ($IgnoreUnowned) { return }; throw }
    if (-not (Test-GbSetupOwner $gbOwner) -or $gbOwner.pid -ne $PID -or $gbOwner.token -cne $Lock.Token) {
        if ($IgnoreUnowned) { return }
        throw "Setup lock ownership changed; retained $($Lock.Path) for inspection."
    }
    # No recursive deletion: an unexpected file keeps the directory intact.
    $gbEntries = @(Get-ChildItem -LiteralPath $Lock.Path -Force)
    if ($gbEntries.Count -ne 1 -or $gbEntries[0].Name -cne 'owner.json') {
        throw "Setup lock contents changed; retained $($Lock.Path) for inspection."
    }
    [System.IO.File]::Delete($gbOwnerPath)
    [System.IO.Directory]::Delete($Lock.Path, $false)
}

function Assert-GbSetupArchive {
    param([string] $Archive, [string] $Stem, [string] $Destination)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $gbZip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $gbSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        $gbTotalBytes = [int64] 0
        foreach ($gbEntry in $gbZip.Entries) {
            $gbName = $gbEntry.FullName.Replace('\', '/')
            if (-not $gbName.StartsWith("$Stem/", [System.StringComparison]::Ordinal) -or
                $gbName -match '(^|/)\.\.?(/|$)|[<>:"|?*\x00-\x1f]' -or
                $gbName.Contains('//') -or $gbName -match '(^|/)[^/]*[ .](/|$)' -or
                $gbName -match '(^|/)(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\.|/|$)' -or
                -not $gbSeen.Add($gbName.TrimEnd('/'))) {
                throw 'The authenticated Node archive has unexpected or duplicate extraction paths.'
            }
            if ((($gbEntry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000 -or
                ($gbEntry.ExternalAttributes -band 0x400) -ne 0) {
                throw 'The authenticated Node archive contains a link/reparse-point entry.'
            }
            $gbTarget = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Destination, $gbName.Replace('/', '\')))
            if (-not (Test-GbSetupWithinRoot -Root $Destination -Candidate $gbTarget)) {
                throw 'The authenticated Node archive escapes its owned staging directory.'
            }
            $gbTotalBytes += $gbEntry.Length
            if ($gbZip.Entries.Count -gt 50000 -or $gbEntry.Length -gt 536870912 -or $gbTotalBytes -gt 1073741824) {
                throw 'The authenticated Node archive exceeds bounded extraction limits.'
            }
        }
    } finally {
        $gbZip.Dispose()
    }
}

function Save-GbSetupDownload {
    param([string] $Url, [string] $Destination)
    $gbOldTls = [Net.ServicePointManager]::SecurityProtocol
    $gbRequest = $null
    $gbResponse = $null
    $gbInput = $null
    $gbOutput = $null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        # Inbox .NET Framework API keeps this usable before Node/.NET tooling
        # setup; no external downloader, shell command, or profile is required.
        $gbRequest = [Net.WebRequest]::CreateHttp($Url)
        $gbRequest.Method = 'GET'
        $gbRequest.AllowAutoRedirect = $false
        $gbRequest.UseDefaultCredentials = $false
        $gbRequest.Timeout = 30000
        $gbRequest.ReadWriteTimeout = 30000
        $gbRequest.UserAgent = 'codex-gb-studio-setup/1'
        $gbResponse = $gbRequest.GetResponse()
        if ([int] $gbResponse.StatusCode -ne 200) { throw 'The pinned official download did not return HTTP 200; redirects are not followed.' }
        if ($gbResponse.ContentLength -gt 268435456) { throw 'The Node download exceeds the 256 MiB bootstrap limit.' }
        Assert-GbSetupNoReparsePoints -Path $Destination
        $gbOutput = New-Object System.IO.FileStream($Destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $gbInput = $gbResponse.GetResponseStream()
        $gbBuffer = New-Object byte[] 65536
        $gbBytes = [int64] 0
        $gbTimer = [Diagnostics.Stopwatch]::StartNew()
        while ($true) {
            if ($gbTimer.Elapsed.TotalSeconds -gt 900) { throw 'The Node download exceeded its 15-minute time limit.' }
            $gbRead = $gbInput.Read($gbBuffer, 0, $gbBuffer.Length)
            if ($gbRead -eq 0) { break }
            $gbBytes += $gbRead
            if ($gbBytes -gt 268435456) { throw 'The Node download exceeds the 256 MiB bootstrap limit; partial bytes were retained.' }
            $gbOutput.Write($gbBuffer, 0, $gbRead)
        }
        $gbOutput.Flush($true)
    } finally {
        if ($null -ne $gbInput) { $gbInput.Dispose() }
        if ($null -ne $gbOutput) { $gbOutput.Dispose() }
        if ($null -ne $gbResponse) { $gbResponse.Dispose() }
        if ($null -ne $gbRequest) { $gbRequest.Abort() }
        [Net.ServicePointManager]::SecurityProtocol = $gbOldTls
    }
}

function Install-GbSetupNode {
    param([string] $Root, [string] $PlatformDirectory, [string] $Executable, [string] $ReceiptPath, $Release)
    $gbLock = $null
    $gbFailure = $null
    $gbStagePhase = 'root-preflight'
    try {
        # All parsing, immutable-root checks, catalog validation and discovery
        # finish before this first write, reached only through apply --yes.
        Assert-GbSetupRoot $Root
        $null = [System.IO.Directory]::CreateDirectory($Root)
        $gbLock = Enter-GbSetupLock $Root
        $gbMarkerPath = [System.IO.Path]::Combine($Root, '.gb-studio-setup.json')
        if (-not [System.IO.File]::Exists($gbMarkerPath)) {
            Assert-GbSetupNoReparsePoints -Path $gbMarkerPath
            if (@(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $_.Name -cne '.setup-lock' }).Count -gt 0) {
                throw 'The unmarked root gained contents during setup; it was not adopted. Select a new empty --root.'
            }
            Write-GbSetupJsonNew -Path $gbMarkerPath -Value ([ordered] @{ schemaVersion = 1; owner = 'codex-gb-studio-setup' })
        }
        Assert-GbSetupRoot $Root
        $gbStageRoot = [System.IO.Path]::Combine($Root, '.setup-staging')
        $gbNodeRoot = [System.IO.Path]::Combine($Root, 'node')
        Assert-GbSetupNoReparsePoints -Path $gbStageRoot -Directory
        Assert-GbSetupNoReparsePoints -Path $gbNodeRoot -Directory
        Assert-GbSetupNoReparsePoints -Path $PlatformDirectory -Directory
        if ([System.IO.Directory]::Exists($PlatformDirectory) -or [System.IO.File]::Exists($PlatformDirectory)) {
            throw 'The Node destination appeared during setup; it was not overwritten. Rerun doctor.'
        }
        $null = [System.IO.Directory]::CreateDirectory($gbStageRoot)
        $null = [System.IO.Directory]::CreateDirectory($gbNodeRoot)
        $script:gbSetupStage = [System.IO.Path]::Combine($gbStageRoot, "node-win32-x64.$([guid]::NewGuid().ToString('N'))")
        if ([System.IO.Directory]::Exists($script:gbSetupStage) -or [System.IO.File]::Exists($script:gbSetupStage)) {
            throw 'Unexpected existing staging directory; no path was replaced.'
        }
        $null = [System.IO.Directory]::CreateDirectory($script:gbSetupStage)
        $gbPartial = [System.IO.Path]::Combine($script:gbSetupStage, "$($Release.archive).partial")
        $gbArchive = [System.IO.Path]::Combine($script:gbSetupStage, $Release.archive)
        $gbPublish = [System.IO.Path]::Combine($script:gbSetupStage, 'publish')
        $gbStem = [System.IO.Path]::GetFileNameWithoutExtension($Release.archive)
        $gbStagePhase = 'download'
        [Console]::Error.WriteLine("ModRetro Chromatic setup: installing authenticated Node $($Release.version) into $PlatformDirectory")
        # No redirects or unbounded body writes. Each retry uses a new partial
        # path, so a failed/cancelled download never becomes a reused cache hit.
        Save-GbSetupDownload -Url $Release.url -Destination $gbPartial
        $gbStagePhase = 'archive-validation'
        Assert-GbSetupNoReparsePoints -Path $gbPartial
        if ((Get-Item -LiteralPath $gbPartial).Length -gt 268435456 -or (Get-GbSetupHash $gbPartial) -cne $Release.sha256) {
            throw 'Node archive size/SHA-256 mismatch. The unique staging download is quarantined; nothing was installed.'
        }
        [System.IO.File]::Move($gbPartial, $gbArchive)
        Assert-GbSetupArchive -Archive $gbArchive -Stem $gbStem -Destination $gbPublish
        $gbStagePhase = 'extract'
        Microsoft.PowerShell.Archive\Expand-Archive -LiteralPath $gbArchive -DestinationPath $gbPublish -ErrorAction Stop
        $gbStagedVersion = [System.IO.Path]::Combine($gbPublish, $gbStem)
        $gbStagedExecutable = [System.IO.Path]::Combine($gbStagedVersion, 'node.exe')
        $gbStagedNpm = [System.IO.Path]::Combine($gbStagedVersion, 'node_modules\npm\bin\npm-cli.js')
        $gbDirectories = New-Object 'System.Collections.Generic.Queue[string]'
        $gbDirectories.Enqueue($gbPublish)
        while ($gbDirectories.Count -gt 0) {
            $gbDirectory = $gbDirectories.Dequeue()
            Assert-GbSetupNoReparsePoints -Path $gbDirectory -Directory
            foreach ($gbEntry in @(Get-ChildItem -LiteralPath $gbDirectory -Force)) {
                if (($gbEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Extracted Node contains an unexpected reparse point.' }
                if ($gbEntry.PSIsContainer) { $gbDirectories.Enqueue($gbEntry.FullName) }
            }
        }
        Assert-GbSetupNoReparsePoints -Path $gbStagedExecutable
        Assert-GbSetupNoReparsePoints -Path $gbStagedNpm
        if (-not [System.IO.File]::Exists($gbStagedExecutable) -or -not [System.IO.File]::Exists($gbStagedNpm)) {
            throw 'The authenticated Node distribution is missing node.exe or its npm CLI.'
        }
        $gbStagePhase = 'runtime-validation'
        if (-not (Get-GbSetupNodeVersion $gbStagedExecutable) -or $script:gbSetupDetectedVersion -cne "v$($Release.version)") {
            throw 'The authenticated Node distribution could not run with its pinned version on this host.'
        }
        $gbReceipt = [ordered] @{
            schemaVersion = 1; owner = 'codex-gb-studio-setup'; platform = 'win32-x64'
            version = $Release.version; sourceUrl = $Release.url; archiveSha256 = $Release.sha256
            executablePath = $Executable; executableSha256 = Get-GbSetupHash $gbStagedExecutable
            installedAt = [DateTime]::UtcNow.ToString('o')
        }
        Write-GbSetupJsonNew -Path ([System.IO.Path]::Combine($gbPublish, 'receipt.json')) -Value $gbReceipt
        $gbStagePhase = 'publish'
        Assert-GbSetupNoReparsePoints -Path $PlatformDirectory -Directory
        if ([System.IO.Directory]::Exists($PlatformDirectory) -or [System.IO.File]::Exists($PlatformDirectory)) {
            throw 'The Node destination appeared during setup; it was not overwritten.'
        }
        # Publish the version folder and its receipt together. Directory.Move
        # fails if the target exists; it never merges or replaces another tree.
        [System.IO.Directory]::Move($gbPublish, $PlatformDirectory)
        $script:gbSetupBootstrapInstalled = $true
        $gbStagePhase = 'receipt-validation'
        if (-not (Test-GbSetupManagedNode -Directory $PlatformDirectory -Executable $Executable -ReceiptPath $ReceiptPath -Release $Release)) {
            throw 'Published Node or its receipt failed validation. Preserve the installed directory for inspection.'
        }
    } catch {
        $gbFailure = $_
        if ($null -ne $script:gbSetupStage -and [System.IO.Directory]::Exists($script:gbSetupStage)) {
            try {
                Write-GbSetupJsonNew -Path ([System.IO.Path]::Combine($script:gbSetupStage, 'failure.json')) -Value ([ordered] @{
                    schemaVersion = 1; owner = 'codex-gb-studio-setup'; phase = $gbStagePhase
                    failedAt = [DateTime]::UtcNow.ToString('o'); error = $_.Exception.Message
                    bootstrapInstalled = $script:gbSetupBootstrapInstalled
                    retry = 'After resolving the error, rerun the same explicit apply command. A new staging path is used; no partial archive is reused.'
                })
            } catch { }
        }
    } finally {
        if ($null -ne $script:gbSetupPendingLock) {
            try { Exit-GbSetupLock -Lock $script:gbSetupPendingLock -IgnoreUnowned:(-not $script:gbSetupLockAcquired) }
            catch { $script:gbSetupCleanupError = $_.Exception.Message }
            $script:gbSetupPendingLock = $null
            $script:gbSetupLockAcquired = $false
        }
        if ($null -ne $script:gbSetupStage -and (-not $script:gbSetupBootstrapInstalled -or $null -ne $gbFailure -or $null -ne $script:gbSetupCleanupError)) {
            [Console]::Error.WriteLine("ModRetro Chromatic setup: failed/cancelled staging retained at $($script:gbSetupStage). Retry uses a new path, never a cached partial.")
        }
    }
    if ($null -ne $gbFailure) { throw $gbFailure }
    if ($null -ne $script:gbSetupCleanupError) { throw 'Node bootstrap finished, but owned lock cleanup failed; the manager was not started.' }
}

try {
    $gbSetupOptions = Read-GbSetupArguments $gbSetupOriginalArguments
    $script:gbSetupJson = $gbSetupOptions.Json
    if ($gbSetupOptions.Help) { Write-GbSetupHelp; exit 0 }
    if ($env:OS -cne 'Windows_NT') { throw 'This launcher supports Windows x64. Use scripts/setup.sh on macOS/Linux.' }
    $gbSetupArchitecture = $env:PROCESSOR_ARCHITECTURE
    if (-not [string]::IsNullOrWhiteSpace($env:PROCESSOR_ARCHITEW6432)) { $gbSetupArchitecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($gbSetupArchitecture -ine 'AMD64' -or -not [Environment]::Is64BitOperatingSystem) {
        throw 'This packaged Windows Node installer supports x64 only; no installation was performed on this unsupported architecture.'
    }
    $gbSetupScriptDirectory = Resolve-GbSetupPhysicalPath $PSScriptRoot
    $gbSetupPackageRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($gbSetupScriptDirectory, '..')).TrimEnd('\', '/')
    $gbSetupManager = [System.IO.Path]::Combine($gbSetupScriptDirectory, 'setup.mjs')
    if (-not [System.IO.File]::Exists($gbSetupManager)) { throw 'The packaged scripts/setup.mjs manager is missing; obtain a complete plugin package.' }
    if ([string]::IsNullOrWhiteSpace($gbSetupOptions.Root)) {
        if (-not [string]::IsNullOrWhiteSpace($env:GB_STUDIO_SETUP_ROOT)) { $gbSetupOptions.Root = $env:GB_STUDIO_SETUP_ROOT }
        else {
            if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is unavailable. Select an absolute owned data directory with --root.' }
            $gbSetupOptions.Root = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'modretro-chromatic')
        }
    }
    $gbSetupRoot = Get-GbSetupLocalPath $gbSetupOptions.Root
    $gbSetupVolume = [System.IO.Path]::GetPathRoot($gbSetupRoot)
    if ($gbSetupRoot.TrimEnd('\') -ieq $gbSetupVolume.TrimEnd('\')) { throw '--root must not be a filesystem root.' }
    $gbSetupDrive = New-Object System.IO.DriveInfo($gbSetupVolume)
    if (@([System.IO.DriveType]::Fixed, [System.IO.DriveType]::Removable, [System.IO.DriveType]::Ram) -notcontains $gbSetupDrive.DriveType) {
        throw '--root must be on a local filesystem drive, not a mapped network drive.'
    }
    if ((Test-GbSetupWithinRoot -Root $gbSetupPackageRoot -Candidate $gbSetupRoot) -or
        (Test-GbSetupWithinRoot -Root $gbSetupRoot -Candidate $gbSetupPackageRoot)) {
        throw '--root must be outside the immutable plugin package and must not contain it.'
    }
    $gbSetupCacheRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $gbSetupCacheRoots += [System.IO.Path]::Combine($env:USERPROFILE, '.codex\plugins\cache') }
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { $gbSetupCacheRoots += [System.IO.Path]::Combine($env:CODEX_HOME, 'plugins\cache') }
    foreach ($gbSetupCacheRoot in $gbSetupCacheRoots) {
        if ($gbSetupCacheRoot -match '^[A-Za-z]:[\\/]' -and (Test-GbSetupWithinRoot -Root ([System.IO.Path]::GetFullPath($gbSetupCacheRoot)) -Candidate $gbSetupRoot)) {
            throw '--root must be outside the immutable plugin cache.'
        }
    }
    if ($gbSetupRoot -match '(^|[\\/])plugins[\\/]cache([\\/]|$)') { throw '--root must be outside an immutable plugin cache.' }
    Assert-GbSetupRoot $gbSetupRoot
    $gbSetupCatalog = [System.IO.Path]::Combine($gbSetupScriptDirectory, 'node-releases.tsv')
    $gbSetupCatalogLines = [System.IO.File]::ReadAllLines($gbSetupCatalog)
    if ($gbSetupCatalogLines.Count -lt 2 -or $gbSetupCatalogLines[0] -cne "platform`tversion`tarchive`tsha256`turl") {
        throw 'Invalid packaged Node release catalog header.'
    }
    $gbSetupReleases = @()
    foreach ($gbSetupCatalogLine in $gbSetupCatalogLines[1..($gbSetupCatalogLines.Count - 1)]) {
        if ($gbSetupCatalogLine -ceq '') { continue }
        $gbSetupFields = $gbSetupCatalogLine -split "`t"
        if ($gbSetupFields.Count -ne 5) { throw 'Invalid packaged Node release catalog columns.' }
        if ($gbSetupFields[0] -ceq 'win32-x64') {
            $gbSetupReleases += [pscustomobject] @{ platform = $gbSetupFields[0]; version = $gbSetupFields[1]; archive = $gbSetupFields[2]; sha256 = $gbSetupFields[3]; url = $gbSetupFields[4] }
        }
    }
    if ($gbSetupReleases.Count -ne 1) { throw 'The packaged Node release catalog must contain exactly one Windows x64 pin.' }
    $gbSetupRelease = $gbSetupReleases[0]
    if ($gbSetupRelease.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or $gbSetupRelease.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $gbSetupRelease.archive -cne "node-v$($gbSetupRelease.version)-win-x64.zip" -or
        $gbSetupRelease.url -cne "https://nodejs.org/download/release/v$($gbSetupRelease.version)/$($gbSetupRelease.archive)") {
        throw 'Invalid packaged Node version/archive/checksum/official source.'
    }
    if ([int64] ($gbSetupRelease.version -split '\.')[0] -lt 22) { throw 'The packaged Node pin must meet the >=22 bootstrap requirement.' }
    $gbSetupPlatformDirectory = [System.IO.Path]::Combine($gbSetupRoot, 'node\win32-x64')
    $gbSetupStem = [System.IO.Path]::GetFileNameWithoutExtension($gbSetupRelease.archive)
    $gbSetupExecutable = [System.IO.Path]::Combine($gbSetupPlatformDirectory, "$gbSetupStem\node.exe")
    $gbSetupReceiptPath = [System.IO.Path]::Combine($gbSetupPlatformDirectory, 'receipt.json')
    Assert-GbSetupNoReparsePoints -Path $gbSetupPlatformDirectory -Directory
    if ([System.IO.Directory]::Exists($gbSetupPlatformDirectory)) {
        if (Test-GbSetupManagedNode -Directory $gbSetupPlatformDirectory -Executable $gbSetupExecutable -ReceiptPath $gbSetupReceiptPath -Release $gbSetupRelease) {
            Invoke-GbSetupManager -Executable $gbSetupExecutable -Manager $gbSetupManager -Arguments $gbSetupOriginalArguments
            exit $script:gbSetupExitCode
        }
        $script:gbSetupNodeStatus = 'broken'
    }
    # Absolute PATH entries only: never aliases/functions, node.cmd, current-
    # directory fallback, or PowerShell's native executable-name search rules.
    $gbSetupSeenNodes = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $gbSetupSelectedExecutable = $null
    foreach ($gbSetupPathEntry in ($env:PATH -split ';')) {
        $gbSetupPathDirectory = $gbSetupPathEntry.Trim().Trim('"')
        if ($gbSetupPathDirectory -notmatch '^[A-Za-z]:[\\/]') { continue }
        try {
            $gbSetupCandidate = Resolve-GbSetupPhysicalPath ([System.IO.Path]::Combine($gbSetupPathDirectory, 'node.exe'))
            if (-not $gbSetupSeenNodes.Add($gbSetupCandidate) -or -not [System.IO.File]::Exists($gbSetupCandidate) -or
                [System.IO.Path]::GetExtension($gbSetupCandidate) -ine '.exe') { continue }
            # A failed managed receipt cannot be bypassed by placing that same
            # owned-root executable on PATH and relabeling it as a system tool.
            if (Test-GbSetupWithinRoot -Root $gbSetupRoot -Candidate $gbSetupCandidate) { continue }
            if (Test-GbSetupWithinRoot -Root $gbSetupPackageRoot -Candidate $gbSetupCandidate) { continue }
            if (Get-GbSetupNodeVersion $gbSetupCandidate) {
                $gbSetupSelectedExecutable = $gbSetupCandidate
                break
            }
            if ($script:gbSetupNodeStatus -cne 'broken') {
                if ($script:gbSetupDetectedVersion -cne '') { $script:gbSetupNodeStatus = 'incompatible' }
                else { $script:gbSetupNodeStatus = 'broken' }
            }
        } catch { }
    }
    # Once the manager starts, its error/exit is final. Never catch it as a
    # discovery failure, try another Node, or repeat a possibly partial apply.
    if ($null -ne $gbSetupSelectedExecutable) {
        Invoke-GbSetupManager -Executable $gbSetupSelectedExecutable -Manager $gbSetupManager -Arguments $gbSetupOriginalArguments
        exit $script:gbSetupExitCode
    }
    if ($gbSetupOptions.Command -cne 'apply') {
        Write-GbSetupBootstrapReport -Options $gbSetupOptions -Release $gbSetupRelease -Root $gbSetupRoot -Executable $gbSetupExecutable -ScriptPath $PSCommandPath
        if ($gbSetupOptions.Command -ceq 'plan') { exit 0 }
        exit 1
    }
    if ([System.IO.Directory]::Exists($gbSetupPlatformDirectory) -or [System.IO.File]::Exists($gbSetupPlatformDirectory)) {
        throw "Managed Node is broken or unowned at $gbSetupPlatformDirectory. Preserve it for inspection and select a new empty --root; setup will not overwrite it."
    }
    Install-GbSetupNode -Root $gbSetupRoot -PlatformDirectory $gbSetupPlatformDirectory -Executable $gbSetupExecutable -ReceiptPath $gbSetupReceiptPath -Release $gbSetupRelease
    # Bootstrap releases its owned lock before the dependency manager acquires
    # that same per-root lock. Existing sessions and plugin bindings are untouched.
    Invoke-GbSetupManager -Executable $gbSetupExecutable -Manager $gbSetupManager -Arguments $gbSetupOriginalArguments
    exit $script:gbSetupExitCode
} catch {
    $gbSetupFailure = [ordered] @{
        schemaVersion = 1; bootstrapOnly = $true; status = 'error'; error = $_.Exception.Message
        bootstrapInstalled = $script:gbSetupBootstrapInstalled
        stagingPath = $script:gbSetupStage; cleanupError = $script:gbSetupCleanupError
    }
    if ($script:gbSetupJson) { $gbSetupFailure | ConvertTo-Json -Depth 12 }
    else {
        [Console]::Error.WriteLine("ModRetro Chromatic setup: $($_.Exception.Message)")
        if ($null -ne $script:gbSetupCleanupError) { [Console]::Error.WriteLine("Cleanup: $($script:gbSetupCleanupError)") }
    }
    exit 1
}
