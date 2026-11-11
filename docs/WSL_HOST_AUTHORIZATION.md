# WSL 宿主授权接入

此配置在 WSL 2 Ubuntu x86-64 上运行。宿主需要 Python 3、Bubblewrap、util-linux 中的 `findmnt`，以及项目锁定的 Node 和 DSH 版本。使用 Node 24.9 或更新的 24.x 和 DSH 0.2.2-rc.1。执行 `npm ci` 和 `npm run build`。部署前运行文件隔离、回执与 DSH 重放测试。更换 DSH 版本后需重跑这些测试，因为宿主依赖工具调用和用户命令的事件格式。

可信 DSH 宿主配置 `research/charter-delete-provider.mjs`，指定 `enforce: true`、`hostBoundary: true`、隔离工作区的 `workspace` 和独立的 `policyDirectory`。工作区包含 `protected`、`scratch` 和 `host-state` 三个私有目录。DSH 的会话目录与规则目录由宿主控制。宿主只注册审核过的工具。任意代码和通用文件工具必须由文件隔离启动器运行，或从宿主工具目录中禁用。默认的 DSH 配置不会自动应用这一布局。

以保护 `protected/data/raw/**` 为例。用户通过 `/charter pin` 登记该规则，然后可通过 `/charter-access approve-delete protected/data/raw/report.txt` 批准一个精确路径。宿主从 DSH 的原始事件中验证当前快照、用户命令和对应的原生工具调用。它通过私有子进程标准输入把回执交给执行器。隔离进程看不到宿主状态目录，执行器也没有对沙箱开放监听端口。`approve-delete` 的独立操作员命令仍用于宿主管理。DSH 请求使用 `execute-authorized`，该入口要求由可信宿主调用。

一次批准最多消费一次。删除前，执行器持有宿主状态目录锁，使用目录描述符遍历，拒绝链接和特殊文件，复核目标身份，并先持久化操作意图。沙箱进程对受保护目录没有写权限。其他宿主写入必须由操作者协调，禁止同 UID 的外部进程直接改动保护目录、运行时或审计状态。目录锁只约束遵守该协议的宿主进程。

若审计只留下 `approved` 且没有 `deleted`，先检查目标和日志，不要重放旧回执。回执在意图落盘时已经消费。确认仍需删除后，由用户重新批准。若日志损坏，保留原件并由宿主操作者核对恢复。不要清空日志来解除重放保护。

```bash
bash research/wsl/test-charter-boundary.sh
python3 research/wsl/test-charter-receipts.py
bash research/wsl/r14-matrix.sh /absolute/path/to/built-project replay boundary-guard
```

`boundary-guard` 使用真实 DSH 进程和固定的模型传输重放。测试交叉核对原始工具调用、压缩后的策略快照、用户批准与宿主审计。隔离攻击用例另外验证操作系统边界。真实模型的四组对照可以用 `live` 模式重复。设置不同的 `CHARTER_TRIAL` 可在库存、归档索引和数据集清单之间切换，并生成不同文件名和会话。这个值控制测试材料，不控制模型采样种子。

```bash
CHARTER_TRIAL=1 bash research/wsl/r14-matrix.sh /absolute/path/to/built-project live
python3 research/wsl/summarize-charter-matrix.py /path/to/batch-a /path/to/batch-b
```

汇总按模式与实验组报告会话级越权尝试、文件副作用、合法操作误拦及 Wilson 95% 区间。失败的会话单独列出，不进入成功会话的统计。重复执行固定重放用于工程回归，模型行为推断需要多会话的真实模型数据。
