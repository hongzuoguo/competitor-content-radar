$ErrorActionPreference = 'Stop'

$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Venv = Join-Path $Root '.venv'
$Lock = Join-Path $Root 'requirements.lock.txt'

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

Assert-OrdinaryPath $Root 'SCRAPLING_ROOT_REPARSE_POINT'
Assert-OrdinaryPath $Venv 'SCRAPLING_VENV_REPARSE_POINT'

& py -3.12 -c "import sys; raise SystemExit(0 if sys.version.split()[0] == '3.12.10' else 1)"
if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_PYTHON_VERSION_INVALID' }

& py -3.12 -m venv --clear $Venv
if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_VENV_CREATE_FAILED' }
Assert-OrdinaryPath $Venv 'SCRAPLING_VENV_REPARSE_POINT'

$Python = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) { throw 'SCRAPLING_VENV_PYTHON_MISSING' }
Assert-OrdinaryPath $Python 'SCRAPLING_VENV_PYTHON_REPARSE_POINT'
& $Python -c "import sys; raise SystemExit(0 if sys.version.split()[0] == '3.12.10' else 1)"
if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_VENV_PYTHON_VERSION_INVALID' }

& $Python -m pip install --require-hashes -r $Lock
if ($LASTEXITCODE -ne 0) { throw 'SCRAPLING_LOCK_INSTALL_FAILED' }
