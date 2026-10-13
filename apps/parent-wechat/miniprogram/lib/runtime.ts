// Runtime client: reads screens composed by Mathin, keeps per-device choices, and runs the fixed action set.
import { apiOrigin, logout, runtimeRead, session } from "./api";
import { clearNavigation, openPage, requestLogin, selectParticipant, selectedParticipant } from "./navigation";
import { resolveLocale } from "./locale";
import { runtimeTabRoutes, type RuntimeAction, type RuntimeApp, type RuntimeBlockResult, type RuntimeBlockView, type RuntimeScreen, type RuntimeTabSlot } from "./runtime-contract";

type Locale = "zh" | "en";
const storageKey = (name: string) => `gezhi.runtime.${name}.v1:${safeOrigin()}`;
function safeOrigin() { try { return apiOrigin(); } catch { return ""; } }
function read<T>(key: string): T | null { try { return (wx.getStorageSync(key) as T) || null; } catch { return null; } }
function write(key: string, value: unknown) { try { wx.setStorageSync(key, value); } catch { /* Storage is optional. */ } }

export function runtimeLocale(): Locale { return resolveLocale(wx.getAppBaseInfo().language); }

const builtIn: Record<Locale, RuntimeApp> = {
  zh: { protocol: 1, revision: "built-in", locale: "zh", signedIn: false, theme: "paper", brandName: "格致未来思维",
    tabs: [{ slot: 1, label: "发现", icon: "asset:tabs/discover", activeIcon: "asset:tabs/discover-active", screen: "discover" },
      { slot: 2, label: "日历", icon: "asset:tabs/calendar", activeIcon: "asset:tabs/calendar-active", screen: "calendar" },
      { slot: 3, label: "我的", icon: "asset:tabs/account", activeIcon: "asset:tabs/account-active", screen: "account" }],
    strings: { loading: "正在读取…", retry: "重新读取", unavailable: "内容暂时无法读取，请稍后重试。", signIn: "登录", signInPrompt: "登录后查看个人安排与记录",
      signOut: "退出登录", today: "今", weekdays: "一,二,三,四,五,六,日", all: "全部", close: "关闭", updateRequired: "此内容需要更新小程序后查看", choose: "请选择", clear: "清除筛选" } },
  en: { protocol: 1, revision: "built-in", locale: "en", signedIn: false, theme: "paper", brandName: "Gezhi Future Thinking",
    tabs: [{ slot: 1, label: "Discover", icon: "asset:tabs/discover", activeIcon: "asset:tabs/discover-active", screen: "discover" },
      { slot: 2, label: "Calendar", icon: "asset:tabs/calendar", activeIcon: "asset:tabs/calendar-active", screen: "calendar" },
      { slot: 3, label: "Account", icon: "asset:tabs/account", activeIcon: "asset:tabs/account-active", screen: "account" }],
    strings: { loading: "Loading…", retry: "Try again", unavailable: "This content is unavailable. Please try again.", signIn: "Sign in",
      signInPrompt: "Sign in to view your arrangements and records", signOut: "Sign out", today: "Today", weekdays: "M,T,W,T,F,S,S", all: "All",
      close: "Close", updateRequired: "Update the Mini Program to view this content", choose: "Choose", clear: "Clear filters" } },
};

let app: RuntimeApp | null = null, appCheckedAt = 0, appPending: Promise<RuntimeApp> | null = null;
const appListeners = new Set<(value: RuntimeApp) => void>();
const validApp = (value: unknown): value is RuntimeApp => !!value && typeof value === "object" && (value as RuntimeApp).protocol === 1
  && Array.isArray((value as RuntimeApp).tabs) && !!(value as RuntimeApp).strings && typeof (value as RuntimeApp).revision === "string";

/** The last published app shell for this language and sign-in state, or the built-in shell before the first successful read. */
export function currentApp(): RuntimeApp {
  const locale = runtimeLocale(), signedIn = Boolean(session());
  if (app && app.locale === locale && app.signedIn === signedIn) return app;
  const stored = read<RuntimeApp>(storageKey("app-" + locale + (signedIn ? "-member" : "-visitor")));
  app = validApp(stored) && stored.tabs.length >= 2 ? stored : builtIn[locale];
  return app;
}
export function onAppChange(listener: (value: RuntimeApp) => void) { appListeners.add(listener); return () => { appListeners.delete(listener); }; }
export async function refreshApp(force = false): Promise<RuntimeApp> {
  const before = currentApp();
  if (appPending) return appPending;
  if (!force && before.revision !== "built-in" && Date.now() - appCheckedAt < 30_000) return before;
  const locale = runtimeLocale(), signedIn = Boolean(session());
  const pending = runtimeRead<RuntimeApp>("app?locale=" + locale).then(value => {
    if (!validApp(value) || value.tabs.length < 2) return currentApp();
    appCheckedAt = Date.now();
    const changed = !app || app.revision !== value.revision || app.signedIn !== value.signedIn || app.locale !== value.locale || JSON.stringify(app.tabs) !== JSON.stringify(value.tabs);
    if (value.locale === locale && value.signedIn === Boolean(session())) { app = value; write(storageKey("app-" + locale + (signedIn ? "-member" : "-visitor")), value); }
    if (changed) appListeners.forEach(listener => listener(currentApp()));
    return currentApp();
  }).catch(() => currentApp()).then(value => { appPending = null; return value; });
  appPending = pending;
  return pending;
}
export function tabScreen(slot: RuntimeTabSlot) { return currentApp().tabs.find(row => row.slot === slot)?.screen || ""; }

/** The selected child stays chosen across tabs, runtime screens and the original pages. */
export function currentParticipant(): string {
  const value = selectedParticipant() || read<string>(storageKey("participant")) || "";
  return /^[0-9a-f-]{36}$/.test(value) ? value : "";
}
export function setParticipant(id: string) { selectParticipant(id); write(storageKey("participant"), id); }

