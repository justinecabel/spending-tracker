$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory

$docker = Get-Command docker.exe -ErrorAction Stop
& $docker.Source compose restart
if ($LASTEXITCODE -ne 0) {
  & $docker.Source compose up -d --no-build
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose could not restart or start the Spending Tracker stack."
  }
}
