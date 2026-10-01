#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// 同一仓库的 worktree 共享 refs，索引始终读取集成分支，而非当前目录的旧副本。
const integrationRef = "refs/heads/main";

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error?.code === "EPERM") {
    throw new Error("当前运行权限限制 Node 启动 Git。可在终端分别执行 git status --short、git rev-parse main、git show main:.ai/STATUS.md 完成只读核对。");
  }
  if (result.error || result.status !== 0) {
    throw new Error(`无法读取 Git 上下文（${args[0]}）。请确认位于 Mathin 仓库，且 main 已包含协作入口。`);
  }
  return result.stdout;
}

try {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const branch = git(["branch", "--show-current"], root).trim() || "detached HEAD";
  const head = git(["rev-parse", "HEAD"], root).trim();
  const integrationHead = git(["rev-parse", integrationRef], root).trim();
  const board = git(["show", `${integrationHead}:.ai/STATUS.md`], root);
  const status = git(["status", "--short"], root).trim();

  console.log(`工作目录：${root}`);
  console.log(`当前分支：${branch}\n当前提交：${head}`);
  console.log(`集成分支：main\n集成提交：${integrationHead}`);
  console.log(`工作树状态：\n${status || "干净"}`);
  console.log(`\nmain 的协作索引：\n${board.trimEnd()}`);

  // 只检查对应的项目技能，不读取私人设置、账号、连接配置或记忆内容。
  const sources = git(["ls-files", "-z", "--", ".agents/skills"], root).split("\0").filter(Boolean);
  const differences = [];
  for (const source of sources) {
    const mirror = source.replace(/^\.agents\//, ".claude/");
    const sourcePath = path.join(root, source);
    const mirrorPath = path.join(root, mirror);
    if (!fs.existsSync(sourcePath)) {
      differences.push(`${source}：共享源在工作树缺失，请核对本地变更。`);
    } else if (!fs.existsSync(mirrorPath)) {
      differences.push(`${mirror}：无本机副本，按项目入口直接读取 ${source}。`);
    } else if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(mirrorPath))) {
      differences.push(`${mirror}：本机副本与共享源不同，执行前读取 ${source}。`);
    }
  }
  const skillsSummary = sources.length === 0
    ? "当前分支尚无已跟踪的项目技能，请核对任务基线。"
    : differences.length ? differences.join("\n") : "对应的本机技能副本与共享源一致。";
  console.log(`\n项目技能：\n${skillsSummary}`);
  console.log("\n此命令只读。任务认领以 main 任务卡为准；接收方尚未回传时保持待接收状态。");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
