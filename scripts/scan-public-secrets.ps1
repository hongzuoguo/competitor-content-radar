[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CandidateRoot,
  [Parameter(Mandatory = $true)][string]$RepositoryRoot,
  [Parameter(Mandatory = $true)][string]$ReleaseRoot,
  [Parameter(Mandatory = $true)][string]$ReportRoot,
  [Parameter(Mandatory = $true)][string]$ToolRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$scanExit = 20
$stage = 'paths'
$reportValidated = $false
$safeFailureReport = $null
$reportLock = $null

if (-not ('HitMuseReportRootNative' -as [type])) {
  Add-Type -TypeDefinition @'
using Microsoft.Win32.SafeHandles;
using System;
using System.Runtime.InteropServices;
public static class HitMuseReportRootNative {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] public static extern SafeFileHandle CreateFileHandle(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool GetFileInformationByHandle(IntPtr handle,out Info info);
}
'@
}

function Open-LockedReportRoot([string]$Path) {
  Assert-NoReparsePoint $Path 'PUBLIC_SECRET_SCAN_REPARSE_POINT'
  $genericRead = [uint32]::Parse('80000000', [System.Globalization.NumberStyles]::HexNumber)
  $shareReadWrite = [uint32]3
  $openExisting = [uint32]3
  $backupSemantics = [uint32]::Parse('02000000', [System.Globalization.NumberStyles]::HexNumber)
  $openReparsePoint = [uint32]::Parse('00200000', [System.Globalization.NumberStyles]::HexNumber)
  # Omitting FILE_SHARE_DELETE pins this directory's path identity through every report write.
  $handle = [HitMuseReportRootNative]::CreateFileHandle($Path, $genericRead, $shareReadWrite, [IntPtr]::Zero, $openExisting, ($backupSemantics -bor $openReparsePoint), [IntPtr]::Zero)
  if ($handle.IsInvalid) { throw 'PUBLIC_SECRET_SCAN_REPORT_ROOT_OPEN_FAILED' }
  try {
    $info = New-Object HitMuseReportRootNative+Info
    if (-not [HitMuseReportRootNative]::GetFileInformationByHandle($handle.DangerousGetHandle(), [ref]$info)) { throw 'PUBLIC_SECRET_SCAN_REPORT_ROOT_IDENTITY_FAILED' }
    if (($info.Attributes -band 0x400) -ne 0) { throw 'PUBLIC_SECRET_SCAN_REPARSE_POINT' }
    if (($info.Attributes -band 0x10) -eq 0) { throw 'PUBLIC_SECRET_SCAN_REPORT_ROOT_INVALID' }
    return $handle
  } catch {
    $handle.Dispose()
    throw
  }
}

function New-LockedRegularFile([string]$Path, [string]$Code, [bool]$AllowConcurrentWrites) {
  $genericReadWrite = [uint32]::Parse('C0000000', [System.Globalization.NumberStyles]::HexNumber)
  $share = if ($AllowConcurrentWrites) { [uint32]3 } else { [uint32]1 }
  $createNew = [uint32]1
  $openReparsePoint = [uint32]::Parse('00200000', [System.Globalization.NumberStyles]::HexNumber)
  $handle = [HitMuseReportRootNative]::CreateFileHandle($Path, $genericReadWrite, $share, [IntPtr]::Zero, $createNew, $openReparsePoint, [IntPtr]::Zero)
  if ($handle.IsInvalid) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 80) { return $null }
    throw "${Code}_OPEN_FAILED"
  }
  try {
    $info = New-Object HitMuseReportRootNative+Info
    if (-not [HitMuseReportRootNative]::GetFileInformationByHandle($handle.DangerousGetHandle(), [ref]$info)) { throw "${Code}_IDENTITY_FAILED" }
    if (($info.Attributes -band 0x400) -ne 0 -or ($info.Attributes -band 0x10) -ne 0) { throw "${Code}_INVALID" }
    return $handle
  } catch {
    $handle.Dispose()
    throw
  }
}

function Write-LockedText([object]$Handle, [string]$Text) {
  $stream = [System.IO.FileStream]::new($Handle, [System.IO.FileAccess]::ReadWrite, 4096, $false)
  try {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream.Position = 0
    $stream.SetLength(0)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    $stream.Dispose()
  }
}

