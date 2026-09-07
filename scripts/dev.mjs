#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getParsedNodeOptions, formatNodeOptions } = require("next/dist/server/lib/utils");

// Next 16.2.11 从 NODE_OPTIONS 读取子进程堆预算；单独设置父进程参数会被默认值覆盖。
// 复用锁定版本的参数解析，保留调试、预加载和包含空格的路径，同时统一两种堆参数拼法。
const nodeOptions = getParsedNodeOptions();
nodeOptions["max-old-space-size"] = "4096";
delete nodeOptions.max_old_space_size;
process.env.NODE_OPTIONS = formatNodeOptions(nodeOptions).nodeOptions;

const nextBin = require.resolve("next/dist/bin/next");
process.argv = [process.execPath, nextBin, "dev", "--hostname", "0.0.0.0", "--port", "3130", ...process.argv.slice(2)];
require(nextBin);
