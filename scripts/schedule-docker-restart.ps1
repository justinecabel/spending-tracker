param(
  [ValidateSet("Install", "Remove")]
  [string]$Action = "Install",
  [ValidateRange(1, 60)]
  [int]$IntervalMinutes = 5,
  [string]$TaskName = "SpendingTracker-Docker-Reboot"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$monitorScript = Join-Path $PSScriptRoot "check-docker-funnel.ps1"

if ($Action -eq "Remove") {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task '$TaskName'."
  exit 0
}

if (-not (Test-Path -LiteralPath $monitorScript)) {
  throw "Funnel monitor script not found: $monitorScript"
}

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$scriptArgument = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $monitorScript
$actionDefinition = New-ScheduledTaskAction -Execute $powershell -Argument $scriptArgument -WorkingDirectory $projectDirectory
$triggerDefinition = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
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
  -Description "Check the Spending Tracker public Tailscale Funnel every $IntervalMinutes minutes and recover it after consecutive failures." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output "Installed scheduled task '$TaskName'."
Write-Output "Next run: $($taskInfo.NextRunTime)"
Write-Output "Interval: every $IntervalMinutes minutes"
