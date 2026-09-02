import { describe, expect, it } from "vitest";
import {
  coursewareTextFromHtml,
  coursewareTextValue,
} from "@/features/courseware-doc/courseware-text-value";
import type { DocNode } from "@/features/courseware-doc/schema";

function richTextNode(html: string): DocNode {
  return {
    id: "title",
    nodePath: "$.widgets[0]",
    sourceType: "widget-text",
    sourceResourceId: null,
    adapter: "rich_text",
    name: "文本1",
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 0,
    order: 0,
    crop: null,
    transform: {
      x: 0,
      y: 0,
      width: 796.823,
      height: 80,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
      clip: false,
    },
    style: {
      objectFit: "contain",
      backgroundColor: null,
      color: null,
      borderColor: null,
      borderWidth: 0,
      borderRadius: 0,
      fontFamily: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      whiteSpace: "normal",
      textAlign: null,
      overflow: "visible",
    },
    content: { kind: "rich_text", html, sanitized: true, sourceType: "widget-text" },
    resources: [],
    children: [],
  };
}

describe("shared courseware rich-text value", () => {
  it("ignores source HTML indentation and wrapper-only line breaks", () => {
    const node = richTextNode(`<div class="a0" style="width: 796.823px">
      <div style="font-size: 68px; text-align: center">10的认识</div>
    </div>`);

    expect(coursewareTextValue(node)).toBe("10的认识");
  });

  it("keeps semantic block and br line breaks without adding trailing lines", () => {
    expect(coursewareTextValue(richTextNode("<div>第一行</div>\n<div>第二行<br>第三行</div>")))
      .toBe("第一行\n第二行\n第三行");
  });

  it("keeps literal spacing between inline wrappers", () => {
    expect(coursewareTextValue(richTextNode("<span>Hello</span> <span>world</span>")))
      .toBe("Hello world");
  });

  it("decodes the source entities used by editable text", () => {
    expect(coursewareTextFromHtml("<div>1&nbsp;&lt;&nbsp;2 &amp;&amp; 3&#33;</div>"))
      .toBe("1 < 2 && 3!");
  });
});
