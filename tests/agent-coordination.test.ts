import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coversPath, ownersForPath, parseChangedPaths, readContext, validateRegistry } from "../scripts/agent-context.mjs";

function task(id: string, overrides = {}) {
  return {
    id, title: id, agent: "codex", threadId: "fixture-thread", status: "in_progress",
    checkout: id === "A" ? "integration" : "primary-transition", branch: "main", card: `.ai/tasks/${id}.md`,
    writePaths: [`src/${id}/`], sharedPaths: [], checkpoint: null, next: "继续已分配任务",
    ...overrides,
  };
}

describe("协作登记与归属", () => {
  it("Claude 可在没有 Codex 会话 ID 时按任务 ID 接入", () => {
    const registry = { version: 1, coordinatorTaskId: "A", tasks: [task("A", { agent: "claude", threadId: null })] };
    expect(() => validateRegistry(registry)).not.toThrow();
    expect(() => validateRegistry({ ...registry, tasks: [task("A", { threadId: 42 })] })).toThrow("会话 ID");
  });

  it("按目录边界和 Windows 大小写匹配，把 locale 当字面路径", () => {
    expect(coversPath("src/app/[locale]/", "SRC/app/[locale]/page.tsx")).toBe(true);
    expect(coversPath("src/app/[locale]/", "src/app/zh/page.tsx")).toBe(false);
    expect(coversPath("src/tool/", "src/toolbox/a.ts")).toBe(false);
    expect(coversPath("README.md", "README.md.backup")).toBe(false);
  });

  it("拒绝活跃任务的独占范围交叠，包括目录与共享子文件", () => {
    const tasks = [task("A", { writePaths: ["src/tools/"] }), task("B", { sharedPaths: ["src/tools/a.ts"] })];
    expect(() => validateRegistry({ version: 1, coordinatorTaskId: "A", tasks })).toThrow("独占范围重叠");
    tasks[1].status = "integrated";
    expect(() => validateRegistry({ version: 1, coordinatorTaskId: "A", tasks })).not.toThrow();
    expect(ownersForPath("src/tools/a.ts", tasks)).toEqual(["A"]);
  });

  it("允许登记需串行协调的共享文件，并显示所有活跃使用者", () => {
    const tasks = [task("A", { sharedPaths: ["CHANGELOG.md"] }), task("B", { sharedPaths: ["CHANGELOG.md"] })];
    expect(() => validateRegistry({ version: 1, coordinatorTaskId: "A", tasks })).not.toThrow();
    expect(ownersForPath("CHANGELOG.md", tasks)).toEqual(["A", "B"]);
    expect(ownersForPath("unclaimed.md", tasks)).toEqual([]);
  });

  it("拒绝重复任务、越界路径和不存在的协调任务", () => {
    const registry = { version: 1, coordinatorTaskId: "A", tasks: [task("A")] };
    expect(() => validateRegistry({ ...registry, tasks: [task("A"), task("A")] })).toThrow("重复");
    for (const invalid of ["../private", "C:/private", "/tmp/private", "src/../private", "src/*.ts", ".git/config", ".git", "src//hidden/"]) {
      expect(() => validateRegistry({ ...registry, tasks: [task("A", { writePaths: [invalid] })] })).toThrow("精确路径");
    }
    expect(() => validateRegistry({ ...registry, coordinatorTaskId: "MISSING" })).toThrow("协调任务");
  });

  it("工作区记录用于核对归属，允许按当前任务选择本地或独立分支", () => {
    const registry = { version: 1, coordinatorTaskId: "A", tasks: [task("A"), task("B", { checkout: "integration" })] };
    expect(() => validateRegistry(registry)).not.toThrow();
    registry.tasks = [task("A"), ...["B", "C"].map((id) => task(id, { checkout: "worktree", branch: "codex/shared" }))];
    expect(() => validateRegistry(registry)).not.toThrow();
    expect(() => validateRegistry({ ...registry, coordinatorTaskId: null, tasks: [task("A", { checkout: "local", branch: "codex/local-work" })] })).not.toThrow();
  });

  it("重命名归属覆盖新旧路径，保留空格和未跟踪路径", () => {
    expect(parseChangedPaths("R  src/new name.ts\0src/old name.ts\0 M src/a.ts\0?? .ai/new.md\0"))
      .toEqual(["src/new name.ts", "src/old name.ts", "src/a.ts", ".ai/new.md"]);
  });
});

describe("跨 worktree 的已提交登记", () => {
  it("从最新 main 的同一提交读取状态，保留 worker 文件、分支和 index", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-agent-coordination-"));
    const primary = path.join(fixture, "primary");
    const worker = path.join(fixture, "worker");
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
    const write = (root: string, file: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content, "utf8");
    };
    const commit = (message: string) => {
      git(primary, "add", ".ai");
      git(primary, "-c", "user.name=Coordination Fixture", "-c", "user.email=coordination@example.invalid", "commit", "-qm", message);
    };
    try {
      git(fixture, "init", "-q", "--initial-branch=main", primary);
      const registry = { version: 1, coordinatorTaskId: "A", tasks: [task("A"), task("B", { checkout: "worktree", branch: "codex/fixture" })] };
      write(primary, ".ai/registry.json", JSON.stringify(registry));
      for (const item of registry.tasks) write(primary, item.card, `# ${item.id}`);
      commit("fixture base");
      const base = git(primary, "rev-parse", "HEAD");
      git(primary, "worktree", "add", "-q", "-b", "codex/fixture", worker, base);
      registry.tasks[1].next = "最新已提交交接";
      write(primary, ".ai/registry.json", JSON.stringify(registry));
      commit("fixture main update");
      const integrationHead = git(primary, "rev-parse", "HEAD");
      write(worker, ".ai/tasks/B.md", "本地尚未提交的记录");
      const before = git(worker, "status", "--porcelain=v1");
      const context = readContext(worker, { taskId: "B" });
      expect(context.selected.next).toBe("最新已提交交接");
      expect(context.head).toBe(base);
      expect(context.integrationHead).toBe(integrationHead);
      expect(context.changes).toContain(".ai/tasks/B.md");
      expect(git(worker, "status", "--porcelain=v1")).toBe(before);
      expect(git(worker, "rev-parse", "HEAD")).toBe(base);
      expect(fs.readFileSync(path.join(worker, ".ai/tasks/B.md"), "utf8")).toBe("本地尚未提交的记录");
      expect(readContext(primary, { taskId: "B" }).selected.branch).toBe("codex/fixture");
      expect(() => readContext(worker, { taskId: "MISSING" })).toThrow("未登记任务");
      expect(readContext(worker, { working: true }).registry.tasks[1].next).toBe("继续已分配任务");
      registry.tasks[1].card = ".ai/tasks/missing.md";
      write(primary, ".ai/registry.json", JSON.stringify(registry));
      commit("fixture missing card");
      expect(() => readContext(worker)).toThrow("无法读取 Git 上下文");
      registry.tasks[1].card = ".ai/tasks/B.md";
      registry.tasks[1].branch = "codex/primary-only";
      write(primary, ".ai/registry.json", JSON.stringify(registry));
      commit("fixture primary branch");
      git(primary, "switch", "-qc", "codex/primary-only");
      expect(readContext(primary, { taskId: "B" }).selected.branch).toBe("codex/primary-only");
    } finally {
      // 只清理由本测试生成且仍位于系统临时目录的 fixture。
      const resolved = path.resolve(fixture);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("mathin-agent-coordination-")) {
        throw new Error("临时 fixture 路径不符合清理边界。");
      }
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
});
