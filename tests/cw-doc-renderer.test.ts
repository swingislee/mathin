import { describe, expect, it } from "vitest";

import { createInteractionRuntime } from "../src/features/courseware-doc/interactions";
import { buildH5EntryUrl, injectBindingUrls } from "../src/features/courseware-doc/resolve";
import type { DocInteraction } from "../src/features/courseware-doc/schema";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("P6-4 binding resolution", () => {
  it("injects resolved binding URLs and keeps unresolved placeholders", () => {
    const html = `<img src="asset://binding/${KEY_A}"><img src="asset://binding/${KEY_B}">`;
    expect(injectBindingUrls(html, { [KEY_A]: "https://signed/a" })).toBe(
      `<img src="https://signed/a"><img src="asset://binding/${KEY_B}">`,
    );
  });

  it("reassembles the H5 launch query onto the shim entry URL", () => {
    expect(
      buildH5EntryUrl("f".repeat(64), "index.html", {
        query: { coursewareId: ["5518"], env: ["online", "backup"] },
        coursewareIdParam: "5518",
      }),
    ).toBe(`/api/cw-h5/packages/${"f".repeat(64)}/index.html?coursewareId=5518&env=online&env=backup`);
    expect(buildH5EntryUrl("f".repeat(64), "sub dir/main.htm", null)).toBe(
      `/api/cw-h5/packages/${"f".repeat(64)}/sub%20dir/main.htm`,
    );
  });
});

interface StubNode {
  dataset: { sourceResourceId: string };
  style: { display: string; transform: string };
  animate?: (frames: unknown, options: unknown) => { cancel: () => void; finished: Promise<void> };
}

function stubStage(nodes: StubNode[]) {
  return {
    querySelectorAll: () => nodes,
  } as unknown as ParentNode;
}

function interaction(overrides: Partial<DocInteraction>): DocInteraction {
  return {
    trigger: "auto",
    triggerScope: "auto",
    triggerResourceId: null,
    targetResourceId: "r1",
    action: "enter",
    animation: "fadeIn",
    delay: 0,
    duration: 0,
    loop: 0,
    path: null,
    audioBindingKey: null,
    audioName: null,
    step: 1,
    ...overrides,
  };
}

describe("P6-4 interaction runtime", () => {
  it("runAuto reveals auto enter targets but stops before click steps", async () => {
    const autoTarget: StubNode = { dataset: { sourceResourceId: "r1" }, style: { display: "none", transform: "translate(0px,0px)" } };
    const clickTarget: StubNode = { dataset: { sourceResourceId: "r2" }, style: { display: "none", transform: "translate(0px,0px)" } };
    const runtime = createInteractionRuntime({
      root: stubStage([autoTarget, clickTarget]),
      interactions: [
        interaction({ step: 1 }),
        interaction({ step: 2, trigger: "click", triggerScope: "page", targetResourceId: "r2" }),
      ],
      resolveAudioUrl: () => null,
    });
    await runtime.runAuto();
    expect(autoTarget.style.display).toBe("block");
    // enter 目标初始隐藏,click 步不得被 auto 连播提前执行——提前显示=答案泄露
    expect(clickTarget.style.display).toBe("none");
  });

  it("page-scope click advances one click step and exit hides the node", async () => {
    const target: StubNode = { dataset: { sourceResourceId: "r2" }, style: { display: "none", transform: "translate(0px,0px)" } };
    const runtime = createInteractionRuntime({
      root: stubStage([target]),
      interactions: [
        interaction({ step: 1, trigger: "click", triggerScope: "page", targetResourceId: "r2" }),
        interaction({ step: 2, trigger: "click", triggerScope: "page", targetResourceId: "r2", action: "exit" }),
      ],
      resolveAudioUrl: () => null,
    });
    await runtime.handleStageClick(null);
    expect(target.style.display).toBe("block");
    await runtime.handleStageClick(null);
    expect(target.style.display).toBe("none");
  });

  it("path interactions settle the node at the path end point", async () => {
    const target: StubNode = { dataset: { sourceResourceId: "r3" }, style: { display: "none", transform: "translate(10px,20px) rotate(0deg)" } };
    const runtime = createInteractionRuntime({
      root: stubStage([target]),
      interactions: [
        interaction({ step: 1, action: "path", targetResourceId: "r3", path: { type: "line", points: [300, 400] } }),
      ],
      resolveAudioUrl: () => null,
    });
    await runtime.runAuto();
    expect(target.style.display).toBe("block");
    expect(target.style.transform).toBe("translate(300px,400px) rotate(0deg)");
  });

  it("dispose cancels live animations and freezes further mutations", async () => {
    // fill:"both" 动画残留是换页整页位移事故的根源——dispose 必须 cancel
    let cancelled = 0;
    let finishAnimation!: () => void;
    const target: StubNode = {
      dataset: { sourceResourceId: "r1" },
      style: { display: "block", transform: "translate(0px,0px)" },
      animate: () => ({
        cancel: () => {
          cancelled += 1;
        },
        finished: new Promise<void>((resolve) => {
          finishAnimation = resolve;
        }),
      }),
    };
    const runtime = createInteractionRuntime({
      root: stubStage([target]),
      interactions: [interaction({ step: 1, action: "exit", duration: 1 })],
      resolveAudioUrl: () => null,
    });
    const running = runtime.runAuto();
    runtime.dispose();
    finishAnimation();
    await running;
    expect(cancelled).toBe(1);
    // dispose 后动画完成回调不得再改样式:exit 不得再把节点隐藏
    expect(target.style.display).toBe("block");
    // dispose 后调度器冻结,重新 runAuto 不再执行任何步骤
    await runtime.runAuto();
    expect(target.style.display).toBe("block");
  });
});
