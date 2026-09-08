import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// 在 Node 中执行舞台实际使用的回调，验证消息时序；浏览器中的翻页手感由人工验收。
const source = ts.createSourceFile("SourceRuntimeStage.tsx", readFileSync(
  new URL("../src/features/courseware-doc/SourceRuntimeStage.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, scope: Record<string, unknown>) {
  let body: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      body = node.initializer.arguments[0]?.getText(source);
    }
    if (name === "mediaEffect" && ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
        && node.arguments[0]?.getText(source).includes('type: "media_ctl"')) {
      body = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(body, `${name} callback`).toBeDefined();
  const code = ts.transpile(`const run = ${body};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(scope), `${code}; return run;`)(...Object.values(scope));
}

describe("source runtime retained across classroom page turns", () => {
  it("cancels a queued middle page when the teacher returns to the in-flight page", () => {
    const postMessage = vi.fn();
    const refs = {
      runtimeReadyFor: { current: "runtime" },
      runtimeLoadedFor: { current: "runtime" },
      runtimeInstanceKey: "runtime",
      runtimeInFlightFor: { current: null as string | null },
      runtimeQueuedRender: { current: null },
      runtimePayloadSentFor: { current: null },
      iframeRef: { current: { contentWindow: { postMessage } } },
    };
    const flushRuntimeRender = callback("flushRuntimeRender", refs);
    const queue = callback("queueRuntimeRender", { ...refs, flushRuntimeRender });
    queue("a", { page: "a" });
    queue("b", { page: "b" });
    queue("a", { page: "a" });
    refs.runtimeInFlightFor.current = null;
    flushRuntimeRender();
    expect(postMessage.mock.calls).toEqual([[{ page: "a" }, "*"]]);
    queue("c", { page: "c" });
    expect(postMessage.mock.calls).toEqual([[{ page: "a" }, "*"], [{ page: "c" }, "*"]]);
  });

  it("coalesces forward jumps and renders only the latest queued page after acknowledgement", () => {
    const postMessage = vi.fn();
    const refs = {
      runtimeReadyFor: { current: "runtime" },
      runtimeLoadedFor: { current: null },
      runtimeInstanceKey: "runtime",
      runtimeInFlightFor: { current: null as string | null },
      runtimeQueuedRender: { current: null },
      runtimePayloadSentFor: { current: null },
      iframeRef: { current: { contentWindow: { postMessage } } },
    };
    const flushRuntimeRender = callback("flushRuntimeRender", refs);
    const queue = callback("queueRuntimeRender", { ...refs, flushRuntimeRender });
    queue("a", { page: "a" });
    queue("b", { page: "b" });
    queue("c", { page: "c" });
    expect(postMessage).toHaveBeenCalledTimes(1);
    refs.runtimeInFlightFor.current = null;
    flushRuntimeRender();
    expect(postMessage.mock.calls).toEqual([[{ page: "a" }, "*"], [{ page: "c" }, "*"]]);
  });

  it("waits for the selected page before replaying media and reapplies it on a return visit", () => {
    const postMessage = vi.fn();
    const ctl = { action: "pause", time: 12 };
    const scope = {
      videoControl: { controller: false, ctl: ctl as typeof ctl | undefined },
      rendered: false,
      frameGeneration: 1,
      renderKey: "page-a",
      appliedCtl: { current: null },
      iframeRef: { current: { contentWindow: { postMessage } } },
    };
    const run = () => callback("mediaEffect", scope)();
    run();
    expect(postMessage).not.toHaveBeenCalled();
    scope.rendered = true;
    run();
    run();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenLastCalledWith({ source: "mathin-classroom", type: "media_ctl", action: "pause", time: 12 }, "*");

    scope.renderKey = "page-b";
    scope.rendered = false;
    scope.videoControl.ctl = undefined;
    run();
    scope.rendered = true;
    run();
    scope.renderKey = "page-a";
    scope.videoControl.ctl = ctl;
    run();
    expect(postMessage).toHaveBeenCalledTimes(2);
    scope.videoControl.controller = true;
    scope.videoControl.ctl = { action: "play", time: 20 };
    run();
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
});
