[CmdletBinding()]
param(
  [ValidateSet("Menu", "Check", "Publish", "Status", "Rollback")]
  [string]$Action = "Menu",
  [string]$SshHost = "xiaomi",
  [string]$RemoteServiceRoot = "/home/swing/services/mathin",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repositoryRoot = (Resolve-Path -LiteralPath $repositoryRoot).Path
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source
$sshExe = (Get-Command ssh.exe -ErrorAction Stop).Source
$scpExe = (Get-Command scp.exe -ErrorAction Stop).Source

if ($SshHost -notmatch "^[A-Za-z0-9][A-Za-z0-9_.@:-]*$") {
  throw "SshHost contains unsupported characters."
}
if ($RemoteServiceRoot -notmatch "^/[A-Za-z0-9._/-]+$") {
  throw "RemoteServiceRoot must be an absolute POSIX path without spaces."
}

function Invoke-Git {
  param([string[]]$Arguments)

  $result = & $gitExe -C $repositoryRoot @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed."
  }
  return @($result)
}

function Get-ReleaseCommit {
  & $gitExe -C $repositoryRoot diff --quiet
  $worktreeStatus = $LASTEXITCODE
  if ($worktreeStatus -eq 1) {
    throw "Working tree has unstaged changes. Commit or stash them before publishing."
  }
  if ($worktreeStatus -ne 0) { throw "Could not inspect the working tree." }

  & $gitExe -C $repositoryRoot diff --cached --quiet
  $indexStatus = $LASTEXITCODE
  if ($indexStatus -eq 1) {
    throw "Index has staged but uncommitted changes. Commit them before publishing."
  }
  if ($indexStatus -ne 0) { throw "Could not inspect the Git index." }

  $commit = (Invoke-Git @("rev-parse", "--verify", "HEAD")).Trim()
  if ($commit -notmatch "^[0-9a-f]{40}$") {
    throw "Could not determine the current Git commit."
  }
  return $commit
}

function Invoke-LocalChecks {
  $commit = Get-ReleaseCommit
  Write-Host "Release candidate: $commit"
  Write-Host "Running lint..."
  Push-Location $repositoryRoot
  try {
    & pnpm.cmd lint | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "pnpm lint failed." }

    Write-Host "Running typecheck..."
    & pnpm.cmd typecheck | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "pnpm typecheck failed." }

    Write-Host "Running production build..."
    & pnpm.cmd build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed." }
  } finally {
    Pop-Location
  }
  Write-Host "Local checks passed."
  return $commit
}

function Invoke-XiaomiScript {
  param([string]$Script)

  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script))
  $remoteCommand = "printf '%s' $payload | base64 -d | bash"
  & $sshExe $SshHost $remoteCommand | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Remote operation failed on $SshHost."
  }
}

function Send-GitArchive {
  param(
    [string]$Commit,
    [string]$RemoteSourceRoot
  )

  $archivePath = Join-Path ([IO.Path]::GetTempPath()) ("mathin-release-{0}.tar" -f [Guid]::NewGuid().ToString("N"))
  $remoteArchivePath = "$RemoteSourceRoot/source.tar"
  try {
    & $gitExe -C $repositoryRoot archive --format=tar "--output=$archivePath" $Commit
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Git archive." }

    & $scpExe $archivePath "${SshHost}:$remoteArchivePath"
    if ($LASTEXITCODE -ne 0) { throw "Could not copy the Git archive to $SshHost." }

    $extractScript = @"
set -Eeuo pipefail
tar -xf '$remoteArchivePath' -C '$RemoteSourceRoot'
rm -f -- '$remoteArchivePath'
"@
    Invoke-XiaomiScript $extractScript
  } finally {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  }
}

function Get-ProductionStatus {
  $remote = @"
set -Eeuo pipefail
service_root='$RemoteServiceRoot'
current='unavailable'
previous='unavailable'
if [[ -L "`$service_root/current" ]]; then
  current=`$(readlink -f "`$service_root/current" || true)
fi
if [[ -L "`$service_root/previous" ]]; then
  previous=`$(readlink -f "`$service_root/previous" || true)
fi
printf 'Current release: %s\n' "`$current"
if [[ -f "`$current/release.json" ]]; then
  printf 'Current metadata: '
  cat "`$current/release.json"
fi
printf 'Previous release: %s\n' "`$previous"
if [[ -f "`$previous/release.json" ]]; then
  printf 'Previous metadata: '
  cat "`$previous/release.json"
fi
printf 'Service: '
systemctl --user is-active mathin.service || true
printf 'Loopback health: '
curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:3131/api/health || true
printf '\nCaddy health: '
curl --noproxy '*' --resolve mathin.club:443:127.0.0.1 -fsS --max-time 5 https://mathin.club/api/health || true
printf '\n'
"@
  Invoke-XiaomiScript $remote
}

