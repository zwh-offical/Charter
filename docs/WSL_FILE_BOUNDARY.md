# WSL 文件隔离与宿主批准

在 WSL 2 Ubuntu x86-64 上，用 `charter-boundary.py` 启动需要隔离的进程。启动器把 `protected` 只读挂载到 `/workspace/protected`，把 `scratch` 可写挂载到 `/workspace/scratch`。子进程及其派生进程共用这个文件系统边界。宿主状态留在 `host-state`，进程没有这个挂载。启动器关闭网络、继承的额外文件描述符和嵌套用户命名空间。

由可信宿主操作者在 WSL 的 Linux 文件系统上建立工作区。选择新的私有目录，将要保护的数据放入 `protected`。

```bash
umask 077
root=$(mktemp -d "$HOME/charter-work.XXXXXX")
mkdir "$root/protected" "$root/scratch" "$root/host-state"
printf 'example\n' > "$root/protected/report.txt"
python3 research/wsl/charter-boundary.py "$root" run -- /bin/bash
```

批准即执行一次精确路径的删除。操作员在隔离环境外调用以下命令。路径相对于 `protected`，且目标必须是普通单链接文件。宿主先持久化批准，再执行删除，最后记录结果。审计记录在 `host-state/delete.jsonl`。

```bash
python3 research/wsl/charter-boundary.py "$root" approve-delete report.txt
```

DSH 和 Node 可从操作者指定的只读运行时目录启动。运行时目录只放可信程序和依赖。DSH 进程的会话文件可以写到 `scratch`，宿主删除的授权和审计只以隔离外的操作为准。r14 的会话内批准属于原来的工具流程。当前启动器关闭网络，验证范围为离线运行与文件隔离。

```bash
python3 research/wsl/charter-boundary.py "$root" run \
  --runtime /absolute/path/to/node-runtime \
  --runtime /absolute/path/to/dsh-installation \
  -- /runtime/1/node_modules/.bin/dsh --version
```

测试用合成文件执行 Bash 和 Python 删除与覆盖、`cp`、`mv`、符号链接和硬链接绕过。它比较保护文件与宿主策略文件的哈希，并核对正常临时文件操作和宿主批准删除的审计。

```bash
bash research/wsl/test-charter-boundary.sh
bash research/wsl/test-charter-boundary.sh /absolute/path/to/node-runtime /absolute/path/to/dsh-installation
```
