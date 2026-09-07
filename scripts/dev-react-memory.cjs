"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require 需要在 Next 启动前同步安装兼容处理。 */

// Next 16.2.11 内置 React 的异步调试表会经 owner.props -> Promise 反向保留请求。
// 只在 pnpm dev 的 worker 中停用这一项追踪；AsyncLocalStorage 和其他 async hook 照常工作。
// 开启完整异步调试可设置 MATHIN_DEV_REACT_ASYNC_DEBUG=1。依据和移除条件见内存 runbook。
if (
  process.env.NODE_ENV === "development" &&
  process.env.__NEXT_DEV_SERVER === "1" &&
  process.env.MATHIN_DEV_REACT_ASYNC_DEBUG !== "1" &&
  require("next/package.json").version === "16.2.11"
) {
  const asyncHooks = require("node:async_hooks");
  const createHook = asyncHooks.createHook;
  const functionSource = Function.prototype.toString;
  const state = { skippedHooks: 0 };
  globalThis[Symbol.for("mathin.dev.reactAsyncDebugGuard")] = state;

  asyncHooks.createHook = function (callbacks) {
    const hook = createHook.call(this, callbacks);
    if (
      typeof callbacks?.init === "function" &&
      typeof callbacks?.before === "function" &&
      typeof callbacks?.destroy === "function" &&
      functionSource.call(callbacks.init).includes("pendingOperations.set(") &&
      functionSource.call(callbacks.init).includes("new WeakRef(") &&
      functionSource.call(callbacks.before).includes("resolvePromiseOrAwaitNode(") &&
      functionSource.call(callbacks.destroy).includes("pendingOperations.delete(")
    ) {
      // 匹配锁定运行时的完整特征；返回原生 AsyncHook，仅保持此调试 hook 未启用。
      hook.enable = function () {
        return this;
      };
      state.skippedHooks += 1;
    }
    return hook;
  };
}
