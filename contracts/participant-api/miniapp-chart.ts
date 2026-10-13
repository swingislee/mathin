import { localText, type ExperienceLocale, type ExperienceText } from "./miniapp-experience";

export type ChartPoint = { label: string; value: number; maximum: number; percent: number; valueLabel: string };
export type ContentChart = { points: ChartPoint[]; polygon: string; polyline: string; axes: { x: number; y: number; label: string }[]; dots: { x: number; y: number }[]; percentage: number };
/** Only explicit finite measurements are charted. Qualitative judgements never become invented scores. */
export function contentChart(value: unknown, locale: ExperienceLocale): ContentChart {
  const raw = Array.isArray(value) ? value : [];
  const points: ChartPoint[] = [];
  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { label?: string | ExperienceText; value?: unknown; maximum?: unknown };
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || typeof row.maximum !== "number" || !Number.isFinite(row.maximum) || row.maximum <= 0 || row.value < 0 || row.value > row.maximum) continue;
    const label = typeof row.label === "string" ? row.label : localText(row.label, locale);
    if (!label) continue;
    points.push({ label, value: row.value, maximum: row.maximum, percent: Math.round(row.value / row.maximum * 1000) / 10, valueLabel: `${row.value} / ${row.maximum}` });
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const axes = points.map((p, i) => { const angle = Math.PI * 2 * i / points.length - Math.PI / 2; return { x: round(150 + 108 * Math.cos(angle)), y: round(132 + 108 * Math.sin(angle)), label: p.label }; });
  const polygon = points.map((p, i) => { const angle = Math.PI * 2 * i / points.length - Math.PI / 2; return `${round(150 + 82 * p.percent / 100 * Math.cos(angle))},${round(132 + 82 * p.percent / 100 * Math.sin(angle))}`; }).join(" ");
  const dots = points.map((p, i) => ({ x: round(24 + i * 252 / Math.max(1, points.length - 1)), y: round(190 - p.percent * 1.5) }));
  return { points, axes, polygon, dots, polyline: dots.map(p => `${p.x},${p.y}`).join(" "), percentage: points[0]?.percent || 0 };
}
const escapeXml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function svgUri(svg: string): string {
  const bytes = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1) || 0, c = bytes.charCodeAt(i + 2) || 0;
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  return "data:image/svg+xml;base64," + encoded;
}
/** A local data URI gives native and web exactly the same chart geometry without a network service. */
export function contentChartSvg(chart: ContentChart, kind: "donut" | "radar" | "trend"): string {
  const color = "#6f8b48", line = "#d8d4cb";
  let body = "";
  if (kind === "donut") body = `<circle cx="150" cy="116" r="72" fill="none" stroke="${line}" stroke-width="18"/><circle cx="150" cy="116" r="72" fill="none" stroke="${color}" stroke-width="18" stroke-dasharray="${chart.percentage * 4.5239} 452.39" transform="rotate(-90 150 116)"/><text x="150" y="124" text-anchor="middle" fill="${color}" font-size="32">${chart.percentage}%</text>`;
  if (kind === "radar") body = [0.5, 1].map(scale => `<polygon points="${chart.axes.map(a => `${150 + (a.x - 150) * 82 / 108 * scale},${132 + (a.y - 132) * 82 / 108 * scale}`).join(" ")}" fill="none" stroke="${line}"/>`).join("") + chart.axes.map(a => `<line x1="150" y1="132" x2="${150 + (a.x - 150) * 82 / 108}" y2="${132 + (a.y - 132) * 82 / 108}" stroke="${line}"/>`).join("") + `<polygon points="${chart.polygon}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>` + chart.axes.map(a => `<text x="${a.x}" y="${a.y}" text-anchor="middle" dominant-baseline="middle" fill="#766f65" font-size="11">${escapeXml(a.label.slice(0, 8))}</text>`).join("");
  if (kind === "trend") body = [0, 50, 100].map(p => `<line x1="24" y1="${190 - p * 1.5}" x2="276" y2="${190 - p * 1.5}" stroke="${line}"/>`).join("") + `<polyline points="${chart.polyline}" fill="none" stroke="${color}" stroke-width="3"/>` + chart.dots.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}"/><text x="${p.x}" y="218" text-anchor="middle" fill="#766f65" font-size="10">${escapeXml(chart.points[i].label.slice(0, 8))}</text>`).join("");
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="260" viewBox="0 0 300 260">${body}</svg>`);
}
