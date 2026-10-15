import type { RuntimeChartKind } from "../../../../contracts/participant-api/runtime";

export const chartColors = ["#6f8b48", "#d6b45a", "#7a8fb0"];
const width = 320, height = 220, ink = "#766f65", grid = "#e4e0d4";
const round = (value: number) => Math.round(value * 10) / 10;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const label = (x: number, y: number, text: string, anchor = "middle", size = 11) =>
  `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" dominant-baseline="middle" fill="${ink}" font-size="${size}">${escape(text.slice(0, 8))}</text>`;

/** Draws a chart as SVG so every client shows the same picture, and new chart kinds need only a server change. */
export function chartImage(kind: RuntimeChartKind, labels: string[], series: { name: string; values: number[] }[], max: number): { image: string; ratio: number } {
  const rows = series.filter(row => row.values.some(Number.isFinite)).slice(0, 3);
  const top = max > 0 ? max : Math.max(1, ...rows.flatMap(row => row.values.filter(Number.isFinite)));
  const share = (value: number) => Math.max(0, Math.min(1, (Number.isFinite(value) ? value : 0) / top));
  let body = "";
  if (kind === "ring") {
    const cx = width / 2, cy = 104, r = 72, length = 2 * Math.PI * r, values = rows[0]?.values ?? [];
    body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${grid}" stroke-width="20"/>`;
    if (values.length <= 1) {
      const part = share(values[0] ?? 0);
      body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${chartColors[0]}" stroke-width="20" stroke-linecap="round" stroke-dasharray="${round(part * length)} ${round(length)}" transform="rotate(-90 ${cx} ${cy})"/>`
        + `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${chartColors[0]}" font-size="30">${Math.round(part * 100)}%</text>`;
    } else {
      const total = values.reduce((sum, value) => sum + Math.max(0, value || 0), 0) || 1;
      let start = 0;
      values.forEach((value, index) => {
        const part = Math.max(0, value || 0) / total;
        body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${segment(index)}" stroke-width="20" stroke-dasharray="${round(part * length)} ${round(length)}" stroke-dashoffset="${round(-start * length)}" transform="rotate(-90 ${cx} ${cy})"/>`;
        start += part;
      });
      body += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${ink}" font-size="24">${escape(String(Math.round(total)))}</text>`;
    }
  } else if (kind === "radar") {
    const cx = width / 2, cy = 112, r = 78, n = Math.max(3, labels.length);
    const point = (index: number, scale: number) => { const angle = Math.PI * 2 * index / n - Math.PI / 2; return [cx + r * scale * Math.cos(angle), cy + r * scale * Math.sin(angle)]; };
    for (const scale of [0.33, 0.66, 1]) body += `<polygon points="${Array.from({ length: n }, (_, i) => point(i, scale).map(round).join(",")).join(" ")}" fill="none" stroke="${grid}"/>`;
    for (let i = 0; i < n; i++) { const [x, y] = point(i, 1), [lx, ly] = point(i, 1.22); body += `<line x1="${cx}" y1="${cy}" x2="${round(x)}" y2="${round(y)}" stroke="${grid}"/>` + label(lx, ly, labels[i] ?? ""); }
    rows.forEach((row, index) => {
      const points = Array.from({ length: n }, (_, i) => point(i, share(row.values[i] ?? 0)).map(round).join(",")).join(" ");
      body += `<polygon points="${points}" fill="${chartColors[index]}" fill-opacity="${index ? 0.12 : 0.22}" stroke="${chartColors[index]}" stroke-width="2"${index ? ' stroke-dasharray="5 4"' : ""}/>`;
    });
  } else {
    const left = 34, right = width - 12, base = height - 30, span = base - 14, n = Math.max(1, labels.length), step = (right - left) / n;
    for (const part of [0, 0.5, 1]) body += `<line x1="${left}" y1="${round(base - part * span)}" x2="${right}" y2="${round(base - part * span)}" stroke="${grid}"/>`
      + label(left - 6, base - part * span, String(round(top * part)), "end", 10);
    labels.forEach((text, i) => { body += label(left + step * (i + 0.5), base + 16, text); });
    if (kind === "bar") {
      const groups = Math.max(1, rows.length), barWidth = Math.min(22, step * 0.7 / groups);
      rows.forEach((row, index) => labels.forEach((_, i) => {
        const h = share(row.values[i] ?? 0) * span, x = left + step * (i + 0.5) - barWidth * groups / 2 + barWidth * index;
        body += `<rect x="${round(x)}" y="${round(base - h)}" width="${round(barWidth - 2)}" height="${round(h)}" rx="3" fill="${chartColors[index]}"/>`;
      }));
    } else rows.forEach((row, index) => {
      const points = labels.map((_, i) => [left + step * (i + 0.5), base - share(row.values[i] ?? 0) * span]);
      body += `<polyline points="${points.map(p => p.map(round).join(",")).join(" ")}" fill="none" stroke="${chartColors[index]}" stroke-width="2.5"${index ? ' stroke-dasharray="5 4"' : ""}/>`
        + points.map(([x, y]) => `<circle cx="${round(x)}" cy="${round(y)}" r="3.5" fill="${chartColors[index]}"/>`).join("");
    });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return { image: "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64"), ratio: height / width };
}
const segmentColors = ["#6f8b48", "#d6b45a", "#7a8fb0", "#c98b7a", "#9a86b8", "#8fb3a6", "#b7a46a", "#a8a39a"];
export const segment = (index: number) => segmentColors[index % segmentColors.length];
