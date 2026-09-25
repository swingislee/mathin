import { expect, it } from "vitest";
import { aixuexiRuntimeFileUrl } from "@/features/courseware-doc/aixuexi-runtime";

it("resolves source stylesheets without browser globals during server rendering", () => {
  expect(typeof window).toBe("undefined");
  expect(aixuexiRuntimeFileUrl("/api/courseware/runtime/package/index.html?token=fixture", "styles/题目 样式.css"))
    .toBe("/api/courseware/runtime/package/styles/%E9%A2%98%E7%9B%AE%20%E6%A0%B7%E5%BC%8F.css");
  expect(aixuexiRuntimeFileUrl("https://example.invalid/api/courseware/runtime/package/index.html", "scripts/player.js"))
    .toBe("/api/courseware/runtime/package/scripts/player.js");
});