function Read-LockedText([object]$Handle) {
  $stream = [System.IO.FileStream]::new($Handle, [System.IO.FileAccess]::ReadWrite, 4096, $false)
  try {
    $stream.Position = 0
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false, $true), $true, 4096, $true)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Write-NewReportSummary([string]$ReportDirectory, [string]$Text) {
  $summaryPath = Join-Path $ReportDirectory 'public-secret-scan-summary.json'
  $handle = New-LockedRegularFile $summaryPath 'PUBLIC_SECRET_SCAN_SUMMARY' $false
  if ($null -eq $handle) { return $false }
  try {
    Write-LockedText $handle $Text
    return $true
  } finally {
    $handle.Dispose()
  }
}

function New-TransientReportWorkspace([string]$ToolDirectory) {
  $path = Join-Path $ToolDirectory "secret-scan-$PID-$([guid]::NewGuid().ToString('N'))"
  [System.IO.Directory]::CreateDirectory($path) | Out-Null
  return [pscustomobject]@{ Path = $path; Handle = Open-LockedReportRoot $path }
}

function New-TransientReportFile([object]$Workspace, [string]$Suffix) {
  $path = Join-Path $Workspace.Path "$([guid]::NewGuid().ToString('N')).$Suffix"
  $handle = New-LockedRegularFile $path 'PUBLIC_SECRET_SCAN_TRANSIENT_FILE' $true
  if ($null -eq $handle) { throw 'PUBLIC_SECRET_SCAN_TRANSIENT_FILE_EXISTS' }
  return [pscustomobject]@{ Path = $path; Handle = $handle }
}

function Remove-TransientReportFile([object]$File) {
  try {
    $File.Handle.Dispose()
  } finally {
    [System.IO.File]::Delete($File.Path)
  }
}

function Remove-TransientReportWorkspace([object]$Workspace) {
  try {
    $Workspace.Handle.Dispose()
  } finally {
    [System.IO.Directory]::Delete($Workspace.Path, $false)
  }
}

function New-TransientGitleaksConfig([object]$Workspace, [string]$BaseConfigPath, [string]$AppendText) {
  $file = New-TransientReportFile $Workspace 'config.toml'
  try {
    $base = Get-Content -LiteralPath $BaseConfigPath -Raw -Encoding utf8
    Write-LockedText $file.Handle ($base.TrimEnd() + "`r`n" + $AppendText.Trim() + "`r`n")
    return $file
  } catch {
    Remove-TransientReportFile $file
    throw
  }
}

function ConvertTo-ExtendedLengthPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full.StartsWith('\\')) { return '\\?\UNC\' + $full.Substring(2) }
  return '\\?\' + $full
}

if (-not ('HitMuseAclNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HitMuseAclNative {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern uint GetNamedSecurityInfo(string name,uint objectType,uint securityInfo,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr securityDescriptor);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)][return:MarshalAs(UnmanagedType.Bool)] public static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr securityDescriptor,uint revision,uint securityInfo,out IntPtr text,out uint textLength);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="ConvertStringSecurityDescriptorToSecurityDescriptorW")][return:MarshalAs(UnmanagedType.Bool)] public static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr securityDescriptor,out uint securityDescriptorSize);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="SetFileSecurityW")][return:MarshalAs(UnmanagedType.Bool)] public static extern bool SetFileSecurity(string name,uint securityInfo,IntPtr securityDescriptor);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr LocalFree(IntPtr memory);
}
'@
}

function Get-ToolRootSddl([string]$Path) {
  $owner=[IntPtr]::Zero; $group=[IntPtr]::Zero; $dacl=[IntPtr]::Zero; $sacl=[IntPtr]::Zero; $descriptor=[IntPtr]::Zero; $text=[IntPtr]::Zero; $length=0
  try {
    if ([HitMuseAclNative]::GetNamedSecurityInfo($Path,1,5,[ref]$owner,[ref]$group,[ref]$dacl,[ref]$sacl,[ref]$descriptor) -ne 0) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
    if (-not [HitMuseAclNative]::ConvertSecurityDescriptorToStringSecurityDescriptor($descriptor,1,5,[ref]$text,[ref]$length)) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
    return [Runtime.InteropServices.Marshal]::PtrToStringUni($text)
  } finally { if ($text -ne [IntPtr]::Zero) { [HitMuseAclNative]::LocalFree($text)|Out-Null }; if ($descriptor -ne [IntPtr]::Zero) { [HitMuseAclNative]::LocalFree($descriptor)|Out-Null } }
}

