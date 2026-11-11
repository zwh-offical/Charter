# DSH plugin package (release candidate)

Requires Node >=24.9.0 and targets DeepSeek Harness 0.2.2-rc.1.
Personal noncommercial use is free with attribution when sharing; commercial
use requires a separate license. See the package LICENSE.

Build a local artifact with `npm ci` and `npm pack`, or use the release candidate tarball. Installing the tarball
with DSH adds the bundle to the profile. Its default patch is empty. In a fresh test DSH
profile, inspect the composed configuration before enabling any Charter
layer. The stock `compaction-basic` should still be enabled.

For example, with a dedicated test DSH home set in PowerShell:

```powershell
dsh plugin --profile headless add 'C:\path\to\zwh-offical-charter-dsh-1.0.0-rc.2.tgz'
$package = Join-Path $env:DSH_HOME 'profiles/headless/node_modules/@zwh-offical/charter-dsh'
dsh headless --patch (Join-Path $package 'charter-enable.patch.yml') --dump-config
```


## Windows Desktop: install the Release tarball / 安装桌面版插件

### Install by URL / 链接安装

Copy the following Release asset URL into **Plugins → Add plugin** and select **Install**. If your desktop version does not accept tarball URLs in the dialog, use the PowerShell steps below. The URL was verified through the DSH desktop profile installer on Windows; the dialog itself was not tested.

在 **插件 → 添加插件** 粘贴下面的 Release 安装包链接，再点 **安装**。已用 Windows 版 DSH 的桌面配置安装器验证该链接；图形界面本身尚未验证。如果输入框不接受该链接，请用下方的 PowerShell 步骤。

```text
https://github.com/zwh-offical/Charter/releases/download/v1.0.0-rc.2/zwh-offical-charter-dsh-1.0.0-rc.2.tgz
```

### Install from a downloaded file / 从本地文件安装

