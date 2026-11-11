# Charter r16 交接

r16 是 Research Preview 的源码交付版本。使用官方 DeepSeek Harness npm 发行版，复现锁定 `@deepseek-ai/dsh@0.2.2-rc.1`。支持范围为 WSL 2 Ubuntu x86-64 上的离线验收与宿主受控单文件删除。

- [首次安装与离线验收](docs/R16_QUICKSTART.md) 包含 Microsoft Store 安装 Ubuntu、构建、重放和审计核对步骤。
- [宿主授权接入](docs/WSL_HOST_AUTHORIZATION.md) 包含运行边界、部署配置和故障恢复。
- [宿主授权验收](docs/WSL_HOST_AUTHORIZATION_RESULTS.md) 记录真实会话、固定重放和对抗验证结果。
- [开发与验收计划](PLAN.md) 记录当前状态和后续验收项。

前一版 r16 源码已在新 WSL 目录通过构建、源码测试、宿主对抗测试和五组离线重放。发布候选版 1.0.0-rc.1 增加了 GitHub CI 和三项摘要期间变更的回归用例。外部使用者的独立复现仍待完成。

最终修订补齐了删除动作匹配和事实区集合校验，统一了两端的删除路径语法，并区分取消、策略拒绝和回执重放。策略登记使用排他锁。若进程异常退出留下锁文件，先确认对应写入者已停止，再由宿主操作者清理残留锁。

代码入口是 `packages/charter-compaction/src`、`packages/charter-audit/src` 和 `research/wsl`。原始会话与私有凭据由部署者保管。GitHub 源码包包含复现脚本和结果说明。
