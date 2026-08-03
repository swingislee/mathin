import katex from "katex";

function decodeMathSource(source: string) {
  return source
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

export function renderAixuexiMathHtml(html: string) {
  return html.replace(
    /<span\b([^>]*\bclass=(["'])[^"']*\bmath-tex\b[^"']*\2[^>]*)>([\s\S]*?)<\/span>/gi,
    (_match, attributes: string, _quote: string, source: string) => {
      let formula = decodeMathSource(source).trim();
      let displayMode = false;
      if (formula.startsWith("\\(") && formula.endsWith("\\)")) formula = formula.slice(2, -2);
      if (formula.startsWith("\\[") && formula.endsWith("\\]")) {
        formula = formula.slice(2, -2);
        displayMode = true;
      }
      if (!formula.trim()) return `<span${attributes}></span>`;
      return `<span${attributes} data-math-rendered="true">${katex.renderToString(formula, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
      })}</span>`;
    },
  );
}
