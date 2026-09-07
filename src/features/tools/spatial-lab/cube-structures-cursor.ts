import type { CubeTool } from "./cube-structures-contract";

const cursorPaths: Record<CubeTool, string> = {
  orbit: "", select: '<path d="m5 3 15 10-7 1-3 7Z"/>',
  pan: '<path d="M12 2v22 M2 12h22 M8 6l4-4 4 4 M8 20l4 4 4-4 M6 8l-4 4 4 4 M20 8l4 4-4 4"/>',
  move: '<path d="M12 2v22 M2 12h22 M8 6l4-4 4 4 M8 20l4 4 4-4 M6 8l-4 4 4 4 M20 8l4 4-4 4"/>',
  build: '<path d="m12 3 8 5v9l-8 5-8-5V8Z M4 8l8 5 8-5 M12 13v9 M18 2v6 M15 5h6"/>',
  remove: '<path d="m4 15 9-11 8 7-9 11H8Z M8 11l8 7 M12 22h10"/>',
  color: '<path d="m6 3 12 12-8 7-8-8Z M4 11h13 M20 15q-5 6 0 7 5-1 0-7"/>',
  face: '<path d="m14 3 7 7-9 9-7-7Z M5 12q-5 3-3 9 6 2 10-2"/>',
  layer: '<path d="m12 3 10 6-10 6L2 9Z M2 14l10 6 10-6 M2 19l10 6 10-6"/>',
  cut: '<path d="m18 2 5 5-12 12-7 2 2-7Z M14 6l5 5 M2 25h24"/>',
  mark: '<path d="M8 16V12a6 6 0 1 1 8 0v4 M5 16h14v5H5Z M3 25h18"/>',
  number: '<text x="2" y="20" fill="#211e1a" stroke="none" font-size="18" font-family="sans-serif" font-weight="700">123</text>',
  transparent: '<path d="M12 2Q0 15 4 20a10 10 0 0 0 16 0Q24 15 12 2Z M7 16l3 4 M9 13l5 7 M12 10l5 7"/>',
};

export function cubeToolCursor(tool: CubeTool): string {
  if (tool === "orbit") return "grab";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="white" stroke="#211e1a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${cursorPaths[tool]}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 4, crosshair`;
}
