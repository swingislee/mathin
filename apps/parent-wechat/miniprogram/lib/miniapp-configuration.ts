import { config } from "../config.local";
import { miniappSettings, miniappContentImage, session } from "./api";
import { defaultMiniappSettings, isMiniappSettings, miniappText, type MiniappAction, type MiniappEntry, type MiniappSettings } from "./miniapp-settings";
import type { Locale } from "./locale";
import { openPage } from "./navigation";
import { nativeActionScreens } from "./miniapp-native";

type Saved = { revision: number; config: MiniappSettings; checkedAt: number };
const key = "gezhi.miniapp-settings.v2:" + config.apiOrigin;
let saved: Saved | null = null, pending: Promise<MiniappSettings> | null = null;
let lastAttempt = 0;
export function configuration(): MiniappSettings {
  if (saved) return saved.config;
  try {
    const value = wx.getStorageSync(key) as Saved;
    if (value && Number.isInteger(value.revision) && value.revision >= 0 && isMiniappSettings(value.config)
      && Number.isFinite(value.checkedAt) && Date.now() - value.checkedAt < 24 * 3600_000 && value.checkedAt <= Date.now()) saved = value;
  } catch { /* Storage is optional; native defaults remain usable. */ }
  if (!saved) saved = { revision: -1, config: defaultMiniappSettings(), checkedAt: 0 };
  return saved.config;
}
export async function refreshConfiguration(force = false): Promise<MiniappSettings> {
  configuration();
  if (pending) return pending;
  if (!force && Date.now() - Math.max(saved!.checkedAt, lastAttempt) < 60_000) return saved!.config;
  lastAttempt = Date.now();
  pending = miniappSettings(saved!.revision < 0 ? undefined : saved!.revision).then(result => {
    if (!Number.isInteger(result.revision) || result.revision < 0 || (result.config && !isMiniappSettings(result.config))) throw new Error("INVALID_SETTINGS");
    if (!result.config && result.revision !== saved!.revision) throw new Error("MISSING_SETTINGS");
    saved = { revision: result.revision, config: result.config || saved!.config, checkedAt: Date.now() };
    try { wx.setStorageSync(key, saved); } catch { /* Full storage does not block browsing. */ }
    return saved.config;
  }).catch(() => saved!.config);
  const request = pending;
  try { return await request; } finally { if (pending === request) pending = null; }
}
export function configurationRevision() { configuration(); return saved!.revision; }
export function configurationBrand(locale: Locale) {
  const brand = configuration().brand;
  return { brandName: miniappText(brand.name, locale), brandIntroduction: miniappText(brand.introduction, locale),
    brandImage: miniappContentImage(brand.image, true), theme: brand.theme, configurationRevision: configurationRevision() };
}
export function configuredEntries(entries: MiniappEntry[], locale: Locale, hasParticipants = false) {
  const signedIn = Boolean(session());
  return entries.filter(e => e.visible && e.action !== "none" && (e.audience === "all" || e.audience === "signedIn" && signedIn || e.audience === "participants" && signedIn && hasParticipants))
    .map(e => ({ ...e, label: miniappText(e.title, locale), iconUrl: `/assets/icons/${e.icon}.png` }));
}
export function configuredAccountGroups(locale: Locale, hasParticipants: boolean) {
  return configuration().accountGroups.map(g => ({ id: g.id, label: miniappText(g.title, locale), entries: configuredEntries(g.entries, locale, hasParticipants) })).filter(g => g.entries.length);
}
export function configurationRoute(action: MiniappAction, target = "") {
  const routes: Partial<Record<MiniappAction, string>> = {
    register: "/pages/register/index?source=account",
    privacy: "/pages/document/index?id=privacy", document: "/pages/document/index?id=" + encodeURIComponent(target),
    page: "/pages/experience/index?id=" + encodeURIComponent(target), catalog: "/pages/service-catalog/index?category=" + encodeURIComponent(target),
    offering: "/pages/service-detail/index?id=" + encodeURIComponent(target), form: "/pages/experience-form/index?id=" + encodeURIComponent(target),
    web: "/pages/web/index?id=" + encodeURIComponent(target),
  };
  return routes[action] || (nativeActionScreens[action] ? `/pages/${nativeActionScreens[action]}/index` : "");
}
export function openConfiguredAction(action: MiniappAction, target = "") {
  if (action === "participants") { wx.switchTab({ url: "/pages/account/index" }); return; }
  const route = configurationRoute(action, target); if (route) openPage(route);
}
