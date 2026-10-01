#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 同一仓库的 worktree 共享 refs，索引始终读取集成分支，而非当前目录的旧副本。
const integrationRef = "refs/heads/main";
export const ACTIVE_STATUSES = new Set(["ready", "in_progress", "in_review", "blocked"]);
const STATUSES = new Set([...ACTIVE_STATUSES, "integrated", "done", "cancelled"]);
const CHECKOUTS = new Set(["integration", "primary-transition", "worktree"]);
const REGISTRY_PATH = ".ai/registry.json";

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error?.code === "EPERM") {
    throw new Error("当前运行权限限制 Node 启动 Git。请直接执行 git status --short、git rev-parse main、git show main:.ai/registry.json 完成只读核对。");
  }
  if (result.error || result.status !== 0) {
    throw new Error(`无法读取 Git 上下文（${args[0]}）。请确认位于 Mathin 仓库，且 main 已包含协作入口。`);
  }
  return result.stdout;
}

function isRepoPath(value) {
  return typeof value === "string" && value.length > 0
    && !/[\\:*?<>|"\u0000-\u001f]/.test(value) && !value.startsWith("/")
    && !value.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..")
    && value.toLowerCase() !== ".git" && !value.toLowerCase().startsWith(".git/");
}

// 精确文件和以 / 结尾的目录；[locale] 按字面值匹配，不解释成 glob。
export function coversPath(scope, file) {
  const normalizedScope = scope.toLowerCase();
  const normalizedFile = file.toLowerCase();
  return normalizedScope === normalizedFile || (normalizedScope.endsWith("/") && normalizedFile.startsWith(normalizedScope));
}

export function scopeConflicts(tasks) {
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const conflicts = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i];
      const right = active[j];
      for (const [writer, other] of [[left, right], [right, left]]) {
        for (const owned of writer.writePaths) {
          for (const candidate of [...other.writePaths, ...other.sharedPaths]) {
            if (coversPath(owned, candidate) || coversPath(candidate, owned)) {
              conflicts.push(`${writer.id} 与 ${other.id} 的独占范围重叠：${owned} / ${candidate}`);
            }
          }
        }
      }
    }
  }
  return [...new Set(conflicts)];
}

export function validateRegistry(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.tasks)) throw new Error("任务登记表需要 version=1 和 tasks 数组。");
  const ids = new Set();
  for (const task of registry.tasks) {
    if (!task || typeof task.id !== "string" || !/^[A-Z0-9][A-Z0-9-]*$/.test(task.id) || ids.has(task.id)) throw new Error("任务 ID 无效或重复。");
    ids.add(task.id);
    if (!["title", "agent", "threadId", "branch", "next"].every((key) => typeof task[key] === "string" && task[key].trim())) {
      throw new Error(`${task.id} 缺少负责人、分支或任务说明。`);
    }
    if (!STATUSES.has(task.status) || !CHECKOUTS.has(task.checkout)) throw new Error(`${task.id} 的状态或 checkout 类型无效。`);
    if (!isRepoPath(task.card) || !task.card.startsWith(".ai/tasks/") || !task.card.endsWith(".md")) throw new Error(`${task.id} 的任务卡路径无效。`);
    for (const key of ["writePaths", "sharedPaths"]) {
      if (!Array.isArray(task[key]) || !task[key].every(isRepoPath)) throw new Error(`${task.id} 的 ${key} 需要仓库内精确路径或目录前缀。`);
    }
    if (task.checkpoint !== null && !/^[a-f0-9]{40}$/.test(task.checkpoint)) throw new Error(`${task.id} 的检查点需要完整提交号或 null。`);
    if (task.checkout === "worktree" && task.branch === "main") throw new Error(`${task.id} 的 worker 需要独立任务分支。`);
    if (task.checkout !== "worktree" && task.branch !== "main") throw new Error(`${task.id} 的主 checkout 分支应为 main。`);
  }
  const coordinator = registry.tasks.find((task) => task.id === registry.coordinatorTaskId);
  if (!coordinator || coordinator.checkout !== "integration") throw new Error("当前集成负责人必须引用 integration 任务。");
  if (registry.tasks.some((task) => ACTIVE_STATUSES.has(task.status) && task.checkout === "integration" && task !== coordinator)) {
    throw new Error("同一批次只能登记一名活跃集成人。");
  }
  const branches = registry.tasks.filter((task) => ACTIVE_STATUSES.has(task.status) && task.checkout === "worktree").map((task) => task.branch);
  if (new Set(branches).size !== branches.length) throw new Error("活跃 worktree 任务需要各自独立的分支。");
  const conflicts = scopeConflicts(registry.tasks);
  if (conflicts.length) throw new Error(conflicts.join("\n"));
  return registry;
}

