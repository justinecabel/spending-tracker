[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "apps\api\data"
$destination = Join-Path $root "docker-data\database"
$databaseName = "spending-tracker.sqlite"

$listener = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  throw "Stop the local API on port 4000 before migrating SQLite data so the database, WAL, and SHM files are copied consistently."
}

$sourceDatabase = Join-Path $source $databaseName
if (-not (Test-Path -LiteralPath $sourceDatabase)) {
  throw "No existing SQLite database was found at $sourceDatabase."
}

$destinationDatabase = Join-Path $destination $databaseName
if (Test-Path -LiteralPath $destinationDatabase) {
  throw "A Docker database already exists at $destinationDatabase. Refusing to overwrite it."
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($suffix in "", "-wal", "-shm") {
  $from = "$sourceDatabase$suffix"
  if (Test-Path -LiteralPath $from) {
    Copy-Item -LiteralPath $from -Destination "$destinationDatabase$suffix"
  }
}

Write-Host "SQLite data copied to $destination. Start Docker Compose after the migration completes."
