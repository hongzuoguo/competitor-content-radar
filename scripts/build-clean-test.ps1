[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$Commit,

  [string]$CanonicalRepo,
  [string]$BuildRoot,
  [string]$TestRoot,
  [string]$ReleaseRoot,
  [string]$VisualPrivacyReview,
  [switch]$NoLaunch,
  [switch]$ValidateOnly,
  [switch]$ValidateNativeStep,
  [ValidateSet(0, 23)]
  [int]$ValidateNativeExitCode = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hitMuseLocalRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HitMuse'
$defaultBuildRoot = Join-Path $hitMuseLocalRoot 'release-work\build'
$defaultTestRoot = Join-Path $hitMuseLocalRoot 'release-work\test'
$defaultReleaseRoot = Join-Path $hitMuseLocalRoot 'releases'
$defaultCanonicalRepo = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($CanonicalRepo)) { $CanonicalRepo = $defaultCanonicalRepo }
if ([string]::IsNullOrWhiteSpace($BuildRoot)) { $BuildRoot = $defaultBuildRoot }
if ([string]::IsNullOrWhiteSpace($TestRoot)) { $TestRoot = $defaultTestRoot }
if ([string]::IsNullOrWhiteSpace($ReleaseRoot)) { $ReleaseRoot = $defaultReleaseRoot }

function ConvertFrom-Utf8Base64 {
  param([Parameter(Mandatory = $true)][string]$Value)
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function ConvertTo-AbsolutePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or ($Path -notmatch '^[A-Za-z]:[\\/]' -and $Path -notmatch '^\\\\[^\\]+\\[^\\]+')) {
    throw "${Label}_PATH_MUST_BE_ABSOLUTE: $Path"
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function ConvertTo-ExtendedLengthPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $absolute = ConvertTo-AbsolutePath -Path $Path -Label 'EXTENDED_LENGTH'
  if ($absolute.StartsWith('\\')) {
    return '\\?\UNC\' + $absolute.TrimStart('\')
  }
  return '\\?\' + $absolute
}

function Test-PathEqual {
  param([string]$Left, [string]$Right)
  return [string]::Equals($Left.TrimEnd('\', '/'), $Right.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathEqualOrDescendant {
  param([string]$Parent, [string]$Candidate)

  $normalizedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $current = [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
  while (-not [string]::IsNullOrWhiteSpace($current)) {
    if (Test-PathEqual -Left $normalizedParent -Right $current) {
      return $true
    }
    $parentDirectory = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parentDirectory) {
      break
    }
    $next = $parentDirectory.FullName
    if ([string]::IsNullOrWhiteSpace($next) -or (Test-PathEqual -Left $next -Right $current)) {
      break
    }
    $current = $next
  }
  return $false
}

function Confirm-NoReparseExistingAncestors {
  param([string]$Path, [string]$Label)

  $current = ConvertTo-AbsolutePath -Path $Path -Label $Label
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "${Label}_REPARSE_POINT: $current"
      }
    }
    $parentDirectory = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parentDirectory -or (Test-PathEqual -Left $parentDirectory.FullName -Right $current)) {
      break
    }
    $current = $parentDirectory.FullName
  }
}

function Test-StrictDescendant {
  param([string]$Parent, [string]$Candidate)
  return -not (Test-PathEqual -Left $Parent -Right $Candidate) -and (Test-PathEqualOrDescendant -Parent $Parent -Candidate $Candidate)
}

function Confirm-StrictDescendant {
  param([string]$Parent, [string]$Candidate, [string]$Label)
  if (-not (Test-StrictDescendant -Parent $Parent -Candidate $Candidate)) {
    throw "${Label}_PATH_MUST_BE_STRICT_DESCENDANT: $Candidate"
  }
}

function Confirm-NoProtectedOverlap {
  param([string]$Candidate, [string]$ProtectedPath, [string]$Label)
  if ((Test-PathEqualOrDescendant -Parent $ProtectedPath -Candidate $Candidate) -or (Test-PathEqualOrDescendant -Parent $Candidate -Candidate $ProtectedPath)) {
    throw "${Label}_PATH_PROTECTED: $Candidate overlaps protected path $ProtectedPath"
  }
}

function Resolve-ExistingDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Confirm-NoReparseExistingAncestors -Path $Path -Label $Label
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "${Label}_DIRECTORY_MISSING: $Path"
  }
  return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).ProviderPath
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "SHA256_FILE_MISSING: $Path"
  }

  $stream = $null
  $hash = $null
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $hash.ComputeHash($stream)
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $hash) { $hash.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Get-ModelFingerprint {
  param([Parameter(Mandatory = $true)][string]$ManifestPath)

  $modelManifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($modelManifest.id) -or $null -eq $modelManifest.files) {
    throw "BUILD_MODEL_MANIFEST_INVALID: $ManifestPath"
  }
  $files = @()
  foreach ($property in $modelManifest.files.PSObject.Properties) {
    $file = $property.Value
    $fileSize = 0L
    if (-not [long]::TryParse([string]$file.size, [ref]$fileSize) -or $fileSize -lt 0 -or [string]::IsNullOrWhiteSpace($file.sha256) -or $file.sha256 -notmatch '^[0-9a-fA-F]{64}$') {
      throw "BUILD_MODEL_MANIFEST_INVALID: $ManifestPath"
    }
    $files += [ordered]@{
      name = $property.Name
      bytes = $fileSize
      sha256 = $file.sha256.ToLowerInvariant()
    }
  }
  if ($files.Count -eq 0) {
    throw "BUILD_MODEL_MANIFEST_INVALID: $ManifestPath"
  }
  return [ordered]@{ id = $modelManifest.id; files = $files }
}

function Invoke-ElectronNpmCi {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogDirectory
  )

  $savedRuntime = $env:HITMUSE_INSTALL_RUNTIME
  $hadRuntime = Test-Path Env:HITMUSE_INSTALL_RUNTIME
  try {
    $env:HITMUSE_INSTALL_RUNTIME = 'electron'
    Invoke-NativeStep -Name 'npm-ci' -FilePath 'npm.cmd' -ArgumentList @('ci') -WorkingDirectory $WorkingDirectory -LogDirectory $LogDirectory | Out-Null
  } finally {
    if ($hadRuntime) {
      $env:HITMUSE_INSTALL_RUNTIME = $savedRuntime
    } else {
      Remove-Item Env:HITMUSE_INSTALL_RUNTIME -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-ElectronRuntimeProbe {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [Parameter(Mandatory = $true)][string]$LogDirectory
  )

  $electronExecutable = Join-Path $WorkingDirectory 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path -LiteralPath $electronExecutable -PathType Leaf)) {
    throw "ELECTRON_RUNTIME_EXECUTABLE_MISSING: $electronExecutable"
  }
  $savedRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $hadRunAsNode = Test-Path Env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    Invoke-NativeStep -Name 'verify-electron-runtime' -FilePath $electronExecutable -ArgumentList @('scripts/verify-native-runtime.mjs', '--runtime', 'electron', '--result', $ResultPath) -WorkingDirectory $WorkingDirectory -LogDirectory $LogDirectory | Out-Null
  } finally {
    if ($hadRunAsNode) {
      $env:ELECTRON_RUN_AS_NODE = $savedRunAsNode
    } else {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
  }
}

function Write-JsonAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value,
    [int]$Depth = 12
  )

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "BUILD_JSON_PARENT_MISSING: $parent"
  }
  Confirm-NoReparseExistingAncestors -Path $parent -Label 'BUILD_JSON_PARENT'
  $leaf = Split-Path -Leaf $Path
  $temporary = Join-Path $parent ".$leaf.$PID.$([guid]::NewGuid().ToString('N')).tmp"
  $backup = Join-Path $parent ".$leaf.$PID.$([guid]::NewGuid().ToString('N')).bak"
  try {
    $json = ($Value | ConvertTo-Json -Depth $Depth) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [System.IO.File]::Replace($temporary, $Path, $backup, $true)
      if (Test-Path -LiteralPath $backup -PathType Leaf) {
        [System.IO.File]::Delete($backup)
      }
    } else {
      [System.IO.File]::Move($temporary, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) {
      [System.IO.File]::Delete($temporary)
    }
    if (Test-Path -LiteralPath $backup -PathType Leaf) {
      [System.IO.File]::Delete($backup)
    }
  }
}

function Set-BuildStage {
  param(
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Manifest,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('RUNNING', 'PASSED')][string]$Status,
    [string]$LogPath
  )

  $Manifest['currentStage'] = $Name
  $stage = $Manifest['stages'][$Name]
  if ($null -eq $stage) {
    $stage = [ordered]@{}
  }
  $stage['status'] = $Status
  $stage['updatedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
  if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    $stage['logPath'] = $LogPath
  }
  $Manifest['stages'][$Name] = $stage
  Write-JsonAtomically -Path $ManifestPath -Value $Manifest
}

