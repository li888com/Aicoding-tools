param(
  [int]$TokenIntervalMs = 180000,
  [int]$OnlineIntervalMs = 600000,
  [int]$SinceHours = 24,
  [int]$LookbackMs = 1800000,
  [int]$TokenLimit = 200,
  [int]$OnlineLimit = 200
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot ".mcp-toolbox"
$LogPath = Join-Path $LogDir "auto-sync.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Command = @"
Set-Location '$ProjectRoot'
`$env:AUTO_SYNC_TOKEN_INTERVAL_MS='$TokenIntervalMs'
`$env:AUTO_SYNC_ONLINE_INTERVAL_MS='$OnlineIntervalMs'
`$env:AUTO_SYNC_SINCE_HOURS='$SinceHours'
`$env:AUTO_SYNC_LOOKBACK_MS='$LookbackMs'
`$env:AUTO_SYNC_TOKEN_LIMIT='$TokenLimit'
`$env:AUTO_SYNC_ONLINE_LIMIT='$OnlineLimit'
npm run auto-sync *>&1 | Tee-Object -FilePath '$LogPath' -Append
"@

$Process = Start-Process -FilePath powershell.exe `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -PassThru

[pscustomobject]@{
  Ok = $true
  Pid = $Process.Id
  LogPath = $LogPath
  ProjectRoot = $ProjectRoot.Path
}
