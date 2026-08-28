import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("courseware document H5 presentation", () => {
  it("keeps the H5 host transparent so lower source layers remain visible", () => {
    const docStage = readFileSync(
      new URL("../src/features/courseware-doc/DocStage.tsx", import.meta.url),
      "utf8",
    );
    const h5Frame = docStage.slice(
      docStage.indexOf("function H5Frame"),
      docStage.indexOf("function nodeBody"),
    );

    expect(h5Frame).toContain('background: "transparent"');
    expect(h5Frame).not.toContain('background: "#fff"');
  });
});
