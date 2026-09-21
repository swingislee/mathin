import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const projectRoot = path.join(repositoryRoot, "apps", "parent-wechat");
const actions = {
  status: ["check_wechatide_status"],
  open: ["open_project_window", "--window-mode", "liteMode"],
  "open-full": ["open_project_window", "--window-mode", "fullMode"],
  compile: ["simulator_refresh"],
  logs: ["get_simulator_console", "--command", "grep -n ."],
  network: ["get_simulator_network", "--command", "grep -n ."],
  info: ["automation_runtime_info", "--action", "currentPage"],
};

function findCli() {
  const explicit = process.env.WECHATIDE_CLI;
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        ...(process.platform === "win32"
          ? [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
              .filter(Boolean)
              .map((root) => path.join(root, "Tencent", "微信web开发者工具", "wechatide.cmd"))
          : ["/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide"]),
        ...(process.env.PATH ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((root) => path.join(root, process.platform === "win32" ? "wechatide.cmd" : "wechatide")),
      ];
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (!cli) {
    throw new Error("未找到 wechatide。安装微信开发者工具，或用 WECHATIDE_CLI 指定官方 CLI 完整路径。");
  }
  return cli;
}

function installedSkillVersion() {
  const candidates = [
    path.join(repositoryRoot, ".agents", "skills", "wechatide-skill", "SKILL.md"),
    path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "skills", "wechatide-skill", "SKILL.md"),
    path.join(homedir(), ".agents", "skills", "wechatide-skill", "SKILL.md"),
  ];
  const skill = candidates.find((candidate) => existsSync(candidate));
  const version = skill && readFileSync(skill, "utf8").match(/^version:\s*([\d.]+)\s*$/m)?.[1];
  if (!version) {
    throw new Error("请先将开发者工具随附的完整 wechatide-skill 安装到 Codex 技能目录，再检查版本状态。");
  }
  return version;
}

function main() {
  const [action = "help", ...extra] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(action)) {
    console.log("用法：corepack pnpm parents:wechat <status|open|open-full|compile|logs|network|info>");
    console.log("status 检查登录与 Skill 版本；open 打开模拟器；open-full 打开完整窗口。");
    console.log("compile 触发编译刷新；logs / network / info 读取当前项目的诊断信息。");
    return;
  }
  if (!Object.hasOwn(actions, action) || extra.length) {
    throw new Error("参数无效。运行 corepack pnpm parents:wechat help 查看支持的命令。");
  }
  const cli = findCli();
  const args = ["-c", "Codex", ...actions[action]];
  if (action === "status") {
    args.push("--skill-version", installedSkillVersion());
  } else {
    args.push("--project", projectRoot);
  }
  if (process.env.MATHIN_WECHATIDE_TOKEN) {
    args.push("--token", process.env.MATHIN_WECHATIDE_TOKEN);
  }

  // 用固定 PowerShell 程序和环境参数传值，保留中文、空格与参数边界。
  const windowsCommand = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$wechatArguments = @(ConvertFrom-Json -InputObject $env:MATHIN_WECHATIDE_ARGUMENTS)",
    "& $env:MATHIN_WECHATIDE_COMMAND @wechatArguments",
    "exit $LASTEXITCODE",
  ].join("\n");
  const result = spawnSync(
    process.platform === "win32" ? "powershell.exe" : cli,
    process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", Buffer.from(windowsCommand, "utf16le").toString("base64")]
      : args,
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        MATHIN_WECHATIDE_COMMAND: cli,
        MATHIN_WECHATIDE_ARGUMENTS: JSON.stringify(args),
      },
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;

  // 官方 CLI 的业务错误可能仍以 0 退出；将结构化失败和待确认状态传给调用方。
  const jsonStart = result.stdout?.search(/^\{\s*$/m) ?? -1;
  const payload = jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : null;
  const failed = payload?.ok === false || payload?.result?.success === false;
  const pending = payload?.result?.status === "pending";
  const notReady = action === "status" && payload?.result?.success === true && (
    payload.result.loginExpired !== false
    || !["equal", "agent_ahead"].includes(payload.result.versionRelation)
    || (payload.result.tokenRequired === true && !process.env.MATHIN_WECHATIDE_TOKEN)
  );
  process.exitCode = result.status || (failed || !payload ? 1 : pending || notReady ? 2 : 0);
  if (action === "compile" && process.exitCode === 0) {
    console.log("已触发编译刷新；请结合 logs / info 检查运行结果，并在模拟器中验收页面。");
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
