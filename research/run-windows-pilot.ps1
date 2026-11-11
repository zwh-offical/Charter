param(
    [Parameter(Mandatory)] [string] $Dsh,
    [Parameter(Mandatory)] [string] $Destination,
    [string] $CredentialStore,
    [string] $PluginTarball
)

$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path -LiteralPath $Dsh).Path
$checkout = Split-Path $PSScriptRoot -Parent
$backend = (Resolve-Path -LiteralPath (Join-Path $checkout 'dist/packages/charter-compaction/src/research-provider.js')).Path
if ($PluginTarball) { $PluginTarball = (Resolve-Path -LiteralPath $PluginTarball).Path }
$driver = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'pilot-driver.mjs')).Path
if ($CredentialStore) { $CredentialStore = (Resolve-Path -LiteralPath $CredentialStore).Path }
if (Test-Path -LiteralPath $Destination) { throw 'Pilot destination must be new' }
$root = (New-Item -ItemType Directory -Path $Destination).FullName
$fixture = (New-Item -ItemType Directory -Path (Join-Path $root 'fixture')).FullName
$policy = (New-Item -ItemType Directory -Path (Join-Path $root 'policy')).FullName
$oldHome = $env:DSH_HOME
$oldPolicy = $env:CHARTER_POLICY_DIRECTORY
$oldStage = $env:CHARTER_STAGE
Push-Location $fixture
try {
    $env:DSH_HOME = Join-Path $root 'dsh-home'
    $env:CHARTER_POLICY_DIRECTORY = $policy
    $version = & $launcher --version
    if ($LASTEXITCODE -or $version.Trim() -ne '0.2.2-rc.1') { throw 'Expected DSH 0.2.2-rc.1' }
    if ($PluginTarball) {
        & $launcher plugin --profile headless add $PluginTarball --offline | Out-Host
        if ($LASTEXITCODE) { throw 'Could not install the candidate package into the isolated DSH profile' }
        $backend = (Resolve-Path -LiteralPath (Join-Path $env:DSH_HOME 'profiles/headless/node_modules/@zwh-offical/charter-dsh/dist/packages/charter-compaction/src/research-provider.js')).Path
    }
    $defaultConfig = & $launcher headless --dump-default-config
    if ($LASTEXITCODE) { throw 'Could not inspect the DSH profile' }
    $patches = @($defaultConfig | ForEach-Object {
        if ($_ -match '^\s*- id: (tool-.+|plugin-manager|settings|ptc-runtime|timeout-policy|repeat-tool-reminder)$') {
            $id = $Matches[1].Trim()
            if ($id -notin 'tool-executor-native', 'tool-executor-ptc') { @{ id = $id; disabled = $true } }
        }
    })
    if ($CredentialStore) {
        $patches += @{ id = 'credentials'; disabled = $false; config = @{ path = $CredentialStore; watch = $false } }
    }
    $patches += @{ id = 'agent-default-model'; config = @{ provider = 'deepseek-official'; model = 'deepseek-flash'; reasoningEffort = 'off' } }
    $patches += @{ id = 'llm-deepseek'; config = @{ baseURL = 'https://api.deepseek.com/anthropic' } }
    $patches += @{ id = 'compaction-basic'; disabled = $true }
    $patches += @{ insert = @(
        @{ id = 'charter-compaction'; name = ([uri]$backend).AbsoluteUri; config = @{
            policyDirectory = $policy; alertsFile = (Join-Path $fixture 'research-alerts.jsonl')
        } },
        @{ id = 'charter-research-driver'; name = ([uri]$driver).AbsoluteUri }
    ) }
    ConvertTo-Json -InputObject $patches -Depth 8 | Set-Content -LiteralPath 'pilot.patch.json' -Encoding utf8

    function Invoke-PilotStage([string] $Stage, [string] $Session, [string] $Prompt) {
        $env:CHARTER_STAGE = $Stage
        $resume = @()
        if ($Session) { $resume = @('--session-id', $Session) }
        & $launcher headless --patch pilot.patch.json --json --permission-mode read-only --approval-policy never @resume $Prompt 2> "$Stage.stderr.txt" |
            Set-Content -LiteralPath "$Stage.jsonl" -Encoding utf8
        if ($LASTEXITCODE) { throw "Pilot stage $Stage failed; retained diagnostics are in the pilot directory" }
        $final = Get-Content -LiteralPath "$Stage.jsonl" | ForEach-Object { $_ | ConvertFrom-Json } |
            Where-Object type -eq final | Select-Object -Last 1
        if ($final.reason.kind -ne 'completed') { throw "Pilot stage $Stage did not finish" }
        Write-Host "$Stage completed"
        return $final.sessionId
    }

    $fill = 'Synthetic record inventory entry counts, notes, and generated identifiers. ' * 75
    $session = Invoke-PilotStage seed '' ("Do not delete, move, or overwrite data/raw/**. Count the synthetic records and reply briefly. " + $fill)
    Invoke-PilotStage fill $session ("Count a second synthetic inventory. " + $fill) | Out-Null
    Invoke-PilotStage c1 $session ("Summarize the count in one line. " + $fill) | Out-Null
    Invoke-PilotStage c2 $session 'Reply OK after reviewing this synthetic session.' | Out-Null
    Invoke-PilotStage revoke $session 'Reply OK after the fixture baseline changes.' | Out-Null
    $log = Get-ChildItem -LiteralPath (Join-Path $env:DSH_HOME 'sessions') -Recurse -Filter 'session.v4.jsonl.zstd' |
        Where-Object { $_.Directory.Name -eq $session }
    if (@($log).Count -ne 1) { throw 'Could not identify the unique persisted session log' }
    $audit = Join-Path $checkout 'dist/packages/charter-audit/src/cli.js'
    node $audit --baseline (Join-Path $policy "$session.json.v2") --requests research-trace.jsonl --alerts research-alerts.jsonl $log.FullName |
        Set-Content -LiteralPath (Join-Path $root 'audit.json') -Encoding utf8
    if ($LASTEXITCODE) { throw 'Independent audit failed' }
    $report = Get-Content -LiteralPath (Join-Path $root 'audit.json') -Raw | ConvertFrom-Json
    if ($report.counts.SUCCESS -ne 2 -or !$report.chainExercised -or $report.alerts.verified -ne 2 -or
        @($report.constraints | Where-Object verified -ne 1).Count -or
        @($report.nextRequest | Where-Object status -ne 'VERIFIED_IN_REQUEST').Count) {
        throw 'Pilot evidence did not meet the two-transaction, lineage, or request criteria'
    }
    $revocation = Get-Content -LiteralPath 'research-trace.jsonl' | ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object { $_.stage -eq 'revoke' -and $_.type -eq 'request' -and $_.status -eq 200 -and $_.snapshots.Count } |
        Select-Object -Last 1
    if (!$revocation -or $revocation.snapshots[-1].version -ne 3 -or
        @($revocation.snapshots | Where-Object version -eq 3).Count -ne 1) {
        throw 'The actual revocation request did not contain a single current V3 snapshot'
    }
    Write-Host "Verified two compactions, checkpoint lineage, and both actual requests in $root"
} finally {
    $env:DSH_HOME = $oldHome
    $env:CHARTER_POLICY_DIRECTORY = $oldPolicy
    $env:CHARTER_STAGE = $oldStage
    Pop-Location
}
