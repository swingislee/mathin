export const PALM_ERASER_VERSION = 1;
export const MAX_CONTACT_SIZE = 1024;

export interface ContactSize { width: number; height: number }
export interface PalmEraserProfile {
  version: 1;
  threshold: number;
  fingerSize: number;
  palmSize: number;
  screenKey: string;
}
export interface PalmEraserSettings { enabled: boolean; profile: PalmEraserProfile | null }
export const DEFAULT_PALM_ERASER_SETTINGS: PalmEraserSettings = { enabled: false, profile: null };

/** 面积按等面积正方形边长比较；分别采集单个触点，双指间距不参与掌擦识别。 */
export function contactSize({ width, height }: ContactSize): number {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 1 && height > 1 && width <= MAX_CONTACT_SIZE && height <= MAX_CONTACT_SIZE
    ? Math.sqrt(width * height) : 0;
}

export function isPalmContact(contact: ContactSize, threshold: number): boolean {
  return threshold > 2 && Number.isFinite(threshold) && contactSize(contact) >= threshold;
}

function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

export function calibratePalmEraser(finger: readonly ContactSize[], palm: readonly ContactSize[], screenKey: string):
  { profile: PalmEraserProfile; error: null } | { profile: null; error: "unavailable" | "indistinct" } {
  const fingerSizes = finger.map(contactSize).filter((size) => size > 0);
  const palmSizes = palm.map(contactSize).filter((size) => size > 0);
  if (!fingerSizes.length || !palmSizes.length) return { profile: null, error: "unavailable" };
  const fingerSize = quantile(fingerSizes, 0.9), palmSize = quantile(palmSizes, 0.25);
  if (palmSize < 6 || palmSize < fingerSize * 1.8) return { profile: null, error: "indistinct" };
  return { profile: { version: PALM_ERASER_VERSION, fingerSize, palmSize, screenKey,
    threshold: Math.max(fingerSize * 1.5, (fingerSize + palmSize) / 2) }, error: null };
}

export function parsePalmEraserSettings(value: unknown): PalmEraserSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_PALM_ERASER_SETTINGS;
  const settings = value as Record<string, unknown>, profile = settings.profile as Partial<PalmEraserProfile> | null;
  if (!profile || profile.version !== PALM_ERASER_VERSION || typeof profile.screenKey !== "string" || profile.screenKey.length > 128
    || ![profile.threshold, profile.fingerSize, profile.palmSize].every((n) => typeof n === "number" && Number.isFinite(n) && n > 1 && n <= MAX_CONTACT_SIZE)
    || profile.palmSize! < profile.fingerSize! * 1.8 || profile.threshold! <= profile.fingerSize! || profile.threshold! >= profile.palmSize!) return DEFAULT_PALM_ERASER_SETTINGS;
  return { enabled: settings.enabled === true, profile: profile as PalmEraserProfile };
}

/** 擦除直径随本次手掌大小取值并限幅；一次手势保持相同宽度。 */
export function palmEraserDiameter(contact: ContactSize): number {
  return Math.max(44, Math.min(220, Math.max(contact.width, contact.height) * 1.15));
}

export function currentPalmScreenKey(): string {
  return `${window.screen.width}x${window.screen.height}:${window.devicePixelRatio}`;
}