function Test-AbsoluteWindowsPath([string]$Path) {
  return $Path -match '^[A-Za-z]:[\\/]' -or $Path -match '^\\\\[^\\]+\\[^\\]+'
}

function Assert-AbsolutePath([string]$Path, [string]$Code) {
  if (-not (Test-AbsoluteWindowsPath $Path)) { throw $Code }
  if ($Path -match '^\\\\[^\\]+\\[^\\]+[\\/]?$') { return ($Path -replace '[\\/]+$', '') + '\' }
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full -eq $root) { return $root }
  return $full.TrimEnd('\')
}

function Assert-SupportedToolDriveType([System.IO.DriveType]$DriveType) {
  if ($DriveType -eq [System.IO.DriveType]::Fixed -or $DriveType -eq [System.IO.DriveType]::Ram) { return }
  throw 'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL'
}

function Assert-LocalToolRootPath([string]$ToolDirectory) {
  if ($ToolDirectory -notmatch '^[A-Za-z]:[\\/]') { throw 'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL' }
  try {
    $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($ToolDirectory))
    Assert-SupportedToolDriveType $drive.DriveType
  } catch {
    throw 'PUBLIC_SECRET_SCAN_TOOL_ROOT_NOT_LOCAL'
  }
  return $ToolDirectory
}

function Assert-NoReparsePoint([string]$Path, [string]$Code) {
  $current = $Path
  while (-not (Test-Path -LiteralPath $current)) {
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) { throw $Code }
    $current = $parent.FullName
  }
  while ($true) {
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw $Code }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) { return }
    $current = $parent.FullName
  }
}

function Assert-Directory([string]$Path, [string]$Code) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw $Code }
}

