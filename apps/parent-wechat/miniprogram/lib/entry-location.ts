import type { RegistrationLocation } from "./onboarding-form";

type Entry = { scene: string; result: Promise<RegistrationLocation> };
let current: Entry | null = null;

export function promotionScene(value: string | undefined): string {
  try { const decoded = decodeURIComponent(value || ""); return /^[a-f0-9]{24}$/.test(decoded) ? decoded : ""; }
  catch { return ""; }
}

/** A single foreground sample for this entry. Coordinates never enter persistent storage. */
export function beginEntryLocation(scene: string): Promise<RegistrationLocation> {
  const enteredAt = new Date().toISOString();
  const result = new Promise<RegistrationLocation>(resolve => {
    let settled = false;
    const finish = (value: RegistrationLocation) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve({ ...value, enteredAt });
    };
    const timer = setTimeout(() => finish({ status: "unavailable" }), 15000);
    void (async () => {
      try {
        const settings = await wx.getSetting({});
        if (settled) return;
        if (settings.authSetting["scope.userLocation"] === false) { finish({ status: "declined" }); return; }
        if (typeof wx.requirePrivacyAuthorize === "function") await wx.requirePrivacyAuthorize({});
        if (settled) return;
        const value = await wx.getLocation({ type: "gcj02" });
        finish({ status: "granted", latitude: value.latitude, longitude: value.longitude,
          accuracy: Number.isFinite(value.accuracy) ? value.accuracy : null, capturedAt: new Date().toISOString() });
      } catch (error) {
        const message = typeof error === "object" && error !== null && "errMsg" in error ? String(error.errMsg) : "";
        finish({ status: /deny|denied|cancel|authorize/.test(message) ? "declined" : "unavailable" });
      }
    })();
  });
  current = { scene, result };
  return result;
}

export function entryLocation(scene = "") { return current?.scene === scene ? current.result : beginEntryLocation(scene); }
export function clearEntryLocation() { current = null; }
