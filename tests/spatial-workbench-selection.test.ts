// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let sheet: HTMLStyleElement, workspace: HTMLElement;
beforeEach(() => {
  sheet = document.createElement("style");
  sheet.textContent = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.module.css", "utf8");
  document.head.append(sheet);
  workspace = document.createElement("section"); workspace.className = "workspace"; document.body.append(workspace);
});
afterEach(() => { sheet.remove(); workspace.remove(); });

describe("shared spatial workbench text-selection boundary", () => {
  it("disables native text selection at the shared stage boundary without changing pointer handling", () => {
    const style = getComputedStyle(workspace);
    expect(style.userSelect).toBe("none");
    expect(sheet.textContent).toContain("-webkit-user-select: none");
    expect(style.pointerEvents).not.toBe("none");
    // 浏览器手势与 CSS 继承由人工验收；此处只守住共同样式及输入例外。
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });
  it.each(["input", "textarea"])("keeps %s text selectable and editable", (tag) => {
    const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
    field.value = "teaching"; workspace.append(field);
    expect(getComputedStyle(field).userSelect).toBe("text");
    field.focus(); field.setSelectionRange(1, 4);
    expect(document.activeElement).toBe(field); expect(field.selectionStart).toBe(1); expect(field.selectionEnd).toBe(4);
  });
  it.each(["true", "", "plaintext-only"])("keeps contenteditable=%s selectable", (value) => {
    const editor = document.createElement("div"); editor.setAttribute("contenteditable", value); workspace.append(editor);
    expect(getComputedStyle(editor).userSelect).toBe("text");
    editor.setAttribute("contenteditable", "false"); expect(getComputedStyle(editor).userSelect).not.toBe("text");
  });
});