function Assert-SessionMarker {
  param(
    [Parameter(Mandatory = $true)][string]$SessionMarker,
    [Parameter(Mandatory = $true)][string]$ExpectedSessionId
  )

  Confirm-NoReparseExistingAncestors -Path $SessionMarker -Label 'SESSION_MARKER'
  $marker = Get-Content -LiteralPath $SessionMarker -Raw -Encoding utf8 | ConvertFrom-Json
  if ($marker.sessionId -ne $ExpectedSessionId) {
    throw "BUILD_SESSION_MARKER_MISMATCH: $SessionMarker"
  }
  return $marker
}

function Remove-SessionOwnedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ApprovedParent,
    [Parameter(Mandatory = $true)][string]$SessionMarker,
    [Parameter(Mandatory = $true)][string]$ExpectedSessionId,
    [Parameter(Mandatory = $true)][string]$OwnerField,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [switch]$ExactOwner
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Confirm-StrictDescendant -Parent $ApprovedParent -Candidate $Path -Label 'SESSION_CLEANUP_TARGET'
  Confirm-NoReparseExistingAncestors -Path $ApprovedParent -Label 'SESSION_CLEANUP_PARENT'
  Confirm-NoReparseExistingAncestors -Path $Path -Label 'SESSION_CLEANUP_TARGET'
  $target = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $target.PSIsContainer -or ($target.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "SESSION_CLEANUP_TARGET_UNSAFE: $Path"
  }
  $marker = Assert-SessionMarker -SessionMarker $SessionMarker -ExpectedSessionId $ExpectedSessionId
  $ownerProperty = $marker.PSObject.Properties[$OwnerField]
  if ($null -eq $ownerProperty -or [string]::IsNullOrWhiteSpace([string]$ownerProperty.Value)) {
    throw "SESSION_CLEANUP_OWNER_MISSING: field=$OwnerField path=$Path"
  }
  $ownerPath = ConvertTo-AbsolutePath -Path ([string]$ownerProperty.Value) -Label 'SESSION_CLEANUP_OWNER'
  $owned = if ($ExactOwner) {
    Test-PathEqual -Left $ownerPath -Right $Path
  } else {
    (Test-PathEqual -Left $ownerPath -Right $ApprovedParent) -and (Test-StrictDescendant -Parent $ownerPath -Candidate $Path)
  }
  if (-not $owned) {
    throw "SESSION_CLEANUP_OWNER_MISMATCH: field=$OwnerField path=$Path owner=$ownerPath"
  }
  Write-SessionLog -LogPath $LogPath -Message "SESSION_CLEANUP_START path=$Path"
  [System.IO.Directory]::Delete((ConvertTo-ExtendedLengthPath -Path $Path), $true)
  if (Test-Path -LiteralPath $Path) {
    throw "SESSION_CLEANUP_TARGET_RETAINED: $Path"
  }
  Write-SessionLog -LogPath $LogPath -Message "SESSION_CLEANUP_REMOVED path=$Path"
}

function Publish-VerifiedArtifacts {
  param(
    [Parameter(Mandatory = $true)][string]$TestStaging,
    [Parameter(Mandatory = $true)][string]$CleanRoot,
    [Parameter(Mandatory = $true)][string]$ReleaseStaging,
    [Parameter(Mandatory = $true)][string]$ReleaseOutput
  )

  if ((Test-Path -LiteralPath $CleanRoot) -or (Test-Path -LiteralPath $ReleaseOutput)) {
    throw 'FINAL_OUTPUT_ALREADY_EXISTS_REFUSING_TO_OVERWRITE'
  }
  [System.IO.Directory]::Move($TestStaging, $CleanRoot)
  try {
    [System.IO.Directory]::Move($ReleaseStaging, $ReleaseOutput)
  } catch {
    if (Test-Path -LiteralPath $CleanRoot -PathType Container) {
      [System.IO.Directory]::Move($CleanRoot, $TestStaging)
    }
    throw
  }
}

function Resolve-ApprovedOutputRoot {
  param(
    [string]$Path,
    [string]$Label,
    [string[]]$ProtectedPaths,
    [switch]$Create
  )

  $absolute = ConvertTo-AbsolutePath -Path $Path -Label $Label
  Confirm-NoReparseExistingAncestors -Path $absolute -Label $Label
  $driveRoot = [System.IO.Path]::GetPathRoot($absolute)
  if (Test-PathEqual -Left $absolute -Right $driveRoot) {
    throw "${Label}_PATH_MUST_NOT_BE_FILESYSTEM_ROOT: $absolute"
  }
  foreach ($protectedPath in $ProtectedPaths) {
    if ((Test-PathEqualOrDescendant -Parent $protectedPath -Candidate $absolute) -or (Test-PathEqualOrDescendant -Parent $absolute -Candidate $protectedPath)) {
      throw "${Label}_PATH_PROTECTED: $absolute overlaps protected path $protectedPath"
    }
  }
  if (-not (Test-Path -LiteralPath $absolute)) {
    if (-not $Create) {
      return $absolute
    }
    New-Item -ItemType Directory -Path $absolute -ErrorAction Stop | Out-Null
  }
  $resolved = Resolve-ExistingDirectory -Path $absolute -Label $Label
  Confirm-NoReparseExistingAncestors -Path $resolved -Label $Label
  foreach ($protectedPath in $ProtectedPaths) {
    if ((Test-PathEqualOrDescendant -Parent $protectedPath -Candidate $resolved) -or (Test-PathEqualOrDescendant -Parent $resolved -Candidate $protectedPath)) {
      throw "${Label}_PATH_PROTECTED: $resolved overlaps protected path $protectedPath"
    }
  }
  return $resolved
}

function Write-SessionLog {
  param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  Write-Host $line
}

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogDirectory,
    [switch]$AllowFailure
  )

  $safeName = $Name -replace '[^A-Za-z0-9._-]', '-'
  $logPath = Join-Path $LogDirectory ("$safeName.log")
  Write-SessionLog -LogPath $logPath -Message "STEP_START name=$Name cwd=$WorkingDirectory command=$FilePath"
  $nativeCommand = Get-Command -Name $FilePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if ($null -eq $nativeCommand -or [string]::IsNullOrWhiteSpace($nativeCommand.Source)) {
    throw "CLEAN_TEST_NATIVE_COMMAND_NOT_FOUND: $FilePath"
  }
  $nativeExecutable = $nativeCommand.Source
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & $nativeExecutable @ArgumentList 2>&1 | ForEach-Object {
        $outputLine = $_.ToString()
        Add-Content -LiteralPath $logPath -Value $outputLine -Encoding utf8 -ErrorAction Stop
        Write-Host $_ -ErrorAction Stop
      }
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
    }
  } finally {
    Pop-Location
  }
  Write-SessionLog -LogPath $logPath -Message "STEP_EXIT name=$Name exit=$exitCode"
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "CLEAN_TEST_STEP_FAILED: $Name exited with $exitCode. See $logPath"
  }
  return $exitCode
}

function Get-GitValue {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $gitCommand = Get-Command -Name 'git' -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if ($null -eq $gitCommand -or [string]::IsNullOrWhiteSpace($gitCommand.Source)) {
    throw 'CLEAN_TEST_NATIVE_COMMAND_NOT_FOUND: git'
  }
  $output = [System.Collections.Generic.List[string]]::new()
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & $gitCommand.Source @ArgumentList 2>&1 | ForEach-Object {
        $outputLine = $_.ToString()
        [void]$output.Add($outputLine)
        Add-Content -LiteralPath $LogPath -Value $outputLine -Encoding utf8 -ErrorAction Stop
        Write-Host $_ -ErrorAction Stop
      }
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
    }
  } finally {
    Pop-Location
  }
  Write-SessionLog -LogPath $LogPath -Message "STEP_EXIT name=$Label exit=$exitCode"
  if ($exitCode -ne 0) {
    throw "CLEAN_TEST_GIT_FAILED: $Label. See $LogPath"
  }
  return (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
}

