# Reproduce P0

```bash
node --version
npm --version
npx @deepseek-ai/dsh@0.2.2-rc.1 --version
npx @deepseek-ai/dsh@0.2.2-rc.1 --help
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --help
npm ci
npm test
npm run typecheck
```

Expected today: Node, npm, and the pinned DSH launcher succeed. A real agent request still requires an isolated non-production model route. Do not substitute fake session events for P0-03 evidence.

## Windows desktop Harness preflight

Run in PowerShell from the Charter checkout. Use the installed desktop launcher
and a fresh fixture directory and DSH home for each attempt. Set the launcher
path to match your installation.

```powershell
$dsh = if ($env:DSH_BIN) { $env:DSH_BIN } else { (Get-Command dsh -ErrorAction Stop).Source }
$preflight = New-Item -ItemType Directory -Path (
    Join-Path $env:TEMP ("charter-p0-" + [guid]::NewGuid().ToString('N'))
)
$fixture = New-Item -ItemType Directory -Path (Join-Path $preflight.FullName 'fixture')
$previousDshHome = $env:DSH_HOME
Push-Location $fixture.FullName
try {
    $env:DSH_HOME = Join-Path $preflight.FullName 'dsh-home'
    & $dsh --version
    & $dsh headless --help
    & $dsh headless --json --permission-mode read-only --approval-policy never `
        'Reply with CHARTER_PREFLIGHT_OK. Do not use tools.'
    "DSH exit code = $LASTEXITCODE"
} finally {
    $env:DSH_HOME = $previousDshHome
    Pop-Location
}
```

The locked headless profile defaults to `deepseek-official`. For a credential-free
probe, use a shell without `DEEPSEEK_API_KEY`. For a live probe, use a dedicated
test key through the credentials service for the isolated profile or through a
process-scoped `DEEPSEEK_API_KEY`. Keep the key out of the checkout and evidence.
This preflight checks request admission only. Live compaction and prompt capture
still require the OS or container isolation and evidence specified in `PLAN.md`.

## B1 synthetic fixture

After `npm ci`, run `npm test`, `npm run typecheck`, and `npm run build`.
With the pinned desktop launcher, set a fresh `DSH_HOME` and run these
commands from an empty fixture directory in a shell without a model credential.
`$checkout` is the absolute path to this checkout.

```powershell
$b1 = Join-Path $checkout 'presets/b1-fixture.patch.yml'
$seed = Join-Path $checkout 'presets/seed-fixture.patch.yml'
& $dsh headless --patch $b1 --patch $seed --json --permission-mode read-only --approval-policy never 'Fixture test'
& $dsh headless --patch $seed --json --permission-mode read-only --approval-policy never 'B0 configuration control'
```

The first command prints a successful `/compact` fixture result with
`CharterCompaction`. The second starts a new session and prints
`BasicCompactionEngine`. The ordinary headless task that follows the fixture
reports `MISSING_CREDENTIAL` in both runs. The local B1 summary and its flush
complete before that task. Inspect `DSH_HOME/sessions` for the transaction.

The pinned token-meter package ships a declaration with an unresolved internal
type. `skipLibCheck` bypasses dependency declaration validation while retaining
strict checks of Charter and its tests.

## Windows B1 live pilot

Build the project, then run `research/run-windows-pilot.ps1` with the pinned
launcher path and a new private destination. Provide a dedicated test API
through a process-scoped environment variable or the local `-CredentialStore`
parameter. The script runs C1, C2 and revocation with synthetic read-only
prompts. It validates both checkpoints and matching next-request hashes.

Re-run the independent audit with
`npm run audit -- --baseline <v2.json> --requests <trace.jsonl> --alerts <alerts.jsonl> <session.v4.jsonl.zstd>`.
Omit optional inputs to audit transaction structure alone.

## Linux/WSL 离线重放

按 [r16 快速入门](R16_QUICKSTART.md) 安装并构建后，在源码根目录运行以下命令。
该命令重放当前版本的五组对照，使用合成文件和固定模型输出。

```bash
bash research/wsl/r14-matrix.sh "$PWD" replay native r11 native-guard charter-guard boundary-guard
```

每组的 `report.json` 位于命令打印的批次目录下。
