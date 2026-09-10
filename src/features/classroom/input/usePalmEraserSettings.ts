"use client";

import { useCallback, useEffect, useState } from "react";
import { currentPalmScreenKey, DEFAULT_PALM_ERASER_SETTINGS, parsePalmEraserSettings, type PalmEraserSettings } from "./palm-eraser";

/** 本浏览器按教师保存校准；屏幕设置变化后重新校准，识别数据不进入课堂事件。 */
export function usePalmEraserSettings(scope: string) {
  const [settings, setSettings] = useState<PalmEraserSettings>(DEFAULT_PALM_ERASER_SETTINGS);
  const [screenKey, setScreenKey] = useState("");
  const [sessionOnly, setSessionOnly] = useState(false);
  const key = `mathin:classroom:palm-eraser:v1:${scope}`;
  useEffect(() => {
    const resize = () => setScreenKey(currentPalmScreenKey());
    const read = () => {
      try { setSettings(parsePalmEraserSettings(JSON.parse(localStorage.getItem(key) ?? "null"))); }
      catch { setSettings(DEFAULT_PALM_ERASER_SETTINGS); }
      resize();
    };
    const timer = window.setTimeout(read, 0);
    const storage = (event: StorageEvent) => { if (event.key === key) read(); };
    window.addEventListener("resize", resize); window.addEventListener("storage", storage);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", resize); window.removeEventListener("storage", storage); };
  }, [key]);
  const save = useCallback((next: PalmEraserSettings) => {
    setSettings(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setSessionOnly(false); }
    catch { setSessionOnly(true); }
  }, [key]);
  const calibrated = Boolean(settings.profile && settings.profile.screenKey === screenKey);
  return { settings, calibrated, active: calibrated && settings.enabled, screenKey, sessionOnly, save };
}
