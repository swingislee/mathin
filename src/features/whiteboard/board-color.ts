import { COLOR_TOKENS, type BoardColor, type HexColor } from "./types";

const tokens = new Set<string>(COLOR_TOKENS);

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
}

export function isBoardColor(value: unknown): value is BoardColor {
  return typeof value === "string" && (tokens.has(value) || isHexColor(value));
}

/** 输入框可接受三位简写；存储统一使用六位 HEX。 */
export function normalizeHexColor(value: string): HexColor | null {
  const hex = value.trim().toLowerCase();
  if (isHexColor(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`;
  return null;
}
