import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const probe = String.raw`
  const assert = require("node:assert/strict");
  const hooks = require("node:async_hooks");
  const originalCreateHook = hooks.createHook;
  require("./scripts/dev-react-memory.cjs");
  if (process.env.NODE_ENV !== "development" || process.env.__NEXT_DEV_SERVER !== "1" || process.env.MATHIN_DEV_REACT_ASYNC_DEBUG === "1") {
    assert.equal(hooks.createHook, originalCreateHook);
    console.log(JSON.stringify({ inactive: true }));
  } else {
    globalThis.AsyncLocalStorage = hooks.AsyncLocalStorage;
    // 加载实际锁定依赖；升级 Next 后由此检查提示复核兼容处理。
    require("next/dist/compiled/next-server/app-page-turbo.runtime.dev");
    const state = globalThis[Symbol.for("mathin.dev.reactAsyncDebugGuard")];
    assert.equal(state?.skippedHooks, 1);
    let unrelatedPromises = 0;
    const otherHook = hooks.createHook({ init(_id, type) { if (type === "PROMISE") unrelatedPromises++; } }).enable();
    const store = new hooks.AsyncLocalStorage();
    (async () => {
      const labels = ["first", "second", "third"];
      const values = await Promise.all(labels.map((label, index) => store.run(label, async () => {
        await new Promise(resolve => setTimeout(resolve, 3 - index));
        assert.equal(store.getStore(), label);
        await Promise.resolve();
        return store.getStore();
      })));
      assert.deepEqual(values, labels);
      assert.equal(store.getStore(), undefined);
      assert.ok(unrelatedPromises > 0);
      function ordinaryErrorFrame() { return new Error("local-guard-check").stack; }
      assert.match(ordinaryErrorFrame(), /ordinaryErrorFrame/);
      otherHook.disable();
      store.disable();
      console.log(JSON.stringify({ skippedHooks: state.skippedHooks, contexts: "isolated", otherHooks: "active", errorStack: "preserved" }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  }
`;

function runProbe(environment: Record<string, string> = {}) {
  return JSON.parse(execFileSync(process.execPath, ["-e", probe], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      NODE_ENV: "development",
      __NEXT_DEV_SERVER: "1",
      MATHIN_DEV_REACT_ASYNC_DEBUG: "0",
      ...environment,
    },
  }));
}

test("识别内置 React 调试 hook，同时保留并发上下文、其他 hook 和错误堆栈", () => {
  expect(runProbe()).toEqual({ skippedHooks: 1, contexts: "isolated", otherHooks: "active", errorStack: "preserved" });
});

const inactiveEnvironments: Record<string, string>[] = [
  { NODE_ENV: "production" },
  { __NEXT_DEV_SERVER: "0" },
  { MATHIN_DEV_REACT_ASYNC_DEBUG: "1" },
];

test.each(inactiveEnvironments)("开发 worker 之外或主动开启完整调试时保持原生 hook：%j", (environment) => {
  expect(runProbe(environment)).toEqual({ inactive: true });
});
