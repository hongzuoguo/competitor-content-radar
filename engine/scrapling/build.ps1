$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Output = Join-Path $Root 'dist'

Push-Location $Root
try {
  python -m pip install --requirement (Join-Path $Root 'requirements.txt')
  python -m unittest discover -s (Join-Path $Root 'tests') -v
  python -m PyInstaller --noconfirm --clean --onedir --name scrapling-engine --distpath $Output --workpath (Join-Path $Root 'build') --specpath (Join-Path $Root 'build') --collect-all scrapling --collect-all patchright --collect-all playwright --collect-all browserforge --collect-all apify_fingerprint_datapoints (Join-Path $Root 'scrapling_engine.py')

  $PackageRoot = Join-Path $Output 'package'
  Remove-Item $PackageRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item $PackageRoot -ItemType Directory | Out-Null
  Copy-Item (Join-Path $Output 'scrapling-engine\*') $PackageRoot -Recurse
  Compress-Archive -Path (Join-Path $PackageRoot '*') -DestinationPath (Join-Path $Output 'scrapling-engine-win32-x64.zip') -Force
} finally {
  Pop-Location
}
