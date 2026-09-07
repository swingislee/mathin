#!/usr/bin/env node

import { createRequire } from "node:module";
import childProcess from "node:child_process";

const require = createRequire(import.meta.url);
const { getParsedNodeOptions, formatNodeOptions } = require("next/dist/server/lib/utils");

// Next 16.2.11 从 NODE_OPTIONS 读取子进程堆预算；单独设置父进程参数会被默认值覆盖。
// 复用锁定版本的参数解析，保留调试、预加载和包含空格的路径，同时统一两种堆参数拼法。
const nodeOptions = getParsedNodeOptions();
nodeOptions["max-old-space-size"] = "4096";
delete nodeOptions.max_old_space_size;
process.env.NODE_OPTIONS = formatNodeOptions(nodeOptions).nodeOptions;

// 仅为 Next 开发 worker 预加载兼容处理；命令行参数独立追加，保留已有 NODE_OPTIONS 预加载项。
const nextWorker = require.resolve("next/dist/server/lib/start-server");
const memoryGuard = require.resolve("./dev-react-memory.cjs");
const fork = childProcess.fork;
childProcess.fork = function (modulePath, ...args) {
  const optionsIndex = Array.isArray(args[0]) ? 1 : 0;
  const options = args[optionsIndex];
  if (modulePath === nextWorker && options?.env?.__NEXT_DEV_SERVER === "1") {
    args[optionsIndex] = { ...options, execArgv: [...(options.execArgv ?? process.execArgv), "--require", memoryGuard] };
  }
  return fork.call(this, modulePath, ...args);
};

const nextBin = require.resolve("next/dist/bin/next");
process.argv = [process.execPath, nextBin, "dev", "--hostname", "0.0.0.0", "--port", "3130", ...process.argv.slice(2)];
require(nextBin);
