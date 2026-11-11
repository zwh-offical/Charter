# Charter

**1.0.0-rc.2 · DSH Plugin Research Preview** · [中文](#中文) · [English](#english)

[下载插件 / Download](https://github.com/zwh-offical/Charter/releases/download/v1.0.0-rc.2/zwh-offical-charter-dsh-1.0.0-rc.2.tgz) · [安装指南 / Installation](docs/DSH_PLUGIN_INSTALL.md) · [技术文章 / Technical article](docs/charter-intro.md)

源码可见：个人非商业使用免费，分享时须保留署名；商业使用须另行授权。见 [许可证](LICENSE)。  
Source available: free for personal noncommercial use, with attribution when sharing; commercial use requires a separate license. See [LICENSE](LICENSE).

## 中文

> 面向长会话 Agent 的确定性约束保留与宿主受控执行框架，为 DeepSeek Harness（DSH）打造。

### 痛点

上下文压缩会用摘要替换早期对话。摘要可能省略“不要删除原始数据”这样的禁令，也可能把历史描述写成新授权。Charter 让已登记约束独立于模型摘要保存，并在压缩后核验约束的原文和来源。

### 核心特性

- **约束登记与摘要清洗**：研究模式可启用 `/charter pin`，登记原始用户消息中的约束。摘要输入移除已登记的逐字引用；有效约束从独立策略恢复。
- **两阶段验证**：提交前核对来源及哈希，持久化后回读并核对证据。DSH 动态系统提示向后续请求提供当前策略快照。
- **可选的宿主执行边界**：Linux / WSL 2 上可用 Bubblewrap 将受保护目录对隔离进程设为只读。受信宿主可验证并执行一次性单文件授权。此能力需独立部署，npm 插件不会启用删除守卫。
- **独立审计**：离线核对会话日志、压缩谱系、策略与告警记录，无需启动 DSH。

### 快速上手

插件需要 Node.js `>=24.9.0`，已在 Windows 桌面版 DSH `0.2.2-rc.1` 的独立 headless 配置验证。见[安装与启用指南](docs/DSH_PLUGIN_INSTALL.md)。安装后保留原生压缩；基础模式需显式启用，约束恢复需配置研究模式。

从源码构建：

```bash
npm ci
npm test
npm run typecheck
npm run build
```

运行宿主隔离实验时，Windows 用户可先从 Microsoft Store 搜索安装 Ubuntu，再使用 WSL 2。Linux / WSL 环境需安装 Bubblewrap。详见[复现指南](docs/REPRODUCE.md)。

### 架构与实测

[开发与维护交接](docs/DEVELOPER_HANDOVER.md#中文)

延伸阅读：[别让 Agent 在压缩后忘记约束](docs/charter-intro.md#中文)。

[压缩插件](packages/charter-compaction/src)处理约束、摘要和持久化验证；[审计工具](packages/charter-audit/src)读取独立证据；[WSL 宿主实验](research/wsl)验证受控执行边界。

- [压缩复测](docs/WSL_AMENDED_RESULTS.md)：16 个会话、24 次压缩；B1 登记约束的原文、来源和哈希 8/8 匹配。该批各组原始文件均未变化，无法据此判断违规率差异。
- [宿主授权实验](docs/WSL_HOST_AUTHORIZATION_RESULTS.md)：另做 12 个会话，原生组 3/3 个会话发生越权删除，其余三组各为 0/3。样本不足以量化 Charter 相比单独守卫的额外收益。
- [插件验收](docs/DSH_PLUGIN_INSTALL.md)：安装包完成两次真实模型压缩，审计核验了后续请求中的约束和撤销后的策略。

商业部署、商业产品集成或面向客户提供服务需另行取得[商业授权](docs/COMMERCIAL_LICENSING.md)。

## English

> Deterministic constraint retention and host-controlled execution for long-running agents, built for DeepSeek Harness (DSH).

### The problem

Compaction replaces early conversation history with a summary. A summary can omit a prohibition such as “do not delete the raw data,” or mistake historical context for a new authorization. Charter stores registered constraints separately from the summary and verifies their text and source across compaction.

### Core features

- **Constraint pinning and summary input cleanup:** Research mode can enable `/charter pin` to register constraints from original user messages. Verbatim registered quotes are removed from summary input; active constraints are restored from the separate policy.
- **Two-stage verification:** Charter checks source and hashes before committing, then reads back persisted evidence. DSH dynamic system prompts provide the current policy snapshot to later model requests.
- **Optional host boundary:** On Linux or WSL 2, Bubblewrap can mount protected directories read-only for the isolated process. A trusted host can verify and execute a one-time single-file authorization. This requires separate deployment; the npm plugin does not enable the delete guard.
- **Independent audit:** Verify session logs, compaction lineage, policies, and alerts offline without starting DSH.

### Getting started

The plugin requires Node.js `>=24.9.0`. It was tested on desktop DSH `0.2.2-rc.1` on Windows in an isolated headless profile. See the [installation and activation guide](docs/DSH_PLUGIN_INSTALL.md). Installation keeps stock compaction in place. Enable the basic backend explicitly, or configure research mode for constraint restoration.

To build from source, run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. For host isolation experiments on Windows, install Ubuntu from the Microsoft Store and use WSL 2. Install Bubblewrap in the Linux environment. See the [reproduction guide](docs/REPRODUCE.md).

### Architecture and evidence

[Developer and maintenance handover](docs/DEVELOPER_HANDOVER.md#english)

Read more: [When agents forget constraints after compaction](docs/charter-intro.md#english).

The [compaction plugin](packages/charter-compaction/src) handles constraints, summarization, and persistence checks. The [audit CLI](packages/charter-audit/src) reads independent evidence. The [WSL host experiments](research/wsl) exercise the controlled execution boundary.

- [Compaction replay](docs/WSL_AMENDED_RESULTS.md): 16 sessions and 24 compactions. All 8 registered B1 constraint checks matched text, source, and hash. Raw files were unchanged across groups, so this batch does not establish a difference in violation rates.
- [Host authorization experiment](docs/WSL_HOST_AUTHORIZATION_RESULTS.md): In a separate 12-session run, 3/3 stock sessions had unauthorized deletions and each of the other three groups had 0/3. The sample does not quantify Charter's added benefit over the guard alone.
- [Plugin acceptance](docs/DSH_PLUGIN_INSTALL.md): The installed package completed two live model compactions. The audit verified constraints in subsequent requests and the updated policy after revocation.

Business deployment, commercial product integration, and customer-facing use require a separate [commercial license](docs/COMMERCIAL_LICENSING.md).
