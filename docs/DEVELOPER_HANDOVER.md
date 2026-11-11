# Charter 开发与维护交接 / Developer and maintenance handover

[中文](#中文) · [English](#english)

## 中文

Charter 是面向 DeepSeek Harness（DSH）的研究预览。它在压缩后保留已登记的用户约束，并提供独立审计。Linux / WSL 的单文件受控删除是另行部署的宿主功能，安装插件不会启用它。

### 从哪里读代码

| 位置 | 职责 |
| --- | --- |
| [压缩模块](../packages/charter-compaction/src) | `index.ts` 编排压缩；`selector.ts` 选择历史区间并检查工具调用配对；`research-provider.ts` 接入研究模式和可选登记命令。 |
| 同目录下的 `pin.ts`、`policy.ts` | 从原始用户事件登记约束，维护会话策略版本，渲染并验证约束快照。 |
| 同目录下的 `summary-input.ts`、`summarizer.ts`、`evidence.ts` | 清洗摘要输入、生成摘要、记录告警并回查持久化证据。 |
| [审计 CLI](../packages/charter-audit/src) | 独立验证日志中的压缩事务、谱系和可选的策略、请求、告警证据。 |
| [宿主实验](../research/wsl) · [测试](../tests) | Linux / WSL 的隔离与回执测试；TypeScript 单测和 DSH 契约测试。 |

### 修改时要守住的约定

- **登记**：校验来源是原始用户消息，按会话加锁更新策略。策略记录原文、来源序号和 SHA-256 哈希；哈希是完整性校验，不是数字签名。
- **压缩**：研究模式从策略恢复有效约束。摘要输入移除已登记原文；转述仍可能出现，权限冲突筛查只能发现候选。提交前检查候选和历史区间，落盘后回读证据。回读失败不能当作成功，也不等于落盘已回滚。
- **授权**：提示词只向模型提供当前策略。宿主边界依赖受信进程控制策略、状态目录和执行入口；同一身份在隔离外拥有写权限时，该边界不提供保护。回执记入删除意图后即消耗，失败时先核对目标和日志，需要继续则重新批准。详见[宿主授权说明](WSL_HOST_AUTHORIZATION.md)。

### 开发、验证与恢复

要求 Node.js `>=24.9.0`；插件目前验证于 Windows 桌面 DSH `0.2.2-rc.1` 的独立 headless 配置。原生 Windows 可开发插件；Bubblewrap 测试需 Linux 或 WSL 2。

```bash
npm ci
npm run typecheck
npm test
npm run build
```

从 [复现指南](REPRODUCE.md) 运行真实模型试验与离线审计。只用独立测试凭据和合成数据；日志留在本地，公开前检查内容。宿主测试在 Linux / WSL 2 下执行：

```bash
bash research/wsl/test-charter-boundary.sh
python3 research/wsl/test-charter-receipts.py
```

插件加载失败时移除显式启用补丁，回到原生压缩，再检查 [安装指南](DSH_PLUGIN_INSTALL.md) 中的宿主版本与研究配置。调整自动压缩阈值后，应复测历史区间、工具配对、策略更新及中断后的落盘状态。扩大 DSH 兼容范围前，先在目标版本重跑安装、压缩和卸载。

[宿主授权实验](WSL_HOST_AUTHORIZATION_RESULTS.md) 中原生组的 3/3 是一批合成会话的观测值，不能当成普遍发生率。另一次[压缩复测](WSL_AMENDED_RESULTS.md)中各组原始文件均未变化。

## English

Charter is a research preview for DeepSeek Harness (DSH). It retains registered user constraints across compaction and provides an independent audit. Controlled single-file deletion on Linux or WSL is a separate host deployment. Installing the plugin does not enable it.

### Where to start in the code

| Location | Responsibility |
| --- | --- |
| [Compaction module](../packages/charter-compaction/src) | `index.ts` coordinates compaction; `selector.ts` selects history and checks tool pairing; `research-provider.ts` wires research mode and the optional pin command. |
| `pin.ts` and `policy.ts` in the same directory | Register constraints from original user events, track policy versions, and render and verify policy snapshots. |
| `summary-input.ts`, `summarizer.ts`, and `evidence.ts` | Prepare summary input, generate summaries, record alerts, and read back persisted evidence. |
| [Audit CLI](../packages/charter-audit/src) | Independently verify compaction transactions, lineage, and optional policy, request, and alert evidence. |
| [Host experiments](../research/wsl) and [tests](../tests) | Linux/WSL isolation and receipt tests, TypeScript unit tests, and DSH contract tests. |

### Invariants to preserve

- **Registration:** Verify the source is an original user message and update policy under a per-session lock. Record the quote, source sequence, and SHA-256 hash. The hash is an integrity check; it is not a digital signature.
- **Compaction:** Research mode restores active constraints from the policy. It removes verbatim registered quotes from summary input; paraphrases can remain, and permission screening only flags candidates. Check the candidate and history range before committing, then read back persisted evidence. A failed readback is not success or proof that the write was rolled back.
- **Authorization:** The prompt supplies current policy to the model. The host boundary relies on trusted control of policy, state directories, and execution entry points. It does not protect against writers with the same identity outside isolation. A receipt is consumed once a deletion intent is recorded. If execution fails, inspect the target and log and obtain fresh approval if needed. See [host authorization](WSL_HOST_AUTHORIZATION.md).

### Develop, verify, and recover

Use Node.js `>=24.9.0`. The plugin was verified on Windows desktop DSH `0.2.2-rc.1` in an isolated headless profile. Plugin development can run on native Windows; Bubblewrap tests require Linux or WSL 2.

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. Use the [reproduction guide](REPRODUCE.md) for live model trials and offline audits. Use dedicated test credentials and synthetic data, and review logs before sharing. On Linux or WSL 2, run the two host test commands above.

If the plugin fails to load, remove the explicit activation patch to return to stock compaction. Then check the host version and research configuration in the [installation guide](DSH_PLUGIN_INSTALL.md). After tuning automatic compaction, retest history ranges, tool pairing, policy updates, and persisted state after interruption. Before extending compatibility claims, rerun installation, compaction, and uninstall on the target DSH version.

The 3/3 result in the stock arm of the [host authorization experiment](WSL_HOST_AUTHORIZATION_RESULTS.md) is an observation from one synthetic batch, not a general incident rate. In a separate [compaction retest](WSL_AMENDED_RESULTS.md), raw files were unchanged across all groups.
