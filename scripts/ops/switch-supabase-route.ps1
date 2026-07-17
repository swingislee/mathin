[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet("Lan", "Public", "Status")]
  [string]$Mode = "Lan"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Domain = "supabase.mathin.club"
$LanAddress = "192.168.5.183"
$Marker = "# Mathin Supabase LAN override"
$HostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-HostsLines {
  if (-not (Test-Path -LiteralPath $HostsPath -PathType Leaf)) {
    throw "Hosts file not found: $HostsPath"
  }
  return [IO.File]::ReadAllLines($HostsPath, $Utf8NoBom)
}

function Get-RouteStatus {
  $managedLines = @(Get-HostsLines | Where-Object { $_.TrimEnd().EndsWith($Marker, [StringComparison]::Ordinal) })
  if ($managedLines.Count -eq 0) {
    return [pscustomobject]@{
      Mode = "Public"
      Detail = "No Mathin hosts override exists; Windows uses normal DNS."
    }
  }

  $expectedLine = "$LanAddress`t$Domain`t$Marker"
  $invalidLines = @($managedLines | Where-Object { $_ -ne $expectedLine })
  if ($invalidLines.Count -gt 0) {
    return [pscustomobject]@{
      Mode = "Repair required"
      Detail = "A legacy or malformed Mathin hosts override exists. Open the route switcher and choose LAN direct to repair it.`n$($managedLines -join [Environment]::NewLine)"
    }
  }

  return [pscustomobject]@{
    Mode = "Lan"
    Detail = "Direct HTTPS to Xiaomi Caddy (${LanAddress}:443)."
  }
}

function Update-UserNoProxy {
  param([bool]$UseLanRoute)

  $userValue = [Environment]::GetEnvironmentVariable("NO_PROXY", "User")
  $sourceValue = if ([string]::IsNullOrWhiteSpace($userValue)) {
    [Environment]::GetEnvironmentVariable("NO_PROXY", "Process")
  } else {
    $userValue
  }

  $routeEntries = @($Domain, $LanAddress)
  $existingEntries = @(
    $sourceValue -split "[,;]" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
  $updatedEntries = @(
    $existingEntries |
      Where-Object { $_ -notin $routeEntries }
  )
  if ($UseLanRoute) {
    $updatedEntries += $routeEntries
  }

  $newValue = @($updatedEntries | Select-Object -Unique) -join ","
  [Environment]::SetEnvironmentVariable("NO_PROXY", $newValue, "User")
  return $newValue
}

if ($Mode -eq "Status") {
  Get-RouteStatus | Format-List
  exit 0
}

if (-not (Test-Administrator)) {
  throw "Run PowerShell as Administrator to modify $HostsPath. Use -Mode Status without elevation."
}

$existingLines = @(Get-HostsLines)
$unmanagedLines = @($existingLines | Where-Object { -not $_.TrimEnd().EndsWith($Marker, [StringComparison]::Ordinal) })

if ($Mode -eq "Lan") {
  $newLine = "$LanAddress`t$Domain`t$Marker"
  $updatedLines = @($unmanagedLines + $newLine)
  $description = "$Domain → $LanAddress through the local Caddy proxy; add the LAN target to the user NO_PROXY list"
} else {
  $updatedLines = $unmanagedLines
  $description = "$Domain → public DNS (removed only the Mathin-managed hosts entry and LAN NO_PROXY entries)"
}

if ($PSCmdlet.ShouldProcess($HostsPath, $description)) {
  [IO.File]::WriteAllText($HostsPath, (($updatedLines -join "`r`n") + "`r`n"), $Utf8NoBom)
  Clear-DnsClientCache
  $newNoProxy = Update-UserNoProxy -UseLanRoute ($Mode -eq "Lan")
  Write-Host "Updated user NO_PROXY for new terminal sessions: $newNoProxy"
}

Get-RouteStatus | Format-List
