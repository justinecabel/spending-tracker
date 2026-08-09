param(
  [ValidateRange(1, 10)]
  [int]$FailureThreshold = 2
)

$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory

$docker = Get-Command docker.exe -ErrorAction Stop
$curl = Get-Command curl.exe -ErrorAction Stop
$nslookup = Get-Command nslookup.exe -ErrorAction Stop
$statePath = Join-Path $projectDirectory "docker-data\tailscale-funnel-monitor.json"

function Invoke-DockerCapture {
  param([string[]]$Arguments)

  $output = (& $docker.Source @Arguments 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($Arguments -join ' ') failed: $output"
  }
  return $output
}

function Read-MonitorState {
  if (-not (Test-Path -LiteralPath $statePath)) {
    return [pscustomobject]@{ ConsecutiveFailures = 0 }
  }

  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    return [pscustomobject]@{ ConsecutiveFailures = [int]$state.ConsecutiveFailures }
  } catch {
    return [pscustomobject]@{ ConsecutiveFailures = 0 }
  }
}

function Write-MonitorState {
  param([int]$ConsecutiveFailures)

  $stateDirectory = Split-Path -Parent $statePath
  New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
  [pscustomobject]@{
    ConsecutiveFailures = $ConsecutiveFailures
    CheckedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Test-PublicIPv4 {
  param([string]$Address)

  $bytes = [System.Net.IPAddress]::Parse($Address).GetAddressBytes()
  if ($bytes.Length -ne 4) {
    return $false
  }

  return -not (
    $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
    ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127) -or
    $bytes[0] -eq 127
  )
}

function Get-PublicResolverAddresses {
  param([string]$Domain)

  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $nslookup.Source
  $processInfo.Arguments = "$Domain 1.1.1.1"
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  $process.Start() | Out-Null
  $lookup = $process.StandardOutput.ReadToEnd()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  $addresses = [regex]::Matches($lookup, "(?<address>\b\d{1,3}(?:\.\d{1,3}){3}\b)") |
    ForEach-Object { $_.Groups["address"].Value } |
    Where-Object { $_ -ne "1.1.1.1" } |
    Where-Object { Test-PublicIPv4 $_ } |
    Select-Object -Unique

  return @($addresses)
}

function Get-FunnelHttpCode {
  param(
    [string]$Domain,
    [string]$Address
  )

  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $curl.Source
  $processInfo.Arguments = "-sS -o NUL -w %{http_code} --connect-timeout 5 --max-time 15 --resolve ${Domain}:443:${Address} https://${Domain}/health"
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  $process.Start() | Out-Null
  $httpCode = $process.StandardOutput.ReadToEnd().Trim()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    HttpCode = $httpCode
  }
}

function Test-PublicFunnel {
  param([string]$Domain)

  $addresses = Get-PublicResolverAddresses -Domain $Domain
  if ($addresses.Count -eq 0) {
    throw "Public DNS did not return a Funnel relay address for $Domain"
  }

  foreach ($address in $addresses) {
    $probe = Get-FunnelHttpCode -Domain $Domain -Address $address

    if ($probe.ExitCode -eq 0 -and $probe.HttpCode -eq "200") {
      return $true
    }
  }

  return $false
}

$state = Read-MonitorState

try {
  $containerId = Invoke-DockerCapture -Arguments @("compose", "ps", "tailscale", "--status", "running", "-q")
  if ([string]::IsNullOrWhiteSpace($containerId)) {
    throw "The Tailscale sidecar is not running"
  }

  $status = (Invoke-DockerCapture -Arguments @("exec", $containerId, "tailscale", "status", "--json")) | ConvertFrom-Json
  $domain = ([string]$status.Self.DNSName).TrimEnd(".")
  if ([string]::IsNullOrWhiteSpace($domain)) {
    throw "Tailscale has no DNS name yet"
  }

  if (-not (Test-PublicFunnel -Domain $domain)) {
    throw "The public Funnel health check failed for https://$domain/health"
  }

  Write-MonitorState -ConsecutiveFailures 0
  Write-Output "Docker Funnel is healthy: https://$domain/health"
  exit 0
} catch {
  $state.ConsecutiveFailures++
  Write-MonitorState -ConsecutiveFailures $state.ConsecutiveFailures
  Write-Warning "Docker Funnel check failed ($($state.ConsecutiveFailures)/$FailureThreshold): $($_.Exception.Message)"

  if ($state.ConsecutiveFailures -lt $FailureThreshold) {
    exit 1
  }

  Write-Output "Recreating the Docker API/Tailscale stack to recover the Funnel."
  # The API uses `network_mode: service:tailscale`. Restarting the Tailscale
  # container can replace its network namespace while leaving the API attached
  # to the old one, causing Funnel to proxy to an empty 127.0.0.1:4000. Recreate
  # both containers together so they share the same fresh namespace.
  & $docker.Source compose up -d --no-build --force-recreate tailscale api
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose could not recover the API/Tailscale stack."
  }

  $recovered = $false
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    Start-Sleep -Seconds 5
    try {
      if (Test-PublicFunnel -Domain $domain) {
        $recovered = $true
        break
      }
    } catch {
      # The Funnel relay can take a few seconds to reconnect after recreation.
    }
  }

  if (-not $recovered) {
    throw "Docker Compose restarted, but the public Funnel did not recover."
  }

  Write-MonitorState -ConsecutiveFailures 0
  Write-Output "Docker Funnel recovered: https://$domain/health"
  exit 0
}