function Test-PathOverlap([string]$Left, [string]$Right) {
  $leftPrefix = $Left.TrimEnd('\') + '\'
  $rightPrefix = $Right.TrimEnd('\') + '\'
  return $Left -eq $Right -or $Left.StartsWith($rightPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or $Right.StartsWith($leftPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-SafeRelativePath([string]$Root, [string]$Path) {
  $full = if (Test-AbsoluteWindowsPath $Path) { [System.IO.Path]::GetFullPath($Path) } else { [System.IO.Path]::GetFullPath((Join-Path $Root $Path)) }
  $prefix = $Root.TrimEnd('\') + '\'
  if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return '<outside-root>' }
  return $full.Substring($prefix.Length).Replace('\', '/')
}

function Get-Sha256([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes($Path))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Assert-ToolRootAcl([string]$ToolDirectory) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $sddl = Get-ToolRootSddl $ToolDirectory
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($sddl)
  $trustedOwners = @($sid, 'S-1-5-32-544')
  if ($descriptor.Owner.Value -notin $trustedOwners) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
  $protected = [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
  if (($descriptor.ControlFlags -band $protected) -eq 0) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
  $expectedSids = @('S-1-5-32-544', 'S-1-5-18', $sid)
  $expectedFlags = [Security.AccessControl.AceFlags]([int][Security.AccessControl.AceFlags]::ObjectInherit -bor [int][Security.AccessControl.AceFlags]::ContainerInherit)
  $expectedMask = [int][Security.AccessControl.FileSystemRights]::FullControl
  $actual = @($descriptor.DiscretionaryAcl)
  if ($actual.Count -ne $expectedSids.Count) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
  foreach ($expectedSid in $expectedSids) {
    $matches = @($actual | Where-Object {
      $_.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
      $_.AceFlags -eq $expectedFlags -and
      $_.AccessMask -eq $expectedMask -and
      $_.SecurityIdentifier.Value -eq $expectedSid
    })
    if ($matches.Count -ne 1) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
  }
}

function Initialize-ToolRoot([string]$ToolDirectory) {
  $exists = Test-Path -LiteralPath $ToolDirectory
  if ($exists -and -not (Test-Path -LiteralPath $ToolDirectory -PathType Container)) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_INVALID' }
  if ($exists -and @((Get-ChildItem -LiteralPath $ToolDirectory -Force)).Count -gt 0) {
    Assert-ToolRootAcl $ToolDirectory
    return
  }
  New-Item -ItemType Directory -Path $ToolDirectory -Force | Out-Null
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $descriptor = [IntPtr]::Zero
  $descriptorSize = [uint32]0
  try {
    if (-not [HitMuseAclNative]::ConvertStringSecurityDescriptorToSecurityDescriptor("O:${sid}D:P(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)(A;OICI;FA;;;$sid)", 1, [ref]$descriptor, [ref]$descriptorSize)) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
    if (-not [HitMuseAclNative]::SetFileSecurity($ToolDirectory, [uint32]4, $descriptor)) { throw 'PUBLIC_SECRET_SCAN_TOOL_CACHE_ACL_INVALID' }
  } finally {
    if ($descriptor -ne [IntPtr]::Zero) { [HitMuseAclNative]::LocalFree($descriptor) | Out-Null }
  }
  Assert-ToolRootAcl $ToolDirectory
}

function Get-ToolRootMutexName([string]$ToolDirectory) {
  $canonical = [System.IO.Path]::GetFullPath($ToolDirectory).TrimEnd('\').ToLowerInvariant()
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  return 'Global\HitMuse.Gitleaks.ToolRoot.' + $hash
}

function Enter-ToolRootBootstrapMutex([string]$ToolDirectory) {
  $name = Get-ToolRootMutexName $ToolDirectory
  $mutex = [System.Threading.Mutex]::new($false, $name)
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(60))
    } catch [System.Threading.AbandonedMutexException] {
      # An abandoned mutex transfers ownership to this process.
      return $mutex
    }
    if (-not $acquired) { throw 'PUBLIC_SECRET_SCAN_TOOL_BOOTSTRAP_LOCK_TIMEOUT' }
    return $mutex
  } catch {
    $mutex.Dispose()
    throw
  }
}

function Exit-ToolRootBootstrapMutex([object]$Mutex) {
  try {
    $Mutex.ReleaseMutex()
  } finally {
    $Mutex.Dispose()
  }
}

function Enter-GitleaksLock([string]$ToolDirectory) {
  $lockPath = Join-Path $ToolDirectory '.gitleaks-8.30.0.lock'
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ($true) {
    try { return [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch [System.IO.IOException] {
      if ([DateTime]::UtcNow -ge $deadline) { throw 'PUBLIC_SECRET_SCAN_TOOL_LOCK_TIMEOUT' }
      Start-Sleep -Milliseconds 100
    }
  }
}

function Assert-PathTreeNoReparse([string]$Path, [string]$Code) {
  Assert-NoReparsePoint $Path $Code
  foreach ($item in @(Get-ChildItem -LiteralPath $Path -Force -Recurse)) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw $Code }
  }
}

function Assert-GitleaksExecutable([string]$ToolDirectory, [object]$Contract) {
  Assert-ToolRootAcl $ToolDirectory
  $install = Join-Path $ToolDirectory "gitleaks-$($Contract.version)"
  $executable = Join-Path $install $Contract.executable.path
  if (-not (Test-Path -LiteralPath $install -PathType Container)) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID' }
  Assert-PathTreeNoReparse $install 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID' }
  $item = Get-Item -LiteralPath $executable -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -ne $Contract.executable.size -or (Get-Sha256 $executable) -ne $Contract.executable.sha256) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXECUTABLE_INVALID' }
  return $executable
}

function Expand-GitleaksArchive([string]$Archive, [string]$Staging) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $root = [System.IO.Path]::GetFullPath($Staging).TrimEnd('\') + '\'
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      if ([String]::IsNullOrWhiteSpace($name) -or [System.IO.Path]::IsPathRooted($name) -or $name -match '(^|[\\/])\.\.([\\/]|$)') { throw 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID' }
      $destination = [System.IO.Path]::GetFullPath((Join-Path $Staging $name))
      if (-not $destination.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($destination)) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID' }
      if ($name.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($destination) | Out-Null; continue }
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
      $input = $entry.Open()
      try { $output = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); try { $input.CopyTo($output) } finally { $output.Dispose() } } finally { $input.Dispose() }
    }
  } finally { $zip.Dispose() }
}

function Ensure-Gitleaks([string]$ToolDirectory, [object]$Contract) {
  $archive = Join-Path $ToolDirectory "gitleaks_$($Contract.version)_windows_x64.zip"
  $install = Join-Path $ToolDirectory "gitleaks-$($Contract.version)"
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    $part = "$archive.part-$PID-$([guid]::NewGuid().ToString('N'))"
    Invoke-WebRequest -Uri $Contract.url -OutFile $part -UseBasicParsing
    $partInfo = Get-Item -LiteralPath $part -Force
    if ($partInfo.Length -ne $Contract.size -or (Get-Sha256 $part) -ne $Contract.sha256) { throw 'PUBLIC_SECRET_SCAN_TOOL_DOWNLOAD_INVALID' }
    [System.IO.File]::Move($part, $archive)
  }
  $archiveInfo = Get-Item -LiteralPath $archive -Force
  if ($archiveInfo.Length -ne $Contract.size -or (Get-Sha256 $archive) -ne $Contract.sha256) { throw 'PUBLIC_SECRET_SCAN_TOOL_ARCHIVE_INVALID' }
  if (Test-Path -LiteralPath $install) { return Assert-GitleaksExecutable $ToolDirectory $Contract }
  $staging = "$install.staging-$PID-$([guid]::NewGuid().ToString('N'))"
  [System.IO.Directory]::CreateDirectory($staging) | Out-Null
  Expand-GitleaksArchive $archive $staging
  $stagedExecutable = Join-Path $staging $Contract.executable.path
  if (-not (Test-Path -LiteralPath $stagedExecutable -PathType Leaf)) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID' }
  $stagedInfo = Get-Item -LiteralPath $stagedExecutable -Force
  if (($stagedInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $stagedInfo.Length -ne $Contract.executable.size -or (Get-Sha256 $stagedExecutable) -ne $Contract.executable.sha256) { throw 'PUBLIC_SECRET_SCAN_TOOL_EXECUTABLE_INVALID' }
  Assert-PathTreeNoReparse $staging 'PUBLIC_SECRET_SCAN_TOOL_EXTRACT_INVALID'
  [System.IO.Directory]::Move($staging, $install)
  return Assert-GitleaksExecutable $ToolDirectory $Contract
}

function Read-GitleaksFindings([object]$RawReport, [bool]$AllowEmpty = $false) {
  if ($RawReport -is [string]) {
    try {
      $reportText = Get-Content -LiteralPath $RawReport -Raw -Encoding utf8
      $parsed = $reportText | ConvertFrom-Json
      if ($null -eq $parsed) { return @() }
      return @($parsed)
    } catch {
      throw 'PUBLIC_SECRET_SCAN_REPORT_INVALID'
    } finally {
      try {
        [System.IO.File]::Delete($RawReport)
      } catch {
        throw 'PUBLIC_SECRET_SCAN_REPORT_CLEANUP_FAILED'
      }
    }
  }
  try {
    $reportText = Read-LockedText $RawReport.Handle
    if ([string]::IsNullOrWhiteSpace($reportText) -and $AllowEmpty) { return @() }
    $parsed = $reportText | ConvertFrom-Json
    if ($null -eq $parsed) { return @() }
    return @($parsed)
  } catch {
    throw 'PUBLIC_SECRET_SCAN_REPORT_INVALID'
  }
}

function Invoke-GitleaksScan([string]$Executable, [string]$Kind, [string]$Root, [string]$ConfigPath, [object]$Workspace) {
  $rawReport = $null
  $toolLog = $null
  try {
    $rawReport = New-TransientReportFile $Workspace 'raw.json'
    $toolLog = New-TransientReportFile $Workspace 'tool.log'
    $arguments = @('--redact', '--no-banner', '--config', $ConfigPath, '--report-format', 'json', '--report-path', $rawReport.Path)
  if ($Kind -eq 'repository') {
    $arguments += @('git', '--log-opts=--all', $Root)
  } else {
    $arguments += @('dir', $Root)
  }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Executable @arguments *> $null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
    Write-LockedText $toolLog.Handle ([ordered]@{ scanKind = $Kind; exitCode = [int]$exitCode } | ConvertTo-Json -Compress)
    $findings = @(Read-GitleaksFindings $rawReport ($exitCode -eq 0))
    if ($exitCode -ne 0 -and $findings.Count -eq 0) { throw 'PUBLIC_SECRET_SCAN_TOOL_FAILED' }
    return @($findings | ForEach-Object {
      [ordered]@{
        ruleId = [string]$_.RuleID
        path = Get-SafeRelativePath $Root ([string]$_.File)
        scanKind = $Kind
      }
    })
  } finally {
    if ($null -ne $toolLog) { Remove-TransientReportFile $toolLog }
    if ($null -ne $rawReport) { Remove-TransientReportFile $rawReport }
  }
}

try {
  $candidate = Assert-AbsolutePath $CandidateRoot 'PUBLIC_SECRET_SCAN_PATH_INVALID'
  $repository = Assert-AbsolutePath $RepositoryRoot 'PUBLIC_SECRET_SCAN_PATH_INVALID'
  $release = Assert-AbsolutePath $ReleaseRoot 'PUBLIC_SECRET_SCAN_PATH_INVALID'
  $report = Assert-AbsolutePath $ReportRoot 'PUBLIC_SECRET_SCAN_PATH_INVALID'
  # UNC ToolRoot is unsupported: Global mutexes coordinate this host, not a distributed lock.
  $tools = Assert-AbsolutePath (Assert-LocalToolRootPath $ToolRoot) 'PUBLIC_SECRET_SCAN_PATH_INVALID'
  Assert-NoReparsePoint $report 'PUBLIC_SECRET_SCAN_REPARSE_POINT'
  foreach ($path in @($candidate, $repository, $release, $tools)) {
    if (Test-PathOverlap $report $path) { throw 'PUBLIC_SECRET_SCAN_PATH_OVERLAP' }
  }
  # ReportRoot is disjoint from ReleaseRoot by the overlap check above; scanner reports are never published.
  $stage = 'report'
  New-Item -ItemType Directory -Path $report -Force | Out-Null
  Assert-NoReparsePoint $report 'PUBLIC_SECRET_SCAN_REPARSE_POINT'
  Assert-Directory $report 'PUBLIC_SECRET_SCAN_REPORT_ROOT_INVALID'
  $reportLock = Open-LockedReportRoot $report
  $reportValidated = $true
  $safeFailureReport = $report
  $stage = 'paths'
  foreach ($path in @($candidate, $repository, $release, $tools)) { Assert-NoReparsePoint $path 'PUBLIC_SECRET_SCAN_REPARSE_POINT' }
  foreach ($path in @($candidate, $repository, $release)) { Assert-Directory $path 'PUBLIC_SECRET_SCAN_SCAN_ROOT_INVALID' }
  foreach ($pair in @(@($candidate, $repository), @($candidate, $release), @($candidate, $tools), @($repository, $release), @($repository, $tools), @($release, $tools))) {
    if (Test-PathOverlap $pair[0] $pair[1]) { throw 'PUBLIC_SECRET_SCAN_PATH_OVERLAP' }
  }
  $repositoryConfig = Join-Path $PSScriptRoot '..\.gitleaks.toml'
  $repositoryConfig = [System.IO.Path]::GetFullPath($repositoryConfig)
  Assert-NoReparsePoint $repositoryConfig 'PUBLIC_SECRET_SCAN_CONFIG_INVALID'
  if (-not (Test-Path -LiteralPath $repositoryConfig -PathType Leaf)) { throw 'PUBLIC_SECRET_SCAN_CONFIG_INVALID' }
  $stage = 'contract'
  $manifestPath = Join-Path $PSScriptRoot '..\resources\build-toolchain.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
  if ($manifest.gitleaks.version -ne '8.30.0' -or $manifest.gitleaks.url -ne 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.0/gitleaks_8.30.0_windows_x64.zip' -or $manifest.gitleaks.size -ne 8519574 -or $manifest.gitleaks.sha256 -ne '54fe94f644b832dd08e8c3a5915efb3bfa862386d59fb27ca0792cb687a83573' -or $manifest.gitleaks.executable.path -ne 'gitleaks.exe' -or $manifest.gitleaks.executable.size -ne 22689792 -or $manifest.gitleaks.executable.sha256 -ne '9d08e3f5cfb35a98f230b97bcda24f8d3fc66363c91868ffc98dac0afebdcb72') { throw 'PUBLIC_SECRET_SCAN_TOOL_CONTRACT_INVALID' }
  $stage = 'tool'
  Assert-LocalToolRootPath $tools | Out-Null
  $toolLock = $null
  try {
    $bootstrapMutex = Enter-ToolRootBootstrapMutex $tools
    try {
      Initialize-ToolRoot $tools
      $toolLock = Enter-GitleaksLock $tools
    } finally {
      Exit-ToolRootBootstrapMutex $bootstrapMutex
    }
    $gitleaks = Ensure-Gitleaks $tools $manifest.gitleaks
    $transientWorkspace = New-TransientReportWorkspace $tools
    $releaseConfigFile = $null
    $appAsarConfigFile = $null
    $appAsarExtractionRoot = $null
    try {
      $safeFindings = @()
      $totalFindings = 0
      $stage = 'scan'
      $scans = @(
        @('candidate', $candidate, $repositoryConfig),
        @('repository', $repository, $repositoryConfig)
      )

      $releaseConfigAppend = ''
      $appAsarPath = Join-Path $release 'unpacked\resources\app.asar'
      if (Test-Path -LiteralPath $appAsarPath) {
        $stage = 'prepare-release-app-asar'
        $appAsarItem = Get-Item -LiteralPath $appAsarPath -Force
        if ($appAsarItem.PSIsContainer -or ($appAsarItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'PUBLIC_SECRET_SCAN_RELEASE_APP_ASAR_INVALID' }
        $asarCommand = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\node_modules\.bin\asar.cmd'))
        Assert-NoReparsePoint $asarCommand 'PUBLIC_SECRET_SCAN_RELEASE_APP_ASAR_TOOL_INVALID'
        if (-not (Test-Path -LiteralPath $asarCommand -PathType Leaf)) { throw 'PUBLIC_SECRET_SCAN_RELEASE_APP_ASAR_TOOL_INVALID' }
        $appAsarExtractionRoot = Join-Path $transientWorkspace.Path 'release-app-asar'
        [System.IO.Directory]::CreateDirectory($appAsarExtractionRoot) | Out-Null
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          & $asarCommand extract $appAsarPath $appAsarExtractionRoot *> $null
          $asarExitCode = $LASTEXITCODE
        } finally {
          $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($asarExitCode -ne 0) { throw 'PUBLIC_SECRET_SCAN_RELEASE_APP_ASAR_EXTRACT_FAILED' }
        Assert-PathTreeNoReparse $appAsarExtractionRoot 'PUBLIC_SECRET_SCAN_RELEASE_APP_ASAR_INVALID'

        $templatePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src\shared\feishu-template.ts'))
        $templateText = Get-Content -LiteralPath $templatePath -Raw -Encoding utf8
        $templateMatches = [regex]::Matches($templateText, "(?m)^export const FEISHU_TEMPLATE_APP_TOKEN = '([A-Za-z0-9]+)'\r?$")
        if ($templateMatches.Count -ne 1) { throw 'PUBLIC_SECRET_SCAN_PUBLIC_TEMPLATE_INVALID' }
        $templateTokenRegex = [regex]::Escape($templateMatches[0].Groups[1].Value)
        $appAsarConfigAppend = @"
[[allowlists]]
description = "Approved public Feishu template identity in the extracted renderer bundle"
condition = "AND"
regexTarget = "line"
paths = [
  '''(?:^|.*[\\/])out[\\/]renderer[\\/]assets[\\/]index-[A-Za-z0-9_-]+\.js$'''
]
regexes = [
  '''^const FEISHU_TEMPLATE_APP_TOKEN = "$templateTokenRegex";$'''
]
"@
        $appAsarConfigFile = New-TransientGitleaksConfig $transientWorkspace $repositoryConfig $appAsarConfigAppend
        $scans += ,@('release-app-asar', $appAsarExtractionRoot, $appAsarConfigFile.Path)
        $releaseConfigAppend += (@"
[[allowlists]]
description = "Release app.asar scanned through its extracted contents"
paths = [
  '''(?:^|.*[\\/])unpacked[\\/]resources[\\/]app\.asar$'''
]
"@ + "`r`n")
      }

      $releaseModelsRoot = Join-Path $release 'unpacked\resources\models'
      if (Test-Path -LiteralPath $releaseModelsRoot) {
        $stage = 'prepare-release-model'
        $modelManifestPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\resources\model-manifest.json'))
        $modelManifest = Get-Content -LiteralPath $modelManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ([string]$modelManifest.id -notmatch '^[a-z0-9-]+$') { throw 'PUBLIC_SECRET_SCAN_RELEASE_MODEL_CONTRACT_INVALID' }
        $modelFileContract = $modelManifest.files.'model.int8.onnx'
        if ($null -eq $modelFileContract -or [string]$modelFileContract.sha256 -notmatch '^[a-f0-9]{64}$' -or [long]$modelFileContract.size -lt 1) { throw 'PUBLIC_SECRET_SCAN_RELEASE_MODEL_CONTRACT_INVALID' }
        $modelPath = Join-Path $releaseModelsRoot "$($modelManifest.id)\model.int8.onnx"
        if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) { throw 'PUBLIC_SECRET_SCAN_RELEASE_MODEL_INVALID' }
        $modelItem = Get-Item -LiteralPath $modelPath -Force
        if ($modelItem.PSIsContainer -or ($modelItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $modelItem.Length -ne [long]$modelFileContract.size -or (Get-Sha256 $modelPath) -ne [string]$modelFileContract.sha256) { throw 'PUBLIC_SECRET_SCAN_RELEASE_MODEL_INVALID' }
        $modelIdRegex = [regex]::Escape([string]$modelManifest.id)
        $releaseConfigAppend += (@"
[[allowlists]]
description = "Verified immutable packaged SenseVoice model binary"
paths = [
  '''(?:^|.*[\\/])unpacked[\\/]resources[\\/]models[\\/]$modelIdRegex[\\/]model\.int8\.onnx$'''
]
"@ + "`r`n")
      }

      $releaseConfigPath = $repositoryConfig
      if (-not [string]::IsNullOrWhiteSpace($releaseConfigAppend)) {
        $releaseConfigFile = New-TransientGitleaksConfig $transientWorkspace $repositoryConfig $releaseConfigAppend
        $releaseConfigPath = $releaseConfigFile.Path
      }
      $scans += ,@('release', $release, $releaseConfigPath)

      foreach ($scan in $scans) {
        $stage = "scan-$($scan[0])"
        Assert-GitleaksExecutable $tools $manifest.gitleaks | Out-Null
        $scanFindings = @(Invoke-GitleaksScan $gitleaks $scan[0] $scan[1] $scan[2] $transientWorkspace)
        $totalFindings += $scanFindings.Count
        $remaining = 100 - $safeFindings.Count
        if ($remaining -gt 0) { $safeFindings += @($scanFindings | Select-Object -First $remaining) }
      }
      $stage = 'summary'
      $displayedFindings = $safeFindings.Count
      if (-not (Write-NewReportSummary $report ([ordered]@{
        totalFindings = $totalFindings
        displayedFindings = $displayedFindings
        truncated = $totalFindings -gt $displayedFindings
        findings = @($safeFindings)
      } | ConvertTo-Json -Depth 3))) { throw 'PUBLIC_SECRET_SCAN_SUMMARY_EXISTS' }
      if ($totalFindings -gt 0) {
        $scanExit = 10
        Write-Output "PUBLIC_SECRET_SCAN_FAILED:$totalFindings"
      } else {
        $scanExit = 0
        Write-Output 'PUBLIC_SECRET_SCAN_OK'
      }
    } finally {
      if ($null -ne $releaseConfigFile) { Remove-TransientReportFile $releaseConfigFile }
      if ($null -ne $appAsarConfigFile) { Remove-TransientReportFile $appAsarConfigFile }
      if ($null -ne $appAsarExtractionRoot -and (Test-Path -LiteralPath $appAsarExtractionRoot)) {
        [System.IO.Directory]::Delete((ConvertTo-ExtendedLengthPath $appAsarExtractionRoot), $true)
      }
      Remove-TransientReportWorkspace $transientWorkspace
    }
  } finally {
    if ($null -ne $toolLock) { $toolLock.Dispose() }
  }
} catch {
  $failureMessage = [string]$_.Exception.Message
  $failureReason = if ($failureMessage -match '^PUBLIC_SECRET_SCAN_[A-Z0-9_-]+$') {
    $failureMessage
  } else {
    "PUBLIC_SECRET_SCAN_UNEXPECTED_$($_.Exception.GetType().Name.ToUpperInvariant())"
  }
  if ($reportValidated -and $safeFailureReport) {
    [void](Write-NewReportSummary $safeFailureReport ([ordered]@{
      error = "PUBLIC_SECRET_SCAN_$stage"
      reason = $failureReason
    } | ConvertTo-Json))
  }
  Write-Output 'PUBLIC_SECRET_SCAN_FAILED:0'
} finally {
  if ($null -ne $reportLock) { $reportLock.Dispose() }
}
exit $scanExit
