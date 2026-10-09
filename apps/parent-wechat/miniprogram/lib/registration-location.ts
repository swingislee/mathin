import type { RegistrationLocation } from "./onboarding-form";

/** Called only by a validated form submission. The page retains its result for retries. */
export function registrationLocation(): Promise<RegistrationLocation> {
  return new Promise<RegistrationLocation>(resolve => {
    let settled = false;
    const finish = (value: RegistrationLocation) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(value);
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
}