function Publish-Release {
  $commit = Invoke-LocalChecks
  $sourceId = "stage-{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $commit.Substring(0, 12)
  $remoteSourceRoot = "$RemoteServiceRoot/staging/$sourceId"

  $prepareRemote = @"
set -Eeuo pipefail
service_root='$RemoteServiceRoot'
source_root='$remoteSourceRoot'
case "`$source_root" in
  "`$service_root"/staging/*) ;;
  *) echo 'Refusing an unsafe staging path.' >&2; exit 1 ;;
esac
mkdir -p "`$source_root"
if find "`$source_root" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "Staging directory is unexpectedly non-empty: `$source_root" >&2
  exit 1
fi
"@
  Invoke-XiaomiScript $prepareRemote
  $cleanupRemote = @"
set -Eeuo pipefail
service_root='$RemoteServiceRoot'
source_root='$remoteSourceRoot'
case "`$source_root" in
  "`$service_root"/staging/*) rm -rf -- "`$source_root" ;;
  *) echo 'Refusing an unsafe staging cleanup path.' >&2; exit 1 ;;
esac
"@
  $deployRemote = @"
set -Eeuo pipefail
service_root='$RemoteServiceRoot'
source_root='$remoteSourceRoot'
cleanup() {
  case "`$source_root" in
    "`$service_root"/staging/*) rm -rf -- "`$source_root" ;;
  esac
}
trap cleanup EXIT
export MATHIN_SERVICE_ROOT="`$service_root"
export MATHIN_SOURCE_ROOT="`$source_root"
export MATHIN_RELEASE_COMMIT='$commit'
bash -ic 'set -Eeuo pipefail; type proxy_on >/dev/null 2>&1 || { echo "proxy_on is not available in the interactive shell." >&2; exit 1; }; proxy_on; bash "`$MATHIN_SOURCE_ROOT/scripts/ops/deploy-mathin-linux.sh" "`$MATHIN_SOURCE_ROOT"'
"@
  try {
    Write-Host "Sending committed source to Xiaomi..."
    Send-GitArchive -Commit $commit -RemoteSourceRoot $remoteSourceRoot
    Write-Host "Building and switching the Linux release..."
    Invoke-XiaomiScript $deployRemote
  } catch {
    try {
      Invoke-XiaomiScript $cleanupRemote
    } catch {
      Write-Warning "The failed staging directory could not be removed automatically."
    }
    throw
  }
  Write-Host "Publish succeeded."
  Get-ProductionStatus
}

function Rollback-Release {
  if (-not $Force) {
    $confirmation = Read-Host "Type ROLLBACK to switch to the previous known-good release"
    if ($confirmation -cne "ROLLBACK") {
      Write-Host "Rollback cancelled."
      return
    }
  }

  $remote = @"
set -Eeuo pipefail
service_root='$RemoteServiceRoot'
exec 9>"`$service_root/.deploy.lock"
if ! flock -n 9; then
  echo 'A deployment is currently running; rollback was not started.' >&2
  exit 1
fi
current=`$(readlink -f "`$service_root/current" || true)
previous=`$(readlink -f "`$service_root/previous" || true)
case "`$current" in "`$service_root"/releases/*) ;; *) echo 'Current release is invalid.' >&2; exit 1 ;; esac
case "`$previous" in "`$service_root"/releases/*) ;; *) echo 'No previous known-good release is available.' >&2; exit 1 ;; esac
current_id=`${current##*/}
previous_id=`${previous##*/}
systemctl --user stop mathin.service
ln -sfn "releases/`$previous_id" "`$service_root/current.next"
mv -Tf "`$service_root/current.next" "`$service_root/current"
ln -sfn "releases/`$current_id" "`$service_root/previous.next"
mv -Tf "`$service_root/previous.next" "`$service_root/previous"
systemctl --user start mathin.service
for _ in {1..30}; do
  if curl --noproxy '*' -fsS --max-time 3 http://127.0.0.1:3131/api/health | grep -q '"status":"ok"'; then
    printf 'Rolled back to: %s\n' "`$previous_id"
    exit 0
  fi
  sleep 1
done
echo 'Rollback target did not become healthy.' >&2
exit 1
"@
  Invoke-XiaomiScript $remote
  Get-ProductionStatus
}

function Show-Menu {
  Write-Host ""
  Write-Host "==============================================="
  Write-Host "          Mathin Xiaomi Production"
  Write-Host "==============================================="
  Write-Host "  1. CHECK    lint, typecheck, production build"
  Write-Host "  2. PUBLISH  current committed Git version"
  Write-Host "  3. STATUS   release and health information"
  Write-Host "  4. ROLLBACK switch to previous known-good release"
  Write-Host "  Q. QUIT"
  Write-Host ""
  switch ((Read-Host "Choose").ToUpperInvariant()) {
    "1" { Invoke-LocalChecks | Out-Null }
    "2" { Publish-Release }
    "3" { Get-ProductionStatus }
    "4" { Rollback-Release }
    "Q" { return }
    default { throw "Unknown option." }
  }
}

switch ($Action) {
  "Menu" { Show-Menu }
  "Check" { Invoke-LocalChecks | Out-Null }
  "Publish" { Publish-Release }
  "Status" { Get-ProductionStatus }
  "Rollback" { Rollback-Release }
}