function Test-RegisteredWorktree {
  param(
    [Parameter(Mandatory = $true)][string]$CanonicalRepository,
    [Parameter(Mandatory = $true)][string]$WorktreePath,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  $porcelain = Get-GitValue -WorkingDirectory $CanonicalRepository -ArgumentList @('-C', $CanonicalRepository, 'worktree', 'list', '--porcelain') -LogPath $LogPath -Label 'worktree-list-revalidate'
  foreach ($line in ($porcelain -split "`r?`n")) {
    if ($line.StartsWith('worktree ')) {
      $registeredPath = $line.Substring(9)
      if (Test-Path -LiteralPath $registeredPath -PathType Container) {
        $resolvedRegisteredPath = (Resolve-Path -LiteralPath $registeredPath).ProviderPath
        if (Test-PathEqual -Left $resolvedRegisteredPath -Right $WorktreePath) {
          return $true
        }
      }
    }
  }
  return $false
}

function Assert-RemovableWorktree {
  param(
    [Parameter(Mandatory = $true)][string]$CanonicalRepository,
    [Parameter(Mandatory = $true)][string]$BuildDirectory,
    [Parameter(Mandatory = $true)][string]$WorktreePath,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][string]$SessionDirectory,
    [Parameter(Mandatory = $true)][string]$SessionMarker,
    [Parameter(Mandatory = $true)][string]$ExpectedSessionId,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  Confirm-StrictDescendant -Parent $BuildDirectory -Candidate $WorktreePath -Label 'BUILD_WORKTREE'
  Confirm-NoReparseExistingAncestors -Path $BuildDirectory -Label 'BUILD_ROOT'
  Confirm-NoReparseExistingAncestors -Path $SessionDirectory -Label 'SESSION'
  Confirm-NoReparseExistingAncestors -Path $WorktreePath -Label 'BUILD_WORKTREE'
  Confirm-NoReparseExistingAncestors -Path $SessionMarker -Label 'SESSION_MARKER'
  $marker = Get-Content -LiteralPath $SessionMarker -Raw -Encoding utf8 | ConvertFrom-Json
  if ($marker.sessionId -ne $ExpectedSessionId -or -not (Test-PathEqual -Left $marker.sessionDirectory -Right $SessionDirectory) -or -not (Test-PathEqual -Left $marker.buildWorktree -Right $WorktreePath)) {
    throw "BUILD_WORKTREE_SESSION_MARKER_MISMATCH: $SessionMarker"
  }
  $resolvedWorktree = Resolve-ExistingDirectory -Path $WorktreePath -Label 'BUILD_WORKTREE'
  if (-not (Test-PathEqual -Left $resolvedWorktree -Right $WorktreePath)) {
    throw "BUILD_WORKTREE_PATH_REPARSE_OR_MISMATCH: $WorktreePath"
  }
  if (-not (Test-RegisteredWorktree -CanonicalRepository $CanonicalRepository -WorktreePath $resolvedWorktree -LogPath $LogPath)) {
    throw "BUILD_WORKTREE_NOT_REGISTERED: $resolvedWorktree"
  }
  $head = Get-GitValue -WorkingDirectory $resolvedWorktree -ArgumentList @('-C', $resolvedWorktree, 'rev-parse', '--verify', 'HEAD') -LogPath $LogPath -Label 'worktree-head-revalidate'
  if (-not (Test-PathEqual -Left $head -Right $ExpectedCommit)) {
    throw "BUILD_WORKTREE_HEAD_MISMATCH: expected $ExpectedCommit, found $head"
  }
}

function Remove-VerifiedWorktree {
  param(
    [Parameter(Mandatory = $true)][string]$CanonicalRepository,
    [Parameter(Mandatory = $true)][string]$BuildDirectory,
    [Parameter(Mandatory = $true)][string]$WorktreePath,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][string]$SessionDirectory,
    [Parameter(Mandatory = $true)][string]$SessionMarker,
    [Parameter(Mandatory = $true)][string]$ExpectedSessionId,
    [Parameter(Mandatory = $true)][string]$LogDirectory
  )

  $cleanupLog = Join-Path $LogDirectory 'worktree-cleanup.log'
  Assert-RemovableWorktree -CanonicalRepository $CanonicalRepository -BuildDirectory $BuildDirectory -WorktreePath $WorktreePath -ExpectedCommit $ExpectedCommit -SessionDirectory $SessionDirectory -SessionMarker $SessionMarker -ExpectedSessionId $ExpectedSessionId -LogPath $cleanupLog
  $status = Get-GitValue -WorkingDirectory $WorktreePath -ArgumentList @('-C', $WorktreePath, 'status', '--porcelain', '--untracked-files=all') -LogPath $cleanupLog -Label 'worktree-status-before-remove'
  if (-not [string]::IsNullOrWhiteSpace($status)) {
    throw "BUILD_WORKTREE_CLEANUP_BLOCKED_DIRTY: $WorktreePath"
  }
  $exitCode = Invoke-NativeStep -Name 'worktree-remove' -FilePath 'git' -ArgumentList @('-C', $CanonicalRepository, 'worktree', 'remove', $WorktreePath) -WorkingDirectory $CanonicalRepository -LogDirectory $LogDirectory -AllowFailure
  if ($exitCode -ne 0) {
    $reason = ConvertFrom-Utf8Base64 '5bey56aB5q2i5by65Yi25Yig6Zmk77yM6K+35qC55o2u5pel5b+X5Lq65bel5qOA5p+l6K+l6Lev5b6E44CC'
    throw "BUILD_WORKTREE_REMOVE_FAILED_NO_FORCE: $WorktreePath $reason"
  }
}

$canonicalRepo = Resolve-ExistingDirectory -Path (ConvertTo-AbsolutePath -Path $CanonicalRepo -Label 'CANONICAL_REPO') -Label 'CANONICAL_REPO'
& git -C $canonicalRepo rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "CANONICAL_REPO_NOT_GIT_REPOSITORY: $canonicalRepo"
}

$localApplicationData = [Environment]::GetFolderPath('LocalApplicationData')
$applicationData = [Environment]::GetFolderPath('ApplicationData')
$protectedPaths = @(
  $canonicalRepo,
  (Join-Path $localApplicationData 'Programs\HitMuse'),
  (Join-Path $localApplicationData 'Programs\HitMuse App'),
  (Join-Path $applicationData 'HitMuse'),
  (Join-Path $applicationData 'competitor-content-radar')
) | ForEach-Object { ConvertTo-AbsolutePath -Path $_ -Label 'PROTECTED' }

$testRoot = Resolve-ApprovedOutputRoot -Path $TestRoot -Label 'TEST_ROOT' -ProtectedPaths $protectedPaths -Create:(-not $ValidateOnly)
$releaseRoot = Resolve-ApprovedOutputRoot -Path $ReleaseRoot -Label 'RELEASE_ROOT' -ProtectedPaths @($protectedPaths + $testRoot) -Create:(-not $ValidateOnly)
$buildRoot = Resolve-ApprovedOutputRoot -Path $BuildRoot -Label 'BUILD_ROOT' -ProtectedPaths @($protectedPaths + $testRoot + $releaseRoot) -Create:(-not $ValidateOnly)
if ($ValidateOnly) {
  Write-Output "CLEAN_TEST_VALIDATION_OK buildRoot=$buildRoot testRoot=$testRoot canonicalRepo=$canonicalRepo"
  exit 0
}

if ($ValidateNativeStep) {
  $validationSessionsRoot = Join-Path $buildRoot 'sessions'
  Confirm-StrictDescendant -Parent $buildRoot -Candidate $validationSessionsRoot -Label 'NATIVE_STEP_SESSION_ROOT'
  New-Item -ItemType Directory -Path $validationSessionsRoot -Force -ErrorAction Stop | Out-Null
  $validationSessionsRoot = Resolve-ExistingDirectory -Path $validationSessionsRoot -Label 'NATIVE_STEP_SESSION_ROOT'
  $validationSessionId = [guid]::NewGuid().ToString('N')
  $validationSession = Join-Path $validationSessionsRoot "native-step-$validationSessionId"
  Confirm-StrictDescendant -Parent $buildRoot -Candidate $validationSession -Label 'NATIVE_STEP_SESSION'
  New-Item -ItemType Directory -Path $validationSession -ErrorAction Stop | Out-Null
  $validationSession = Resolve-ExistingDirectory -Path $validationSession -Label 'NATIVE_STEP_SESSION'
  $validationLogDirectory = Join-Path $validationSession 'logs'
  New-Item -ItemType Directory -Path $validationLogDirectory -ErrorAction Stop | Out-Null
  Confirm-NoReparseExistingAncestors -Path $validationLogDirectory -Label 'NATIVE_STEP_LOG_DIRECTORY'
  $validationCommand = "echo NATIVE_STEP_STDERR 1>&2 & exit /b $ValidateNativeExitCode"
  Invoke-NativeStep -Name 'native-step-validation' -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $validationCommand) -WorkingDirectory $validationSession -LogDirectory $validationLogDirectory | Out-Null
  Write-Output "NATIVE_STEP_VALIDATION_OK session=$validationSession exit=$ValidateNativeExitCode"
  exit 0
}

$modelSourceDirectory = $null

$shortSha = $Commit.Substring(0, 7).ToLowerInvariant()
$cleanRoot = Join-Path $testRoot "clean-$shortSha"
Confirm-StrictDescendant -Parent $testRoot -Candidate $cleanRoot -Label 'CLEAN_ROOT'
foreach ($protectedPath in $protectedPaths) {
  Confirm-NoProtectedOverlap -Candidate $cleanRoot -ProtectedPath $protectedPath -Label 'CLEAN_ROOT'
}
if (Test-Path -LiteralPath $cleanRoot) {
  throw "CLEAN_OUTPUT_ALREADY_EXISTS_REFUSING_TO_OVERWRITE: $cleanRoot"
}
$userDataDirectory = Join-Path $cleanRoot 'user-data'
Confirm-StrictDescendant -Parent $cleanRoot -Candidate $userDataDirectory -Label 'USER_DATA'