Download the [`.tgz` asset](https://github.com/zwh-offical/Charter/releases/download/v1.0.0-rc.2/zwh-offical-charter-dsh-1.0.0-rc.2.tgz) and keep it intact. Fully quit DSH Desktop, then run the following in PowerShell, adjusting the paths if needed. Reopen DSH afterward.

下载上面的 `.tgz` 附件，不要解压。完全退出 DSH 桌面版，再在 PowerShell 执行下列命令；按实际路径修改，完成后重新打开 DSH。

```powershell
& 'D:/software/deepseek/resources/runtime/cli/bin/dsh.cmd' plugin --profile desktop add "$env:USERPROFILE/Downloads/zwh-offical-charter-dsh-1.0.0-rc.2.tgz"
```

Use the Release asset rather than the repository URL or GitHub's source archives. A Git install invokes a source build and can fail with `ERR_PNPM_PREPARE_PACKAGE` when `npm` is unavailable to Desktop. Installing the prebuilt asset skips that step. Installation keeps stock compaction; activation is a separate step.

请使用 Release 安装包。仓库地址和 GitHub 自动生成的源码包需要从源码构建；桌面环境找不到 `npm` 时会出现上述错误。预构建包跳过该步骤。安装后仍保留原生压缩，需要另行启用 Charter。


To try the zero-configuration Charter backend explicitly, use the packaged
`cordis.patch.yml` as a DSH `--patch` argument. This disables the stock
backend for that invocation and installs the excerpt-based Charter backend.
Do not combine it with another replacement patch. To roll back, remove the
patch argument and restart. Use `dsh plugin --profile headless remove @zwh-offical/charter-dsh` to uninstall.
Check the composed configuration again before reusing the profile.

The zero-configuration backend reads session history for compaction. It does
not restore operator-registered constraints. To test that feature, use the
research provider export `@zwh-offical/charter-dsh/provider` instead, in a
separate explicit patch. The provider requires an absolute host-controlled
policy directory and alert file, and DSH model, prompt and persistence
services. It reads registered policies, sends cleaned summary input through
the configured model, and can write alerts and compaction evidence. See
[research configuration](https://github.com/zwh-offical/Charter/blob/main/docs/OPTIONAL_HOST_FEATURES.md)
and the source checkout's reproduction guide. The npm bundle does not
register or export the file deletion tool.

Before publishing, verify in a clean DSH home: stock configuration, explicit
Charter activation, research-mode model compaction with a registered
constraint, a clear error for missing research configuration, and stock
configuration after removing the patch. The compatibility declaration is
intentionally limited to the pinned DSH release.

On Windows, the source checkout's `research/run-windows-pilot.ps1` accepts
`-PluginTarball` to install and exercise the packaged research provider in
the same isolated headless profile. Use an authorized test credential store.

Local acceptance on Windows desktop DSH 0.2.2-rc.1 verified tarball
installation without peer warnings, successful synthetic compaction,
the missing research configuration diagnostic, and return to stock
configuration after removing the patch or uninstalling. The desktop host
supplies the DSH modules, so their npm peer declarations are optional at
install time. Standalone consumers must provide matching peer packages.

The rc.2 packaged research provider also completed two real model-backed
compactions in a fresh headless profile. Independent audit verified the
constraint lineage and its presence in both subsequent model requests, and
the pilot verified the updated policy snapshot after revocation. If the
model reports TRANSPORT, check whether the profile's configured route is
reachable and whether the process inherits a stale proxy. Keep credentials
in the DSH credential store.

## 使用指南：自动压缩与告警 / Usage: automatic compaction and alerts

1. **先启用研究模式。** 仅安装插件或启用基础补丁，不会开启约束恢复、Charter 自动压缩或告警日志。研究模式需要宿主控制的 `policyDirectory` 和绝对路径 `alertsFile`；另设 `autoThresholdTokens` 才开启自动压缩。不设阈值时可用 `/compact` 手动测试。详见[研究模式配置](OPTIONAL_HOST_FEATURES.md)。
2. **把告警放在容易找到的位置。** 例如在 Windows 的「文档 → Charter」下放 `alerts.jsonl`。先建目录；确认它不在 Agent 的可写范围。策略目录继续单独存放。把下列示例加入研究 provider 的配置，用户名和阈值按实际情况修改：

   ```yaml
   alertsFile: 'C:/Users/your-name/Documents/Charter/alerts.jsonl'
   autoThresholdTokens: 24000
   ```

3. **实时查看。** 第一条记录写入后文件才会出现。在 PowerShell 运行下列命令（把路径改成配置里的实际值），按 Ctrl+C 退出：

   ```powershell
   Get-Content -LiteralPath "$env:USERPROFILE/Documents/Charter/alerts.jsonl" -Tail 20 -Wait |
     ForEach-Object {
       $e = $_ | ConvertFrom-Json
       "$($e.level) $($e.code) | $($e.stage) | policy $($e.baseline_version) | $($e.action)"
     }
   ```

| 日志代码 / Log code | 含义 / Meaning |
| --- | --- |
| `PRESERVED` | 检查点已通过落盘回查；不表示后续模型请求已核验。 / The persisted checkpoint passed readback; this does not verify a later model request. |
| `SEMANTIC_CONFLICT_CANDIDATE` | 摘要含疑似授权冲突，需要复核；不代表文件已被删除。 / A potential authorization conflict in the summary needs review; it does not prove a file was deleted. |
| `POST_COMMIT_VERIFY_FAILED` | 落盘回查失败，不应算成功，也不能假定已回滚。 / Readback failed; do not treat the compaction as successful or assume it rolled back. |

Charter 会向 DSH 的错误输出写一行简短提示，目前没有专门的桌面弹窗。若文件一直没出现，检查当前配置是否真正启用了研究 provider、日志父目录是否存在且宿主可写，以及是否触发过压缩。另行部署的删除守卫使用工具结果和宿主审计记录，见[宿主授权说明](WSL_HOST_AUTHORIZATION.md)。

Enable the research provider before expecting any Charter alerts. Set a host-controlled `policyDirectory` and an absolute `alertsFile` path. Create the log's parent directory outside agent-writable locations; keep policy storage separate. Set `autoThresholdTokens` to enable automatic compaction, or use `/compact` for a manual check. The log appears after the first entry. The PowerShell example above follows it live. Charter also writes a short message to DSH's error output; there is no dedicated desktop popup. For the separately deployed delete guard, see the [host authorization guide](WSL_HOST_AUTHORIZATION.md).
