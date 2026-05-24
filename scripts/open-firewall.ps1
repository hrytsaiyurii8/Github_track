# Run once on the SERVER PC (Administrator PowerShell) so other PCs can connect.
$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$ruleName = "GitHub Contact Explorer API ($port)"

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Set-NetFirewallRule -DisplayName $ruleName -Profile Any -Enabled True | Out-Null
  Write-Host "Updated firewall rule (all network profiles): $ruleName"
} else {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $port `
    -Profile Any `
    -Enabled True | Out-Null
  Write-Host "Created inbound TCP allow rule for port $port (all profiles)"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if ($nodePath) {
  $nodeRule = "GitHub Contact Explorer Node.js"
  $nodeExisting = Get-NetFirewallRule -DisplayName $nodeRule -ErrorAction SilentlyContinue
  if (-not $nodeExisting) {
    New-NetFirewallRule `
      -DisplayName $nodeRule `
      -Direction Inbound `
      -Action Allow `
      -Program $nodePath `
      -Profile Any `
      -Enabled True | Out-Null
    Write-Host "Created allow rule for Node.js: $nodePath"
  }
}

Write-Host ""
Write-Host "Server must listen on 0.0.0.0:$port (HOST=0.0.0.0 in server/.env)"
Write-Host "On other PCs, open in a browser: http://YOUR_SERVER_IP:${port}/health/ping"
Write-Host "If that fails, both PCs are not on the same network or this script was not run as Admin."