$sessionsRoot = Join-Path $buildRoot 'sessions'
$worktreesRoot = Join-Path $buildRoot 'worktrees'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $sessionsRoot -Label 'SESSION_ROOT'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $worktreesRoot -Label 'WORKTREE_ROOT'
New-Item -ItemType Directory -Path $sessionsRoot -Force -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $worktreesRoot -Force -ErrorAction Stop | Out-Null
$sessionsRoot = Resolve-ExistingDirectory -Path $sessionsRoot -Label 'SESSION_ROOT'
$worktreesRoot = Resolve-ExistingDirectory -Path $worktreesRoot -Label 'WORKTREE_ROOT'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $sessionsRoot -Label 'SESSION_ROOT'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $worktreesRoot -Label 'WORKTREE_ROOT'
$sessionId = [guid]::NewGuid().ToString('N')
$testStaging = Join-Path $testRoot ".pending-clean-$shortSha-$sessionId"
$sessionDirectory = Join-Path $sessionsRoot "clean-$shortSha-$sessionId"
$buildWorktree = Join-Path $worktreesRoot "clean-$shortSha-$sessionId"
$releaseStaging = Join-Path $releaseRoot ".pending-hitmuse-$shortSha-$sessionId"
Confirm-StrictDescendant -Parent $buildRoot -Candidate $sessionDirectory -Label 'SESSION'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $buildWorktree -Label 'BUILD_WORKTREE'
Confirm-StrictDescendant -Parent $testRoot -Candidate $testStaging -Label 'TEST_STAGING'
Confirm-StrictDescendant -Parent $releaseRoot -Candidate $releaseStaging -Label 'RELEASE_STAGING'
if ((Test-Path -LiteralPath $testStaging) -or (Test-Path -LiteralPath $releaseStaging)) {
  throw 'BUILD_STAGING_ALREADY_EXISTS_REFUSING_TO_OVERWRITE'
}
New-Item -ItemType Directory -Path $sessionDirectory -ErrorAction Stop | Out-Null
$sessionDirectory = Resolve-ExistingDirectory -Path $sessionDirectory -Label 'SESSION'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $sessionDirectory -Label 'SESSION'
$logDirectory = Join-Path $sessionDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -ErrorAction Stop | Out-Null
$sessionManifest = Join-Path $sessionDirectory 'build-manifest.json'
$scriptLog = Join-Path $logDirectory 'orchestrator.log'
$sessionMarker = Join-Path $sessionDirectory '.build-clean-test-session.json'
$packageSmokeRoot = Join-Path $testRoot "smoke-$shortSha-$sessionId"
$packageSmokeUserData = Join-Path $packageSmokeRoot 'user-data'
$packageSmokeDenyHosts = Join-Path $packageSmokeRoot 'deny-hosts.json'
$privacyRoot = Join-Path $sessionDirectory 'privacy'
$publicCandidateRoot = Join-Path $privacyRoot 'candidate'
$privacyRepositoryRoot = Join-Path $privacyRoot 'repository'
$privacyReleaseRoot = Join-Path $privacyRoot 'release'
$privacyReportRoot = Join-Path $privacyRoot 'report'
$privacyToolRoot = Join-Path $privacyRoot 'tools'
$publicEvidenceSource = Join-Path $privacyRoot 'evidence-source'
$publicEvidenceOutput = Join-Path $privacyRoot 'evidence'
$visualPrivacyReport = Join-Path $privacyReportRoot 'visual-privacy.json'
$visualPrivacyReviewBinding = Join-Path $privacyReportRoot 'visual-privacy-review-binding.json'
Confirm-StrictDescendant -Parent $testRoot -Candidate $packageSmokeRoot -Label 'PACKAGE_SMOKE_ROOT'
Confirm-StrictDescendant -Parent $packageSmokeRoot -Candidate $packageSmokeUserData -Label 'PACKAGE_SMOKE_USER_DATA'
Confirm-StrictDescendant -Parent $packageSmokeRoot -Candidate $packageSmokeDenyHosts -Label 'PACKAGE_SMOKE_DENY_HOSTS'
foreach ($privacyPath in @($privacyRoot, $publicCandidateRoot, $privacyRepositoryRoot, $privacyReleaseRoot, $privacyReportRoot, $privacyToolRoot, $publicEvidenceSource, $publicEvidenceOutput, $visualPrivacyReport, $visualPrivacyReviewBinding)) {
  Confirm-StrictDescendant -Parent $sessionDirectory -Candidate $privacyPath -Label 'PRIVACY_SESSION_PATH'
}
$reviewRoot = Join-Path $buildRoot 'reviews'
Confirm-StrictDescendant -Parent $buildRoot -Candidate $reviewRoot -Label 'VISUAL_PRIVACY_REVIEW_ROOT'
if (-not (Test-Path -LiteralPath $reviewRoot)) {
  New-Item -ItemType Directory -Path $reviewRoot -ErrorAction Stop | Out-Null
}
$reviewRoot = Resolve-ExistingDirectory -Path $reviewRoot -Label 'VISUAL_PRIVACY_REVIEW_ROOT'
if (Test-Path -LiteralPath $packageSmokeRoot) {
  throw "PACKAGE_SMOKE_ROOT_ALREADY_EXISTS_REFUSING_TO_OVERWRITE: $packageSmokeRoot"
}

$sessionMarkerState = [ordered]@{
  sessionId = $sessionId
  sessionDirectory = $sessionDirectory
  buildWorktree = $buildWorktree
  packageSmokeRoot = $packageSmokeRoot
  packageSmokeDenyHosts = $packageSmokeDenyHosts
  privacyRoot = $privacyRoot
  testStaging = $testStaging
  cleanRoot = $cleanRoot
  releaseStaging = $releaseStaging
  releaseOutput = $null
}
Write-JsonAtomically -Path $sessionMarker -Value $sessionMarkerState
Confirm-NoReparseExistingAncestors -Path $sessionDirectory -Label 'SESSION'
Confirm-NoReparseExistingAncestors -Path $sessionMarker -Label 'SESSION_MARKER'

$sourceContextBefore = Join-Path $sessionDirectory 'source-context-before-tests.json'
$sourceContextAfterTests = Join-Path $sessionDirectory 'source-context-after-tests.json'
$sourceContextAfterPackaging = Join-Path $sessionDirectory 'source-context-after-packaging.json'
$nodeRuntimeBefore = Join-Path $sessionDirectory 'node-runtime-before-tests.json'
$nodeRuntimeAfter = Join-Path $sessionDirectory 'node-runtime-after-packaging.json'
$electronRuntime = Join-Path $sessionDirectory 'electron-runtime.json'
$resourceVerification = Join-Path $sessionDirectory 'resource-verification.json'
$checksumsPath = Join-Path $sessionDirectory 'checksums.json'

$manifestState = [ordered]@{
  schemaVersion = 3
  status = 'STARTED'
  currentStage = 'initialize'
  failedStage = $null
  error = $null
  commit = $Commit.ToLowerInvariant()
  version = $null
  startedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  completedAtUtc = $null
  runtimes = [ordered]@{ node = $null; electron = $null }
  toolchain = $null
  resources = $null
  stages = [ordered]@{}
  model = $null
  artifacts = @()
  paths = [ordered]@{
    canonicalRepo = $canonicalRepo
    buildWorktree = $buildWorktree
    packageSmokeRoot = $packageSmokeRoot
    packageSmokeDenyHosts = $packageSmokeDenyHosts
    privacyRoot = $privacyRoot
    testStaging = $testStaging
    cleanRoot = $cleanRoot
    releaseStaging = $releaseStaging
    releaseOutput = $null
  }
  cleanup = [ordered]@{ status = 'PENDING'; removed = @(); retained = @() }
}
Write-JsonAtomically -Path $sessionManifest -Value $manifestState

$worktreeAdded = $false
$launchedProcess = $null
$capturedFailure = $null
$fullSha = $null
$currentStage = 'initialize'
$readyToPublish = $false
$cleanupBlocked = $false
$releaseOutput = $null

