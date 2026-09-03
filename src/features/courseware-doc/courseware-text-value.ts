import type { DocNode } from "./schema";

const COURSEWARE_TEXT_BLOCK_TAG = /^(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)$/i;

function decodeHtmlText(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "nbsp") return " ";
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const codePoint = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

/**
 * Read the logical copy from imported rich HTML without leaking pretty-print
 * indentation into the textarea. Block tags create separators only when more
 * visible text follows, so wrapper closing tags do not invent trailing lines.
 */
export function coursewareTextFromHtml(html: string) {
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? [];
  let value = "";
  let pendingBlockBreak = false;

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("<")) {
      const tag = token.match(/^<\s*\/?\s*([a-z0-9-]+)/i)?.[1] ?? "";
      if (/^<\s*br\b/i.test(token)) {
        if (!value.endsWith("\n")) value += "\n";
        pendingBlockBreak = false;
      } else if (COURSEWARE_TEXT_BLOCK_TAG.test(tag)) {
        pendingBlockBreak = value.length > 0;
      }
      continue;
    }

    let text = decodeHtmlText(token).replace(/\r\n?/g, "\n");
    if (/^[\t\n\f ]*$/.test(text)) {
      if (!text.includes("\n") && value && !pendingBlockBreak && !/[ \n]$/.test(value)) value += " ";
      continue;
    }
    // Source HTML is pretty-printed. Whitespace around a physical source line
    // is formatting, while newlines inside the actual text remain untouched.
    text = text
      .replace(/^[\t ]*\n[\t ]*/, "")
      .replace(/[\t ]*\n[\t ]*$/, "");
    if (!text) continue;
    if (pendingBlockBreak && value && !value.endsWith("\n")) value += "\n";
    pendingBlockBreak = false;
    value += text;
  }

  return value;
}

export function isCoursewareTextElement(node: DocNode | null | undefined): boolean {
  return node?.content?.kind === "text" || node?.content?.kind === "rich_text";
}

export function coursewareTextValue(node: DocNode) {
  if (node.content?.kind === "text") return node.content.text ?? "";
  if (node.content?.kind !== "rich_text") return "";
  return coursewareTextFromHtml(node.content.html ?? "");
}

/** Replace visible copy while preserving the imported rich-text wrapper and its typography. */
export function setCoursewareTextValue(node: DocNode, value: string) {
  if (node.content?.kind === "text") {
    node.content.text = value;
    return;
  }
  if (node.content?.kind !== "rich_text") return;
  if (typeof document === "undefined") {
    node.content.html = value;
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = node.content.html ?? "";
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.textContent?.trim()) textNodes.push(current as Text);
  }
  if (textNodes[0]) {
    textNodes[0].textContent = value;
    textNodes.slice(1).forEach((textNode) => { textNode.textContent = ""; });
  } else {
    const span = document.createElement("span");
    span.textContent = value;
    template.content.append(span);
  }
  node.content.html = template.innerHTML;
}
