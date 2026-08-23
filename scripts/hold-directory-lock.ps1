[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Directory,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z]:[\\/]')][string]$TestRoot,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Convert-AbsolutePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^[A-Za-z]:[\\/]') { throw "LOCK_PATH_MUST_BE_ABSOLUTE: $Path" }
  [System.IO.Path]::GetFullPath($Path)
}

function Test-StrictDescendant([string]$Parent, [string]$Candidate) {
  $root = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\\')
  $current = [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\\')
  while ($true) {
    if ([string]::Equals($root, $current, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $parentDirectory = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parentDirectory) { return $false }
    $next = $parentDirectory.FullName.TrimEnd('\\')
    if ([string]::Equals($root, $next, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ([string]::Equals($next, $current, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $current = $next
  }
}

function Confirm-NoReparse([string]$Path) {
  $current = Convert-AbsolutePath $Path
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "LOCK_REPARSE_POINT: $current" }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent -or $parent.FullName -eq $current) { break }
    $current = $parent.FullName
  }
}

$testRoot = Convert-AbsolutePath $TestRoot
$directory = Convert-AbsolutePath $Directory
if ((Split-Path -Leaf $directory) -notlike 'smoke-*' -or -not (Test-StrictDescendant $testRoot $directory) -or -not [string]::Equals((Split-Path -Parent $directory).TrimEnd('\\'), $testRoot.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) { throw "LOCK_PATH_NOT_APPROVED: $directory" }
Confirm-NoReparse $testRoot
Confirm-NoReparse $directory
if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "LOCK_DIRECTORY_MISSING: $directory" }
if ($ValidateOnly) { Write-Output "LOCK_VALID: $directory"; exit 0 }

if (-not ('HitMuseDirectoryLock.Native' -as [type])) {
  Add-Type @'
using Microsoft.Win32.SafeHandles;
using System;
using System.Runtime.InteropServices;
namespace HitMuseDirectoryLock {
  [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
  public static class Native {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern SafeFileHandle CreateFile(string n,uint a,uint s,IntPtr sec,uint c,uint f,IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  }
}
'@
}
$genericRead = [Convert]::ToUInt32('80000000', 16)
$handle = [HitMuseDirectoryLock.Native]::CreateFile($directory, $genericRead, 0x00000003, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
if ($handle.IsInvalid) { throw "LOCK_OPEN_FAILED: $directory win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
  Confirm-NoReparse $directory
  $info = New-Object HitMuseDirectoryLock.Info
  if (-not [HitMuseDirectoryLock.Native]::GetFileInformationByHandle($handle, [ref]$info)) { throw "LOCK_IDENTITY_FAILED: $directory" }
  Write-Output "LOCK_READY volume=$($info.Volume) index=$($info.IndexHigh)-$($info.IndexLow) path=$directory"
  while ($null -ne [Console]::In.ReadLine()) {}
} finally { $handle.Dispose() }