try {
  $currentStage = 'resolve-commit'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'git-cat-file' -FilePath 'git' -ArgumentList @('-C', $canonicalRepo, 'cat-file', '-e', "$Commit^{commit}") -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $fullSha = Get-GitValue -WorkingDirectory $canonicalRepo -ArgumentList @('-C', $canonicalRepo, 'rev-parse', '--verify', "$Commit^{commit}") -LogPath $scriptLog -Label 'git-rev-parse'
  if ($fullSha -notmatch '^[0-9a-f]{40}$') {
    throw "CLEAN_TEST_COMMIT_RESOLUTION_FAILED: $fullSha"
  }
  $manifestState['commit'] = $fullSha
  $sessionMarkerState['expectedCommit'] = $fullSha
  Write-JsonAtomically -Path $sessionMarker -Value $sessionMarkerState
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'git-cat-file.log')
  Write-SessionLog -LogPath $scriptLog -Message "BUILD_COMMIT fullSha=$fullSha requested=$Commit"

  $currentStage = 'verify-build-context-before-tests'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-build-context-before-tests' -FilePath 'node.exe' -ArgumentList @('scripts/verify-build-context.mjs', '--commit', $fullSha, '--manifest', $sourceContextBefore) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $sourceContext = Get-Content -LiteralPath $sourceContextBefore -Raw -Encoding utf8 | ConvertFrom-Json
  $manifestState['version'] = $sourceContext.version
  $manifestState['electronRange'] = $sourceContext.electron
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-build-context-before-tests.log')

  $currentStage = 'verify-node-runtime-before-tests'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-node-runtime-before-tests' -FilePath 'node.exe' -ArgumentList @('scripts/verify-native-runtime.mjs', '--runtime', 'node', '--result', $nodeRuntimeBefore) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $manifestState['runtimes']['node'] = Get-Content -LiteralPath $nodeRuntimeBefore -Raw -Encoding utf8 | ConvertFrom-Json
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-node-runtime-before-tests.log')

  $currentStage = 'verify-toolchain-before-tests'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-toolchain-before-tests' -FilePath 'npm.cmd' -ArgumentList @('run', 'verify:toolchain') -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $toolchainPath = Join-Path $canonicalRepo 'resources\build-toolchain.json'
  $manifestState['toolchain'] = [ordered]@{
    contract = Get-Content -LiteralPath $toolchainPath -Raw -Encoding utf8 | ConvertFrom-Json
    sha256 = Get-Sha256Hex -Path $toolchainPath
  }
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-toolchain-before-tests.log')

  $currentStage = 'npm-test-node'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'npm-test-node' -FilePath 'npm.cmd' -ArgumentList @('test', '--', '--exclude', 'tests/services/model-source-packaged.integration.test.ts') -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $manifestState['stages'][$currentStage]['command'] = 'npm test -- --exclude tests/services/model-source-packaged.integration.test.ts'
  $manifestState['stages'][$currentStage]['excluded'] = 'tests/services/model-source-packaged.integration.test.ts'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'npm-test-node.log')

  $currentStage = 'typecheck-node'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'typecheck-node' -FilePath 'npm.cmd' -ArgumentList @('run', 'typecheck') -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $manifestState['stages'][$currentStage]['command'] = 'npm run typecheck'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'typecheck-node.log')

  $currentStage = 'verify-build-context-after-tests'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-build-context-after-tests' -FilePath 'node.exe' -ArgumentList @('scripts/verify-build-context.mjs', '--commit', $fullSha, '--manifest', $sourceContextAfterTests) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-build-context-after-tests.log')

  $currentStage = 'git-worktree-add'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'git-worktree-add' -FilePath 'git' -ArgumentList @('-C', $canonicalRepo, 'worktree', 'add', '--detach', $buildWorktree, $fullSha) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $worktreeAdded = $true
  Assert-RemovableWorktree -CanonicalRepository $canonicalRepo -BuildDirectory $buildRoot -WorktreePath $buildWorktree -ExpectedCommit $fullSha -SessionDirectory $sessionDirectory -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -LogPath $scriptLog
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'git-worktree-add.log')

  $currentStage = 'verify-toolchain-before-install'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-toolchain-before-install' -FilePath 'npm.cmd' -ArgumentList @('run', 'verify:toolchain') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-toolchain-before-install.log')

  $currentStage = 'npm-ci'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-ElectronNpmCi -WorkingDirectory $buildWorktree -LogDirectory $logDirectory
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'npm-ci.log')

  $currentStage = 'verify-electron-runtime'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-ElectronRuntimeProbe -WorkingDirectory $buildWorktree -ResultPath $electronRuntime -LogDirectory $logDirectory
  $manifestState['runtimes']['electron'] = Get-Content -LiteralPath $electronRuntime -Raw -Encoding utf8 | ConvertFrom-Json
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-electron-runtime.log')

  $currentStage = 'setup-scrapling-build-environment'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'setup-scrapling-build-environment' -FilePath 'npm.cmd' -ArgumentList @('run', 'setup:scrapling-dev') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'setup-scrapling-build-environment.log')

  $currentStage = 'prepare-scrapling-resource'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'prepare-scrapling-resource' -FilePath 'npm.cmd' -ArgumentList @('run', 'build:scrapling') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'prepare-scrapling-resource.log')

  $currentStage = 'prepare-model-resource'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'prepare-model-resource' -FilePath 'npm.cmd' -ArgumentList @('run', 'prepare:model') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  $modelFingerprint = Get-ModelFingerprint -ManifestPath (Join-Path $buildWorktree 'resources\model-manifest.json')
  $manifestState['model'] = $modelFingerprint
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'prepare-model-resource.log')

  $currentStage = 'verify-resource-completeness'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-resource-completeness' -FilePath 'node.exe' -ArgumentList @('scripts/verify-resource-completeness.mjs', '--result', $resourceVerification) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  $manifestState['resources'] = Get-Content -LiteralPath $resourceVerification -Raw -Encoding utf8 | ConvertFrom-Json
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-resource-completeness.log')

  $currentStage = 'verify-release-dependencies'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-release-dependencies' -FilePath 'npm.cmd' -ArgumentList @('run', 'verify:release-dependencies') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-release-dependencies.log')

  $scraplingPython = Join-Path $buildWorktree 'engine\scrapling\.venv\Scripts\python.exe'
  $currentStage = 'install-user-guide-dependency'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'install-user-guide-dependency' -FilePath $scraplingPython -ArgumentList @('-m', 'pip', 'install', 'python-docx==1.2.0') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'install-user-guide-dependency.log')

  $currentStage = 'build-user-guide'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'build-user-guide' -FilePath $scraplingPython -ArgumentList @('scripts/build-user-guide.py', '--output-directory', 'release/guides') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'build-user-guide.log')

  $currentStage = 'package-installer'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'package-installer' -FilePath 'npm.cmd' -ArgumentList @('run', 'package:installer') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'package-installer.log')

  $unpackedDirectory = Join-Path $buildWorktree 'release\win-unpacked'
  $sourceExecutable = Join-Path $unpackedDirectory 'HitMuse.exe'
  $sourceResources = Join-Path $unpackedDirectory 'resources'
  $sourceAppArchive = Join-Path $sourceResources 'app.asar'
  foreach ($requiredPath in @($unpackedDirectory, $sourceExecutable, $sourceResources, $sourceAppArchive)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
      throw "PACKAGED_APP_REQUIRED_PATH_MISSING: $requiredPath"
    }
  }
  $installerCandidates = @(Get-ChildItem -LiteralPath (Join-Path $buildWorktree 'release') -Filter '*.exe' -File -ErrorAction Stop)
  if ($installerCandidates.Count -ne 1) {
    throw "PACKAGED_INSTALLER_COUNT_INVALID: expected 1, found $($installerCandidates.Count)"
  }
  $sourceInstaller = $installerCandidates[0].FullName

  $currentStage = 'packaged-model-integration'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'packaged-model-integration' -FilePath 'npx.cmd' -ArgumentList @('vitest', 'run', 'tests/services/model-source-packaged.integration.test.ts') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'packaged-model-integration.log')

  $currentStage = 'offline-model-package'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'offline-model-package' -FilePath 'npx.cmd' -ArgumentList @('vitest', 'run', 'tests/release/offline-model-package.test.ts') -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'offline-model-package.log')

  $currentStage = 'verify-packaged-app'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  New-Item -ItemType Directory -Path $packageSmokeRoot -ErrorAction Stop | Out-Null
  Confirm-NoReparseExistingAncestors -Path $packageSmokeRoot -Label 'PACKAGE_SMOKE_ROOT'
  Write-JsonAtomically -Path $packageSmokeDenyHosts -Value ([ordered]@{ schemaVersion = 1; hosts = @('github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cas-bridge.xethub.hf.co', 'api.hitmuse.com', 'hitmuse-beta-d8gbn7x2o2d6b8c2c-1463630014.ap-shanghai.app.tcloudbase.com') })
  Invoke-NativeStep -Name 'verify-packaged-app' -FilePath 'npm.cmd' -ArgumentList @('run', 'verify:packaged-app', '--', '--smoke-user-data-dir', $packageSmokeUserData, '--smoke-deny-hosts-file', $packageSmokeDenyHosts, '--smoke-test-root', $testRoot) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-packaged-app.log')

  $currentStage = 'verify-build-context-after-packaging'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-build-context-after-packaging' -FilePath 'node.exe' -ArgumentList @('scripts/verify-build-context.mjs', '--commit', $fullSha, '--manifest', $sourceContextAfterPackaging) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-build-context-after-packaging.log')

  $currentStage = 'verify-node-runtime-after-packaging'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'verify-node-runtime-after-packaging' -FilePath 'node.exe' -ArgumentList @('scripts/verify-native-runtime.mjs', '--runtime', 'node', '--result', $nodeRuntimeAfter) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  $nodeRuntimeAfterState = Get-Content -LiteralPath $nodeRuntimeAfter -Raw -Encoding utf8 | ConvertFrom-Json
  if ($nodeRuntimeAfterState.modules -ne $manifestState['runtimes']['node'].modules -or $nodeRuntimeAfterState.node -ne $manifestState['runtimes']['node'].node) {
    throw 'CANONICAL_NODE_RUNTIME_CHANGED_DURING_PACKAGING'
  }
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-node-runtime-after-packaging.log')

  $currentStage = 'stage-verified-artifacts'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  $version = [string]$manifestState['version']
  if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') {
    throw "BUILD_VERSION_INVALID_FOR_OUTPUT: $version"
  }
  $releaseOutput = Join-Path $releaseRoot "HitMuse-$version-$shortSha"
  Confirm-StrictDescendant -Parent $releaseRoot -Candidate $releaseOutput -Label 'RELEASE_OUTPUT'
  if (Test-Path -LiteralPath $releaseOutput) {
    throw "RELEASE_OUTPUT_ALREADY_EXISTS_REFUSING_TO_OVERWRITE: $releaseOutput"
  }
  $sessionMarkerState['releaseOutput'] = $releaseOutput
  $manifestState['paths']['releaseOutput'] = $releaseOutput
  Write-JsonAtomically -Path $sessionMarker -Value $sessionMarkerState
  $installerName = "HitMuse-$version-$shortSha-setup.exe"
  $sourceArtifacts = @(
    [ordered]@{ path = 'app/HitMuse.exe'; sha256 = Get-Sha256Hex -Path $sourceExecutable; bytes = (Get-Item -LiteralPath $sourceExecutable).Length },
    [ordered]@{ path = 'app/resources/app.asar'; sha256 = Get-Sha256Hex -Path $sourceAppArchive; bytes = (Get-Item -LiteralPath $sourceAppArchive).Length },
    [ordered]@{ path = "release/$installerName"; sha256 = Get-Sha256Hex -Path $sourceInstaller; bytes = (Get-Item -LiteralPath $sourceInstaller).Length }
  )
  $manifestState['artifacts'] = $sourceArtifacts
  $checksum = [ordered]@{
    commit = $fullSha
    version = $version
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    artifacts = $sourceArtifacts
  }
  Write-JsonAtomically -Path $checksumsPath -Value $checksum

  New-Item -ItemType Directory -Path $testStaging -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $releaseStaging -ErrorAction Stop | Out-Null
  Write-JsonAtomically -Path (Join-Path $testStaging '.hitmuse-build-owner.json') -Value ([ordered]@{ sessionId = $sessionId; commit = $fullSha })
  Write-JsonAtomically -Path (Join-Path $releaseStaging '.hitmuse-build-owner.json') -Value ([ordered]@{ sessionId = $sessionId; commit = $fullSha })
  Copy-Item -LiteralPath $unpackedDirectory -Destination (Join-Path $testStaging 'app') -Recurse -ErrorAction Stop
  Copy-Item -LiteralPath $sourceInstaller -Destination (Join-Path $releaseStaging $installerName) -ErrorAction Stop
  foreach ($artifact in $sourceArtifacts) {
    $copiedPath = if ($artifact.path.StartsWith('app/')) {
      Join-Path $testStaging ($artifact.path -replace '/', '\\')
    } else {
      Join-Path $releaseStaging $installerName
    }
    if (-not (Test-Path -LiteralPath $copiedPath -PathType Leaf)) {
      throw "STAGED_ARTIFACT_MISSING: $copiedPath"
    }
    $copiedHash = Get-Sha256Hex -Path $copiedPath
    if ($copiedHash -ne $artifact.sha256) {
      throw "STAGED_ARTIFACT_HASH_MISMATCH: $copiedPath"
    }
  }

  $currentStage = 'generate-release-evidence'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  New-Item -ItemType Directory -Path $privacyRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $publicEvidenceSource -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $publicEvidenceSource 'docs') -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $publicEvidenceSource 'guides') -ErrorAction Stop | Out-Null
  $sourceBlockmap = "$sourceInstaller.blockmap"
  $sourceLatest = Join-Path $buildWorktree 'release\latest.yml'
  $sourceEngineManifest = Join-Path $buildWorktree '.build-resources\scrapling-engine\engine-manifest.json'
  $sourceEngineProvenance = Join-Path $buildWorktree '.build-resources\scrapling-engine\engine-provenance.json'
  $sourceGuideDocx = Join-Path $buildWorktree 'release\guides\competitor-content-radar-user-guide.docx'
  $sourceGuideMarkdown = Join-Path $buildWorktree 'release\guides\competitor-content-radar-user-guide.md'
  foreach ($sourcePublicAsset in @($sourceBlockmap, $sourceLatest, $sourceEngineManifest, $sourceEngineProvenance, $sourceGuideDocx, $sourceGuideMarkdown)) {
    if (-not (Test-Path -LiteralPath $sourcePublicAsset -PathType Leaf)) {
      throw "PUBLIC_EVIDENCE_REQUIRED_ASSET_MISSING: $sourcePublicAsset"
    }
  }
  Copy-Item -LiteralPath $sourceInstaller -Destination (Join-Path $publicEvidenceSource $installerName) -ErrorAction Stop
  Copy-Item -LiteralPath $sourceBlockmap -Destination (Join-Path $publicEvidenceSource "$installerName.blockmap") -ErrorAction Stop
  Copy-Item -LiteralPath $sourceLatest -Destination (Join-Path $publicEvidenceSource 'latest.yml') -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $buildWorktree 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $publicEvidenceSource 'THIRD_PARTY_NOTICES.md') -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $buildWorktree 'docs\resources-and-licenses.md') -Destination (Join-Path $publicEvidenceSource 'docs\resources-and-licenses.md') -ErrorAction Stop
  Copy-Item -LiteralPath $sourceEngineManifest -Destination (Join-Path $publicEvidenceSource 'engine-manifest.json') -ErrorAction Stop
  Copy-Item -LiteralPath $sourceEngineProvenance -Destination (Join-Path $publicEvidenceSource 'engine-provenance.json') -ErrorAction Stop
  Copy-Item -LiteralPath $sourceGuideDocx -Destination (Join-Path $publicEvidenceSource 'guides\competitor-content-radar-user-guide.docx') -ErrorAction Stop
  Copy-Item -LiteralPath $sourceGuideMarkdown -Destination (Join-Path $publicEvidenceSource 'guides\competitor-content-radar-user-guide.md') -ErrorAction Stop
  Invoke-NativeStep -Name 'generate-release-evidence' -FilePath 'node.exe' -ArgumentList @('scripts/generate-release-evidence.mjs', $publicEvidenceSource, $publicEvidenceOutput, $fullSha, $version) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  $publicEvidenceFiles = @('SHA256SUMS.txt', 'checksums.json', 'build-manifest.json', 'acceptance.log', 'THIRD_PARTY_NOTICES.md', 'docs\resources-and-licenses.md', 'engine-manifest.json', 'engine-provenance.json', 'guides\competitor-content-radar-user-guide.docx', 'guides\competitor-content-radar-user-guide.md', 'latest.yml', $installerName, "$installerName.blockmap")
  foreach ($publicEvidenceFile in $publicEvidenceFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $publicEvidenceOutput $publicEvidenceFile) -PathType Leaf)) {
      throw "PUBLIC_EVIDENCE_OUTPUT_MISSING: $publicEvidenceFile"
    }
  }
  foreach ($publicEvidenceFile in $publicEvidenceFiles) {
    $sourcePublicEvidence = Join-Path $publicEvidenceOutput $publicEvidenceFile
    foreach ($stagingRoot in @($releaseStaging)) {
      $stagedPublicEvidence = Join-Path $stagingRoot $publicEvidenceFile
      $stagedParent = Split-Path -Parent $stagedPublicEvidence
      if (-not (Test-Path -LiteralPath $stagedParent)) {
        New-Item -ItemType Directory -Path $stagedParent -ErrorAction Stop | Out-Null
      }
      if (Test-Path -LiteralPath $stagedPublicEvidence) {
        if ((Get-Sha256Hex -Path $sourcePublicEvidence) -ne (Get-Sha256Hex -Path $stagedPublicEvidence)) {
          throw "STAGED_PUBLIC_EVIDENCE_MISMATCH: $stagedPublicEvidence"
        }
      } else {
        Copy-Item -LiteralPath $sourcePublicEvidence -Destination $stagedPublicEvidence -ErrorAction Stop
      }
    }
  }
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'generate-release-evidence.log')

  $currentStage = 'verify-public-candidate'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  $publicCandidateArchive = Join-Path $privacyRoot 'candidate.zip'
  Invoke-NativeStep -Name 'git-archive-public-candidate' -FilePath 'git' -ArgumentList @('-C', $canonicalRepo, 'archive', '--format=zip', "--output=$publicCandidateArchive", $fullSha) -WorkingDirectory $canonicalRepo -LogDirectory $logDirectory | Out-Null
  Expand-Archive -LiteralPath $publicCandidateArchive -DestinationPath $publicCandidateRoot -ErrorAction Stop
  Invoke-NativeStep -Name 'verify-public-candidate' -FilePath 'node.exe' -ArgumentList @('scripts/verify-public-candidate.mjs', '--candidate', $publicCandidateRoot) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'verify-public-candidate.log')

  $currentStage = 'scan-public-secrets'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'git-clone-public-repository' -FilePath 'git' -ArgumentList @('clone', '--no-hardlinks', '--quiet', $canonicalRepo, $privacyRepositoryRoot) -WorkingDirectory $sessionDirectory -LogDirectory $logDirectory | Out-Null
  Invoke-NativeStep -Name 'git-checkout-public-repository' -FilePath 'git' -ArgumentList @('-C', $privacyRepositoryRoot, 'checkout', '--detach', '--quiet', $fullSha) -WorkingDirectory $sessionDirectory -LogDirectory $logDirectory | Out-Null
  New-Item -ItemType Directory -Path $privacyReleaseRoot -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $unpackedDirectory -Destination (Join-Path $privacyReleaseRoot 'unpacked') -Recurse -ErrorAction Stop
  Copy-Item -LiteralPath $releaseStaging -Destination (Join-Path $privacyReleaseRoot 'final-release') -Recurse -ErrorAction Stop
  Invoke-NativeStep -Name 'scan-public-secrets' -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/scan-public-secrets.ps1', '-CandidateRoot', $publicCandidateRoot, '-RepositoryRoot', $privacyRepositoryRoot, '-ReleaseRoot', $privacyReleaseRoot, '-ReportRoot', $privacyReportRoot, '-ToolRoot', $privacyToolRoot) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED' -LogPath (Join-Path $logDirectory 'scan-public-secrets.log')

  $currentStage = 'visual-privacy-review'
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  Invoke-NativeStep -Name 'build-visual-privacy-manifest' -FilePath 'node.exe' -ArgumentList @('scripts/build-visual-privacy-manifest.mjs', '--candidate-root', $publicCandidateRoot, '--release-root', $privacyReleaseRoot, '--report-path', $visualPrivacyReport) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  $visualManifestSha256 = Get-Sha256Hex -Path $visualPrivacyReport
  $visualManifest = Get-Content -LiteralPath $visualPrivacyReport -Raw -Encoding utf8 | ConvertFrom-Json
  if ($null -eq $visualManifest.assets) { throw 'VISUAL_PRIVACY_REVIEW_INVALID: generated manifest has no assets' }
  $visualPrivacyReviewTemplate = Join-Path $reviewRoot "visual-privacy-review-$fullSha-$visualManifestSha256.json"
  $reviewTemplate = [ordered]@{
    schemaVersion = 1
    commit = $fullSha
    visualManifestSha256 = $visualManifestSha256
    assets = @($visualManifest.assets | ForEach-Object { [ordered]@{ path = $_.path; bytes = $_.bytes; sha256 = $_.sha256; result = 'PENDING' } })
  }
  if ([string]::IsNullOrWhiteSpace($VisualPrivacyReview)) {
    if (-not (Test-Path -LiteralPath $visualPrivacyReviewTemplate)) {
      Write-JsonAtomically -Path $visualPrivacyReviewTemplate -Value $reviewTemplate
    }
    Write-SessionLog -LogPath $scriptLog -Message "VISUAL_PRIVACY_REVIEW_REQUIRED: human review is required; this workflow never auto-passes visual privacy. template=$visualPrivacyReviewTemplate manifest=$visualPrivacyReport"
    throw 'VISUAL_PRIVACY_REVIEW_REQUIRED: inspect and mark the external visual privacy review template before a separate authorized release promotion.'
  }
  $reviewPath = ConvertTo-AbsolutePath -Path $VisualPrivacyReview -Label 'VISUAL_PRIVACY_REVIEW'
  Invoke-NativeStep -Name 'read-visual-privacy-review-binding' -FilePath 'node.exe' -ArgumentList @('scripts/verify-visual-privacy-review.mjs', '--read-binding', '--review', $reviewPath, '--review-root', $reviewRoot, '--binding-output', $visualPrivacyReviewBinding) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  $reviewBinding = Get-Content -LiteralPath $visualPrivacyReviewBinding -Raw -Encoding utf8 | ConvertFrom-Json
  if ($reviewBinding.commit -ne $fullSha -or $reviewBinding.visualManifestSha256 -ne $visualManifestSha256) {
    if (-not (Test-Path -LiteralPath $visualPrivacyReviewTemplate)) {
      Write-JsonAtomically -Path $visualPrivacyReviewTemplate -Value $reviewTemplate
    }
    Write-SessionLog -LogPath $scriptLog -Message "VISUAL_PRIVACY_REVIEW_REQUIRED: supplied review is bound to another manifest or commit. template=$visualPrivacyReviewTemplate manifest=$visualPrivacyReport"
    throw 'VISUAL_PRIVACY_REVIEW_REQUIRED: inspect and mark the external visual privacy review template before a separate authorized release promotion.'
  }
  Invoke-NativeStep -Name 'verify-visual-privacy-review' -FilePath 'node.exe' -ArgumentList @('scripts/verify-visual-privacy-review.mjs', '--manifest', $visualPrivacyReport, '--review', $reviewPath, '--commit', $fullSha, '--review-root', $reviewRoot) -WorkingDirectory $buildWorktree -LogDirectory $logDirectory | Out-Null
  Write-SessionLog -LogPath $scriptLog -Message "VISUAL_PRIVACY_REVIEW_PASSED review=$reviewPath manifest=$visualPrivacyReport"

  $readyToPublish = $true
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED'
} catch {
  $capturedFailure = $_
  $failureRecord = [ordered]@{ status = 'FAILED'; failedStage = $currentStage }
  $manifestState['status'] = $failureRecord.status
  $manifestState['failedStage'] = $currentStage
  $manifestState['error'] = $_.Exception.Message
  $manifestState['completedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
  try {
    Write-JsonAtomically -Path $sessionManifest -Value $manifestState
  } catch {
    Write-SessionLog -LogPath $scriptLog -Message "FAILED_MANIFEST_WRITE_ERROR message=$($_.Exception.Message)"
  }
  Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_FAILED message=$($_.Exception.Message) session=$sessionDirectory"
} finally {
  $cleanupFailures = @()
  $removedPaths = @()

  if (Test-Path -LiteralPath $packageSmokeRoot) {
    try {
      Remove-SessionOwnedDirectory -Path $packageSmokeRoot -ApprovedParent $testRoot -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -OwnerField 'packageSmokeRoot' -LogPath $scriptLog -ExactOwner
      $removedPaths += $packageSmokeRoot
    } catch {
      $reasonPrefix = ConvertFrom-Utf8Base64 '54Of6Zu+5rWL6K+V55uu5b2V5a6J5YWo5riF55CG5aSx6LSl77ya'
      $cleanupFailures += [ordered]@{ path = $packageSmokeRoot; reason = "$reasonPrefix$($_.Exception.Message)" }
    }
  }

  $registeredWorktree = $false
  try {
    $registeredWorktree = Test-RegisteredWorktree -CanonicalRepository $canonicalRepo -WorktreePath $buildWorktree -LogPath $scriptLog
  } catch {
    Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_WORKTREE_CLEANUP_BLOCKED: registration check failed: $($_.Exception.Message) path=$buildWorktree"
    $reasonPrefix = ConvertFrom-Utf8Base64 '5peg5rOV56Gu6K6k5Li05pe2IHdvcmt0cmVlIOeahCBHaXQg55m76K6w77ya'
    $cleanupFailures += [ordered]@{ path = $buildWorktree; reason = "$reasonPrefix$($_.Exception.Message)" }
  }
  if ($worktreeAdded -or $registeredWorktree) {
    if ([string]::IsNullOrWhiteSpace($fullSha) -or $fullSha -notmatch '^[0-9a-f]{40}$') {
      $message = 'CLEAN_TEST_WORKTREE_CLEANUP_BLOCKED: full commit was not resolved'
      Write-SessionLog -LogPath $scriptLog -Message $message
      $reason = ConvertFrom-Utf8Base64 '5peg5rOV56Gu6K6k5pys6L2u5a6M5pW0IEdpdCBjb21taXTvvIzlt7LnpoHmraLliKDpmaTkuLTml7Ygd29ya3RyZWXjgII='
      $cleanupFailures += [ordered]@{ path = $buildWorktree; reason = $reason }
    } else {
      foreach ($relativeGeneratedPath in @('.build-resources', 'node_modules', 'out', 'release', 'engine\scrapling\.venv')) {
        $generatedPath = Join-Path $buildWorktree $relativeGeneratedPath
        if (Test-Path -LiteralPath $generatedPath) {
          try {
            Remove-SessionOwnedDirectory -Path $generatedPath -ApprovedParent $buildWorktree -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -OwnerField 'buildWorktree' -LogPath $scriptLog
            $removedPaths += $generatedPath
          } catch {
            $reasonPrefix = ConvertFrom-Utf8Base64 '5Li05pe25p6E5bu655uu5b2V5a6J5YWo5riF55CG5aSx6LSl77ya'
            $cleanupFailures += [ordered]@{ path = $generatedPath; reason = "$reasonPrefix$($_.Exception.Message)" }
          }
        }
      }
      try {
        Remove-VerifiedWorktree -CanonicalRepository $canonicalRepo -BuildDirectory $buildRoot -WorktreePath $buildWorktree -ExpectedCommit $fullSha -SessionDirectory $sessionDirectory -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -LogDirectory $logDirectory
        $removedPaths += $buildWorktree
        Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_WORKTREE_REMOVED path=$buildWorktree"
      } catch {
        Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_WORKTREE_CLEANUP_BLOCKED: retained path=$buildWorktree message=$($_.Exception.Message)"
        $reasonPrefix = ConvertFrom-Utf8Base64 '5Li05pe2IHdvcmt0cmVlIOacquWIoOmZpO+8mg=='
        $cleanupFailures += [ordered]@{ path = $buildWorktree; reason = "$reasonPrefix$($_.Exception.Message)" }
      }
    }
  } elseif (Test-Path -LiteralPath $buildWorktree) {
    try {
      Remove-SessionOwnedDirectory -Path $buildWorktree -ApprovedParent $worktreesRoot -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -OwnerField 'buildWorktree' -LogPath $scriptLog -ExactOwner
      $removedPaths += $buildWorktree
    } catch {
      $reasonPrefix = ConvertFrom-Utf8Base64 '5Li05pe2IHdvcmt0cmVlIOacquWIoOmZpO+8mg=='
      $cleanupFailures += [ordered]@{ path = $buildWorktree; reason = "$reasonPrefix$($_.Exception.Message)" }
    }
  }

  if ($cleanupFailures.Count -gt 0) {
    $cleanupBlocked = $true
    if ($null -eq $capturedFailure) {
      $manifestState['status'] = 'FAILED'
      $manifestState['failedStage'] = 'cleanup'
      $manifestState['error'] = ConvertFrom-Utf8Base64 '5riF55CG5a6J5YWo5qOA5p+l5aSx6LSl77yM5pyq55Sf5oiQ5q2j5byP5Lqn54mp44CC'
      $manifestState['completedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
    }
  }

  if ($null -ne $capturedFailure -or $cleanupBlocked) {
    foreach ($stagingTarget in @(
      [ordered]@{ path = $testStaging; parent = $testRoot; field = 'testStaging' },
      [ordered]@{ path = $releaseStaging; parent = $releaseRoot; field = 'releaseStaging' }
    )) {
      if (Test-Path -LiteralPath $stagingTarget.path) {
        try {
          Remove-SessionOwnedDirectory -Path $stagingTarget.path -ApprovedParent $stagingTarget.parent -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -OwnerField $stagingTarget.field -LogPath $scriptLog -ExactOwner
          $removedPaths += $stagingTarget.path
        } catch {
          $reasonPrefix = ConvertFrom-Utf8Base64 '5aSx6LSl5Lqn54mp5pqC5a2Y55uu5b2V5a6J5YWo5riF55CG5aSx6LSl77ya'
          $cleanupFailures += [ordered]@{ path = $stagingTarget.path; reason = "$reasonPrefix$($_.Exception.Message)" }
          $cleanupBlocked = $true
        }
      }
    }
  }

  $manifestState['cleanup']['status'] = if ($cleanupBlocked) { 'BLOCKED' } else { 'COMPLETED' }
  $manifestState['cleanup']['removed'] = $removedPaths
  $manifestState['cleanup']['retained'] = $cleanupFailures
  try {
    Write-JsonAtomically -Path $sessionManifest -Value $manifestState
  } catch {
    Write-SessionLog -LogPath $scriptLog -Message "FINAL_CLEANUP_MANIFEST_WRITE_ERROR message=$($_.Exception.Message)"
    $cleanupBlocked = $true
  }
}

if ($null -ne $capturedFailure -or $cleanupBlocked) {
  $buildFailedMessage = ConvertFrom-Utf8Base64 '5p6E5bu65aSx6LSl44CC6ZSZ6K+v5pel5b+X5ZKMIG1hbmlmZXN0IOW3suS/neeVme+8mg=='
  Write-Host "$buildFailedMessage$sessionDirectory"
  if ($cleanupBlocked) {
    Write-Host (ConvertFrom-Utf8Base64 '5p6E5bu65riF55CG5pyq5a6M5oiQ77yM5Lul5LiL6Lev5b6E5Zug5a6J5YWo5qCh6aqM5aSx6LSl6ICM5L+d55WZ77ya')
    foreach ($retained in $manifestState['cleanup']['retained']) {
      $separator = ConvertFrom-Utf8Base64 '77ya'
      Write-Host "- $($retained.path)$separator$($retained.reason)"
    }
  }
  if ($null -ne $capturedFailure) {
    throw $capturedFailure
  }
  $reason = ConvertFrom-Utf8Base64 '5riF55CG5a6J5YWo5qCh6aqM5aSx6LSl77yM5pyq55Sf5oiQ5q2j5byP5Lqn54mp44CC'
  throw "BUILD_CLEANUP_BLOCKED: $reason"
}

if (-not $readyToPublish) {
  $reason = ConvertFrom-Utf8Base64 '5p6E5bu65rKh5pyJ5aSx6LSl77yM5L2G5Lmf5rKh5pyJ55Sf5oiQ57uP6L+H6aqM6K+B55qE5pqC5a2Y5Lqn54mp44CC'
  throw "BUILD_NOT_READY_TO_PUBLISH: $reason"
}

$currentStage = 'publish-verified-artifacts'
try {
  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'RUNNING'
  $manifestState['status'] = 'FINALIZING'
  $manifestState['failedStage'] = $null
  $manifestState['error'] = $null
  Write-JsonAtomically -Path $sessionManifest -Value $manifestState
  Copy-Item -LiteralPath $sessionManifest -Destination (Join-Path $testStaging 'build-manifest.json') -ErrorAction Stop
  Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $testStaging 'checksums.json') -ErrorAction Stop
  Copy-Item -LiteralPath $scriptLog -Destination (Join-Path $testStaging 'build-summary.log') -ErrorAction Stop

  Publish-VerifiedArtifacts -TestStaging $testStaging -CleanRoot $cleanRoot -ReleaseStaging $releaseStaging -ReleaseOutput $releaseOutput
  foreach ($artifact in $sourceArtifacts) {
    $finalPath = if ($artifact.path.StartsWith('app/')) {
      Join-Path $cleanRoot ($artifact.path -replace '/', '\')
    } else {
      Join-Path $releaseOutput $installerName
    }
    if ((Get-Sha256Hex -Path $finalPath) -ne $artifact.sha256) {
      throw "FINAL_ARTIFACT_HASH_MISMATCH: $finalPath"
    }
  }

  Set-BuildStage -Manifest $manifestState -ManifestPath $sessionManifest -Name $currentStage -Status 'PASSED'
  $manifestState['status'] = 'COMPLETED'
  $manifestState['currentStage'] = 'completed'
  $manifestState['completedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonAtomically -Path $sessionManifest -Value $manifestState
  Copy-Item -LiteralPath $sessionManifest -Destination (Join-Path $cleanRoot 'build-manifest.json') -Force -ErrorAction Stop
  Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $cleanRoot 'checksums.json') -Force -ErrorAction Stop
  Copy-Item -LiteralPath $scriptLog -Destination (Join-Path $cleanRoot 'build-summary.log') -Force -ErrorAction Stop
  Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_SUCCESS cleanRoot=$cleanRoot releaseOutput=$releaseOutput manifest=$sessionManifest"
} catch {
  $publishFailure = $_
  $manifestState['status'] = 'FAILED'
  $manifestState['failedStage'] = $currentStage
  $manifestState['error'] = $_.Exception.Message
  $manifestState['completedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonAtomically -Path $sessionManifest -Value $manifestState
  foreach ($publishedTarget in @(
    [ordered]@{ path = $testStaging; parent = $testRoot; field = 'testStaging' },
    [ordered]@{ path = $cleanRoot; parent = $testRoot; field = 'cleanRoot' },
    [ordered]@{ path = $releaseStaging; parent = $releaseRoot; field = 'releaseStaging' },
    [ordered]@{ path = $releaseOutput; parent = $releaseRoot; field = 'releaseOutput' }
  )) {
    if (Test-Path -LiteralPath $publishedTarget.path) {
      try {
        Remove-SessionOwnedDirectory -Path $publishedTarget.path -ApprovedParent $publishedTarget.parent -SessionMarker $sessionMarker -ExpectedSessionId $sessionId -OwnerField $publishedTarget.field -LogPath $scriptLog -ExactOwner
      } catch {
        $cleanupMessage = ConvertFrom-Utf8Base64 '5p6E5bu65riF55CG5pyq5a6M5oiQ77ya'
        $separator = ConvertFrom-Utf8Base64 '77ya'
        Write-Host "$cleanupMessage$($publishedTarget.path)$separator$($_.Exception.Message)"
      }
    }
  }
  throw $publishFailure
}

if (-not $NoLaunch) {
  try {
    $launchedProcess = Start-Process -FilePath (Join-Path $cleanRoot 'app\HitMuse.exe') -ArgumentList @("--hitmuse-user-data-dir=$userDataDirectory") -PassThru -ErrorAction Stop
    Write-SessionLog -LogPath $scriptLog -Message "CLEAN_TEST_APP_LAUNCHED pid=$($launchedProcess.Id) userData=$userDataDirectory"
  } catch {
    $launchMessage = ConvertFrom-Utf8Base64 '5pyA57uI5Lqn54mp5bey6aqM6K+B5bm25L+d55WZ77yM5L2G5Lqk5LqS5ZCv5Yqo5aSx6LSl77ya'
    Write-Host "$launchMessage$($_.Exception.Message)"
  }
} else {
  Write-SessionLog -LogPath $scriptLog -Message 'CLEAN_TEST_APP_NOT_LAUNCHED noLaunch=true'
}
