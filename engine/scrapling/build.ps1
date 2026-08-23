param(
  [Parameter(Mandatory = $true)][string]$Python,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][long]$SourceDateEpoch
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$ExpectedPython = [System.IO.Path]::GetFullPath((Join-Path $Root '.venv\Scripts\python.exe'))
$BuildResources = [System.IO.Path]::GetFullPath((Join-Path $Root '..\..\.build-resources'))
$ResolvedPython = [System.IO.Path]::GetFullPath($Python)
$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)

function Assert-OrdinaryPath([string]$Path, [string]$Code) {
  $current = [System.IO.Path]::GetPathRoot($Path)
  foreach ($part in $Path.Substring($current.Length).Split([System.IO.Path]::DirectorySeparatorChar, [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $current = Join-Path $current $part
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw $Code }
    }
  }
}

function New-DeterministicZip([string]$SourceDirectory, [string]$DestinationPath, [long]$Epoch) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $timestamp = [DateTimeOffset]::FromUnixTimeSeconds($Epoch)
  $stream = [System.IO.File]::Open($DestinationPath, [System.IO.FileMode]::Create)
  try {
    $zip = New-Object -TypeName System.IO.Compression.ZipArchive -ArgumentList @($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      Get-ChildItem -LiteralPath $SourceDirectory -File -Recurse | Sort-Object { $_.FullName.Substring($SourceDirectory.Length + 1).Replace('\', '/') } | ForEach-Object {
        $entry = $zip.CreateEntry($_.FullName.Substring($SourceDirectory.Length + 1).Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $timestamp
        $entryStream = $entry.Open()
        try { $input = [System.IO.File]::OpenRead($_.FullName); try { $input.CopyTo($entryStream) } finally { $input.Dispose() } } finally { $entryStream.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $stream.Dispose() }
}

if (-not [string]::Equals($ResolvedPython, $ExpectedPython, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SCRAPLING_PYTHON_NOT_APPROVED' }
if (-not (Test-Path -LiteralPath $ResolvedPython -PathType Leaf)) { throw 'SCRAPLING_PYTHON_MISSING' }
if ($ResolvedOutput -eq $BuildResources -or -not $ResolvedOutput.StartsWith($BuildResources + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SCRAPLING_OUTPUT_NOT_APPROVED' }
Assert-OrdinaryPath $Root 'SCRAPLING_ROOT_REPARSE_POINT'
Assert-OrdinaryPath $ExpectedPython 'SCRAPLING_PYTHON_REPARSE_POINT'
Assert-OrdinaryPath $BuildResources 'SCRAPLING_OUTPUT_REPARSE_POINT'
Assert-OrdinaryPath $ResolvedOutput 'SCRAPLING_OUTPUT_REPARSE_POINT'

& $ResolvedPython -c "import sys; raise SystemExit(0 if sys.version.split()[0] == '3.12.10' else 1)"
if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_PYTHON_VERSION_INVALID' }
if ($SourceDateEpoch -lt 0) { throw 'SCRAPLING_SOURCE_DATE_INVALID' }
$env:SOURCE_DATE_EPOCH = [string]$SourceDateEpoch
$env:PYTHONHASHSEED = '0'
$env:TZ = 'UTC'

Push-Location $Root
try {
  & $ResolvedPython -m pip install --require-hashes -r (Join-Path $Root 'requirements.lock.txt')
  if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_LOCK_INSTALL_FAILED' }
  & $ResolvedPython -m unittest discover -s (Join-Path $Root 'tests') -v
  if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_TESTS_FAILED' }

  New-Item -ItemType Directory -Force -Path $ResolvedOutput | Out-Null
  $Dist = Join-Path $ResolvedOutput 'dist'
  $Work = Join-Path $ResolvedOutput 'work'
  $Spec = Join-Path $ResolvedOutput 'spec'
  $Package = Join-Path $ResolvedOutput 'package'
  $Archive = Join-Path $ResolvedOutput 'scrapling-engine-win32-x64.zip'
  & $ResolvedPython -m PyInstaller --noconfirm --clean --onedir --name scrapling-engine --distpath $Dist --workpath $Work --specpath $Spec --collect-all scrapling --collect-all patchright --collect-all playwright --collect-all browserforge --collect-all apify_fingerprint_datapoints --collect-all curl_cffi (Join-Path $Root 'scrapling_engine.py')
  if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_PYINSTALLER_FAILED' }
  New-Item -ItemType Directory -Force -Path $Package | Out-Null
  Copy-Item (Join-Path $Dist 'scrapling-engine\*') $Package -Recurse
  New-DeterministicZip $Package $Archive $SourceDateEpoch
  Remove-Item -LiteralPath $Dist, $Work, $Spec, $Package -Recurse -Force
} finally {
  Pop-Location
}