type Filters = Record<string, Record<string, string>>;
function filters(screen: string): Record<string, Record<string, string>> { return read<Filters>(storageKey("filters-" + screen)) || {}; }
export function setBlockFilter(screen: string, block: string, facet: string, value: string) {
  const all = filters(screen), current = { ...(all[block] || {}) };
  if (value) current[facet] = value; else delete current[facet];
  all[block] = current;
  write(storageKey("filters-" + screen), all);
}

const screens = new Map<string, RuntimeScreen>();
let screensSession = "";
function screenCache() {
  const marker = session()?.refreshToken || "";
  if (marker !== screensSession) { screens.clear(); screensSession = marker; }
  return screens;
}
export function cachedScreen(id: string): RuntimeScreen | null { return screenCache().get(id + ":" + runtimeLocale()) || null; }
function query(screen: string, extra: Record<string, string> = {}) {
  const parts = ["locale=" + runtimeLocale()], participant = currentParticipant(), chosen = filters(screen);
  if (participant) parts.push("participant=" + participant);
  if (Object.keys(chosen).length) parts.push("filters=" + encodeURIComponent(JSON.stringify(chosen)));
  Object.entries(extra).forEach(([key, value]) => { if (value) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value)); });
  return parts.join("&");
}
export async function loadScreen(id: string): Promise<RuntimeScreen> {
  const value = await runtimeRead<RuntimeScreen>("screen?id=" + encodeURIComponent(id) + "&" + query(id));
  if (!value || !Array.isArray(value.blocks)) throw new Error("INVALID_SCREEN");
  if (value.participant && value.participant !== currentParticipant()) setParticipant(value.participant);
  screenCache().set(id + ":" + runtimeLocale(), value);
  return value;
}
export async function loadBlock(screen: string, block: string, extra: Record<string, string> = {}): Promise<RuntimeBlockResult> {
  return runtimeRead<RuntimeBlockResult>("block?screen=" + encodeURIComponent(screen) + "&block=" + encodeURIComponent(block) + "&" + query(screen, extra));
}
/** Replaces one block in the tree; a hidden result removes it. */
export function replaceBlock(rows: RuntimeBlockView[], id: string, next: RuntimeBlockView | null): RuntimeBlockView[] {
  return rows.reduce<RuntimeBlockView[]>((all, row) => {
    if (row.id === id) { if (next) all.push(next); }
    else if (row.type === "section") all.push({ ...row, blocks: replaceBlock(row.blocks, id, next) });
    else all.push(row);
    return all;
  }, []);
}
export function findBlock(rows: RuntimeBlockView[], id: string): RuntimeBlockView | null {
  for (const row of rows) {
    if (row.id === id) return row;
    if (row.type === "section") { const found = findBlock(row.blocks, id); if (found) return found; }
  }
  return null;
}

/** `/api/…` paths load from the API origin, `asset:` names from the package, and HTTPS URLs as published. */
export function runtimeImage(value: string): string {
  if (!value) return "";
  if (value.startsWith("asset:")) return "/assets/" + value.slice(6).replace(/[^a-z0-9/-]/g, "") + ".png";
  if (value.startsWith("/api/")) { const origin = safeOrigin(); return origin ? origin + value : ""; }
  return value.startsWith("https://") ? value : "";
}
/** Applies image paths for the renderer without changing the published structure. */
export function prepareBlocks(rows: RuntimeBlockView[]): RuntimeBlockView[] {
  return rows.map(row => {
    switch (row.type) {
      case "section": return { ...row, blocks: prepareBlocks(row.blocks) };
      case "image": case "feature": return { ...row, image: runtimeImage(row.image) };
      case "entries": return { ...row, items: row.items.map(item => ({ ...item, icon: runtimeImage(item.icon) })) };
      case "list": return { ...row, items: row.items.map(item => ({ ...item, image: runtimeImage(item.image) })) };
      default: return row;
    }
  });
}

const encode = (values?: Record<string, string>) => Object.entries(values || {}).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
function currentPath() {
  const page = getCurrentPages().slice(-1)[0];
  if (!page) return "";
  const options = (page as unknown as { options?: Record<string, string> }).options || {};
  const search = encode(options);
  return "/" + page.route + (search ? "?" + search : "");
}
export function openLogin() { requestLogin(currentPath()); wx.navigateTo({ url: "/pages/login/index" }); }
export function clearRuntimeSession() { screens.clear(); app = null; appCheckedAt = 0; }

/** Runs a published action. `refresh` and `logout` resolve after the caller should reload its screen. */
export async function runAction(action: RuntimeAction | null | undefined): Promise<"reload" | "none"> {
  if (!action) return "none";
  switch (action.type) {
    case "screen": wx.navigateTo({ url: "/pages/screen/index?id=" + encodeURIComponent(action.screen) + (action.params ? "&" + encode(action.params) : "") }); return "none";
    case "tab": wx.switchTab({ url: runtimeTabRoutes[action.slot] }); return "none";
    case "route": { const search = encode(action.query); openPage(`/pages/${action.route}/index` + (search ? "?" + search : "")); return "none"; }
    case "phone": wx.makePhoneCall({ phoneNumber: action.number }); return "none";
    case "copy": wx.setClipboardData({ data: action.text }); return "none";
    case "login": openLogin(); return "none";
    case "back": if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: runtimeTabRoutes[1] }); return "none";
    case "refresh": return "reload";
    case "logout":
      try { await logout(); } catch { /* The local session is cleared by the API helper. */ }
      clearNavigation(); clearRuntimeSession(); void refreshApp(true);
      return "reload";
    default: return "none";
  }
}