export function parseChangedPaths(porcelain) {
  const entries = porcelain.split("\0");
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) files.push(entries[++i]);
  }
  return [...new Set(files.filter(Boolean))];
}

export function ownersForPath(file, tasks) {
  return tasks.filter((task) => ACTIVE_STATUSES.has(task.status)
    && [...task.writePaths, ...task.sharedPaths].some((scope) => coversPath(scope, file))).map((task) => task.id);
}

export function readContext(cwd = process.cwd(), { taskId, working = false } = {}) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).trim();
  const head = git(["rev-parse", "HEAD"], root).trim();
  const branch = git(["branch", "--show-current"], root).trim() || "detached HEAD";
  const integrationHead = git(["rev-parse", integrationRef], root).trim();
  const read = (file) => working ? fs.readFileSync(path.join(root, file), "utf8") : git(["show", `${integrationHead}:${file}`], root);
  const registry = validateRegistry(JSON.parse(read(REGISTRY_PATH)));
  // 链接也使用同一已捕获提交，避免 main 前进后混读两个版本。
  for (const task of registry.tasks) read(task.card);
  const selected = taskId ? registry.tasks.find((task) => task.id === taskId) : null;
  if (taskId && !selected) throw new Error(`未登记任务：${taskId}`);
  if (selected && ACTIVE_STATUSES.has(selected.status) && selected.branch !== branch) {
    throw new Error(`${selected.id} 分配给 ${selected.branch}，当前是 ${branch}；先进入正确任务 worktree。`);
  }
  if (selected?.checkout === "worktree" && ACTIVE_STATUSES.has(selected.status)) {
    const commonDir = path.resolve(root, git(["rev-parse", "--git-common-dir"], root).trim());
    if (path.resolve(root).toLowerCase() === path.dirname(commonDir).toLowerCase()) {
      throw new Error(`${selected.id} 需要独立 worktree；当前仍是主 checkout，仅切分支不足以隔离施工。`);
    }
  }
  const changes = parseChangedPaths(git(["status", "--porcelain=v1", "-z"], root));
  return { root, head, branch, integrationHead, registry, selected, changes, working };
}

function main() {
  const args = process.argv.slice(2);
  const taskIndex = args.indexOf("--task");
  const taskId = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
  const known = args.filter((_, index) => index !== taskIndex + 1 || taskIndex < 0);
  if (known.some((arg) => !["--check", "--task"].includes(arg)) || (taskIndex >= 0 && !taskId)) {
    throw new Error("用法：node scripts/agent-context.mjs [--task TASK-ID] [--check]；--check 检查当前工作副本。");
  }
  const { root, branch, head, integrationHead, registry, selected, changes, working } = readContext(process.cwd(), { taskId, working: args.includes("--check") });
  console.log(`工作目录：${root}\n当前分支：${branch}\n当前提交：${head}\n集成提交：${integrationHead}`);
  console.log(`登记来源：${working ? "当前工作副本（尚未代表 main 生效）" : "main 的已提交快照"}`);
  console.log(`当前集成人：${registry.coordinatorTaskId}`);
  for (const task of registry.tasks) {
    console.log(`- ${task.id} | ${task.status} | ${task.agent} | ${task.checkout} | ${task.branch} | ${task.title}`);
    console.log(`  任务卡：${task.card}；下一步：${task.next}`);
  }
  if (selected) console.log(`\n本任务独占范围：${selected.writePaths.join("、")}\n共享窗口：${selected.sharedPaths.join("、") || "无"}`);
  console.log("\n当前修改的登记归属：");
  for (const file of changes) console.log(`- ${file} → ${ownersForPath(file, registry.tasks).join("、") || "当前无活跃认领，先核对归属"}`);
  if (!changes.length) console.log("工作树干净。");
  const active = registry.tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  for (const file of new Set(active.flatMap((task) => task.sharedPaths))) {
    const owners = ownersForPath(file, active);
    if (owners.length > 1) console.log(`共享文件待串行协调：${file} → ${owners.join("、")}`);
  }
  const transitioning = active.filter((task) => task.checkout === "primary-transition");
  if (transitioning.length) console.log(`\n过渡中的主目录任务：${transitioning.map((task) => task.id).join("、")}；保留当前改动，到已提交检查点后切换独立 worktree。`);
  const adapterReady = [".claude/skills/mathin-verify/SKILL.md", ".agents/skills/verify/SKILL.md"].every((file) => fs.existsSync(path.join(root, file)));
  console.log(adapterReady
    ? "\nClaude 技能入口：.claude/skills/mathin-verify/SKILL.md → .agents/skills/verify/SKILL.md。"
    : "\n当前 checkout 的 Claude 共享技能入口不完整；请核对任务基线，先读取共享源。");
  console.log("此命令只读；归属检查不提供文件锁，也不代替产品验收或生产授权。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
