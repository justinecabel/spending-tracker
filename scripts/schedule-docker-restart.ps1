param(
  [ValidateSet("Install", "Remove")]
  [string]$Action = "Install",
  [ValidateRange(1, 168)]
  [int]$IntervalHours = 12,
  [string]$TaskName = "SpendingTracker-Docker-Reboot"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$restartScript = Join-Path $PSScriptRoot "restart-docker-stack.ps1"

if ($Action -eq "Remove") {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task '$TaskName'."
  exit 0
}

if (-not (Test-Path -LiteralPath $restartScript)) {
  throw "Restart script not found: $restartScript"
}

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$scriptArgument = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $restartScript
$actionDefinition = New-ScheduledTaskAction -Execute $powershell -Argument $scriptArgument -WorkingDirectory $projectDirectory
$triggerDefinition = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settingsDefinition = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$principalDefinition = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $actionDefinition `
  -Trigger $triggerDefinition `
  -Settings $settingsDefinition `
  -Principal $principalDefinition `
  -Description "Restart the Spending Tracker Docker Compose stack every $IntervalHours hours." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output "Installed scheduled task '$TaskName'."
Write-Output "Next run: $($taskInfo.NextRunTime)"
Write-Output "Interval: every $IntervalHours hours"
