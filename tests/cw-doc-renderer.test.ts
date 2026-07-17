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
  animate?: undefined;
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
});
