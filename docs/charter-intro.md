# 别让 Agent 在压缩后忘记约束 / When agents forget constraints after compaction

[中文](#中文) · [English](#english)

## 中文

### 一次摘要为什么会影响权限判断？

设想你让 Agent 整理库存，只允许清理缓存，并明确禁止删除 `data/raw/`。对话变长后，DeepSeek Harness（DSH）会用摘要替换较早的历史。如果摘要只留下「准备清理文件」，后续模型就可能看不到原来的禁止条款；如果摘要写成「用户已同意清理」，它还可能把模型生成的文本误当成授权。

Charter 是面向 DSH 的研究预览。它把两件事分开处理：压缩后，模型还能看到哪些有效约束；执行时，宿主凭什么允许一次具体操作。

### 从原始消息到可审计的检查点

1. **登记约束。** 在启用登记命令的研究配置中，操作者可以用 `/charter pin` 指定原始用户消息和约束范围。Charter 回查原消息，记录序号、原文和 SHA-256 哈希。
2. **把摘要与约束分开。** 送去生成摘要的历史会移除已登记约束的逐字引用。转述仍可能进入摘要输入，因此 Charter 会对生成结果做保守的权限冲突筛查。筛查是候选检测，无法判断所有改写。
3. **验证提交与落盘。** Charter 用独立策略重建检查点中的约束，提交前核对证据，提交后回读已持久化的记录。DSH 的动态系统提示将当前策略快照带入后续请求。撤销后，后续请求应使用更新的快照。

### 从提示词走到执行边界

约束出现在提示词里，并不会改变进程的文件权限。单独部署的 Linux / WSL 2 宿主实验使用 Bubblewrap，把保护目录对隔离进程设为只读，同时保留可写的临时工作区。受信宿主可以校验精确路径与会话授权，并消费一次性批准来执行单文件删除。这要求宿主控制相关目录和工具入口。普通 npm 插件不会启用这个执行边界。

### 实验看到了什么？

- [压缩复测](WSL_AMENDED_RESULTS.md)：16 个合成会话，24 次压缩；B1 的 8 项登记约束核验均匹配原文、来源和哈希。各组原始文件均未变化，不能用这一批估算违规率差异。
- [宿主授权实验](WSL_HOST_AUTHORIZATION_RESULTS.md)：另一批共 12 个合成会话，原生组 3/3 个会话发生越权删除，其余三组各 0/3。样本不足以量化 Charter 相比单独守卫的额外收益。
- [插件验收](DSH_PLUGIN_INSTALL.md)：安装包在独立 Windows DSH 配置中完成两次真实模型压缩，审计核验了后续请求中的约束与撤销后的策略快照。

想试用可从[安装指南](DSH_PLUGIN_INSTALL.md)开始；想复查实验可看[复现指南](REPRODUCE.md)。个人非商业使用与商业授权分别适用[许可证](../LICENSE)和[商业授权指南](COMMERCIAL_LICENSING.md)。

## English

### How can a summary affect an authorization decision?

Suppose you ask an agent to tidy an inventory. It may clear caches, but it must leave `data/raw/` alone. As the conversation grows, DeepSeek Harness (DSH) replaces earlier history with a summary. If the summary only says “preparing to clean up,” the next model request may omit the prohibition. If the summary says “the user approved cleanup,” generated text may be mistaken for authorization.

Charter is a research preview for DSH. It separates two questions: which active constraints the model can see after compaction, and what evidence the host needs to permit a particular operation.

### From an original message to an auditable checkpoint

1. **Register the constraint.** In a research profile with the pin command enabled, an operator uses `/charter pin` to identify the original user message and define the constraint's scope. Charter checks the source and records its sequence number, exact wording, and SHA-256 hash.
2. **Separate summarization from constraint retention.** Charter removes verbatim registered quotes from the history sent for summarization. Paraphrases can remain, so the generated summary also goes through a conservative screen for potential permission conflicts. The screen does not recognize every possible paraphrase.
3. **Verify the commit and persisted evidence.** Charter reconstructs checkpoint constraints from the separate policy, checks them before commit, and reads back persisted evidence afterward. DSH's dynamic system prompt carries the current policy snapshot into later requests. Requests after revocation should use the updated snapshot.

### From prompt context to an execution boundary

Showing a constraint in a prompt does not change a process's file permissions. A separately deployed Linux or WSL 2 experiment uses Bubblewrap to mount protected directories read-only for the isolated process while leaving a writable scratch area. A trusted host can validate an exact path and session authorization, then consume a one-time approval to delete one file. This relies on the host controlling the relevant directories and tool entry points. The standard npm plugin does not enable that boundary.

### What did the experiments show?

- [Compaction retest](WSL_AMENDED_RESULTS.md): 16 synthetic sessions and 24 compactions. All eight registered B1 constraint checks matched text, source, and hash. Raw files were unchanged across groups, so this run does not establish a difference in violation rates.
- [Host authorization experiment](WSL_HOST_AUTHORIZATION_RESULTS.md): In a separate run with 12 synthetic sessions, unauthorized deletion occurred in 3/3 stock sessions and 0/3 in each of the other groups. The sample does not quantify Charter's added benefit over a guard alone.
- [Plugin acceptance](DSH_PLUGIN_INSTALL.md): The installed package completed two live model compactions in an isolated Windows DSH profile. The audit verified retained constraints in subsequent requests and the policy snapshot after revocation.

Start with the [installation guide](DSH_PLUGIN_INSTALL.md), or see the [reproduction guide](REPRODUCE.md) to examine the experiments. The [license](../LICENSE) covers personal noncommercial use; see the [commercial licensing guide](COMMERCIAL_LICENSING.md) for other use.
