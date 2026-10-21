// Runtime client: reads screens composed by Mathin, keeps per-device choices, and runs the fixed action set.
import { ApiError, apiOrigin, logout, requestId, runtimeDownload, runtimePost, runtimeRead, runtimeWebTicket, session } from "./api";
import { clearNavigation, openPage, requestLogin, selectParticipant, selectedParticipant } from "./navigation";
import { resolveLocale } from "./locale";
import {
  runtimeClientVersion, runtimeCompatibleAction, runtimeCompatibleBlocks, runtimeCompatibleEffects, runtimeLocalText, runtimeParams, runtimeParamsKey,
  runtimeTabRoutes, type RuntimeAction, type RuntimeAnswers, type RuntimeApp, type RuntimeBlockResult, type RuntimeBlockView, type RuntimeCommandResult,
  type RuntimeEffect, type RuntimeParams, type RuntimeResolveResult, type RuntimeScreen, type RuntimeTabSlot,
} from "./runtime-contract";

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
      signOut: "退出登录", today: "今", weekdays: "一,二,三,四,五,六,日", all: "全部", close: "关闭", updateRequired: "此内容需要更新小程序后查看", choose: "请选择", clear: "清除筛选",
      account: "我的账号", view: "查看", chooseParticipant: "选择参与人", noParticipants: "暂未关联参与人，请联系工作人员。", signInNow: "点击登录",
      more: "加载更多", search: "搜索", submit: "提交", submitted: "已提交", required: "请完成标 * 的项目", upload: "添加", uploading: "正在上传…", uploadFailed: "文件未能上传，请重试",
      chooseAddress: "选择收货地址", confirm: "确定", cancel: "取消", saved: "已保存", opening: "正在打开…", updateReady: "新版本已准备好，重启后使用", updateLatest: "已是最新版本",
      cacheCleared: "缓存已清理", play: "播放", pause: "暂停", next: "下一首", previous: "上一首", done: "完成" } },
  en: { protocol: 1, revision: "built-in", locale: "en", signedIn: false, theme: "paper", brandName: "Gezhi Future Thinking",
    tabs: [{ slot: 1, label: "Discover", icon: "asset:tabs/discover", activeIcon: "asset:tabs/discover-active", screen: "discover" },
      { slot: 2, label: "Calendar", icon: "asset:tabs/calendar", activeIcon: "asset:tabs/calendar-active", screen: "calendar" },
      { slot: 3, label: "Account", icon: "asset:tabs/account", activeIcon: "asset:tabs/account-active", screen: "account" }],
    strings: { loading: "Loading…", retry: "Try again", unavailable: "This content is unavailable. Please try again.", signIn: "Sign in",
      signInPrompt: "Sign in to view your arrangements and records", signOut: "Sign out", today: "Today", weekdays: "M,T,W,T,F,S,S", all: "All",
      close: "Close", updateRequired: "Update the Mini Program to view this content", choose: "Choose", clear: "Clear filters",
      account: "My account", view: "View", chooseParticipant: "Choose participant", noParticipants: "No participant linked. Contact staff.", signInNow: "Sign in",
      more: "Load more", search: "Search", submit: "Submit", submitted: "Submitted", required: "Complete the items marked *", upload: "Add", uploading: "Uploading…",
      uploadFailed: "The file was not uploaded. Try again.", chooseAddress: "Choose address", confirm: "OK", cancel: "Cancel", saved: "Saved", opening: "Opening…",
      updateReady: "A new version is ready. Restart to use it.", updateLatest: "You have the latest version", cacheCleared: "Cache cleared", play: "Play", pause: "Pause",
      next: "Next", previous: "Previous", done: "Done" } },
};

let app: RuntimeApp | null = null, appCheckedAt = 0, appMarker = "";
let appPending: { marker: string; promise: Promise<RuntimeApp> } | null = null;
const appListeners = new Set<(value: RuntimeApp) => void>();
const validApp = (value: unknown): value is RuntimeApp => !!value && typeof value === "object" && (value as RuntimeApp).protocol === 1
  && Array.isArray((value as RuntimeApp).tabs) && !!(value as RuntimeApp).strings && typeof (value as RuntimeApp).revision === "string";

/** The last published app shell for this language and sign-in state, or the built-in shell before the first successful read. */
export function currentApp(): RuntimeApp {
  const locale = runtimeLocale(), marker = runtimeContextMarker();
  if (app && appMarker === marker) return app;
  // Personalized navigation stays in memory; a different account never inherits a cached member shell.
  const stored = session() ? null : read<RuntimeApp>(storageKey("app-" + locale + "-visitor"));
  app = validApp(stored) && stored.tabs.length >= 1 ? stored : builtIn[locale];
  appMarker = marker; appCheckedAt = 0;
  return app;
}
export function onAppChange(listener: (value: RuntimeApp) => void) { appListeners.add(listener); return () => { appListeners.delete(listener); }; }
export async function refreshApp(force = false): Promise<RuntimeApp> {
  const before = currentApp();
  const marker = runtimeContextMarker();
  if (appPending?.marker === marker) return appPending.promise;
  if (!force && before.revision !== "built-in" && Date.now() - appCheckedAt < 30_000) return before;
  const locale = runtimeLocale(), participant = currentParticipant();
  const pending = runtimeRead<RuntimeApp>("app?locale=" + locale + (participant ? "&participant=" + encodeURIComponent(participant) : "")).then(value => {
    if (marker !== runtimeContextMarker() || !validApp(value) || value.tabs.length < 1) return currentApp();
    if (value.participant && value.participant !== currentParticipant()) setParticipant(value.participant);
    appCheckedAt = Date.now();
    const changed = !app || app.revision !== value.revision || app.signedIn !== value.signedIn || app.locale !== value.locale || app.presentation !== value.presentation || JSON.stringify(app.tabs) !== JSON.stringify(value.tabs);
    if (value.locale === locale && value.signedIn === Boolean(session())) {
      app = value; appMarker = runtimeContextMarker();
      if (!value.signedIn) write(storageKey("app-" + locale + "-visitor"), value);
    }
    if (changed) appListeners.forEach(listener => listener(currentApp()));
    return currentApp();
  }).catch(() => currentApp()).then(value => { if (appPending?.promise === pending) appPending = null; return value; });
  appPending = { marker, promise: pending };
  return pending;
}
export function tabScreen(slot: RuntimeTabSlot) { return currentApp().tabs.find(row => row.slot === slot)?.screen || ""; }

/** The selected child stays chosen across tabs, runtime screens and the original pages. */
export function currentParticipant(): string {
  const value = selectedParticipant() || read<string>(storageKey("participant")) || "";
  return /^[0-9a-f-]{36}$/.test(value) ? value : "";
}
export function setParticipant(id: string) {
  if (id === currentParticipant()) return;
  selectParticipant(id); write(storageKey("participant"), id);
  screens.clear(); app = null; appCheckedAt = 0;
}
/** Only used in memory, never sent or stored. Late responses must match the initiating identity and child. */
let accountToken = "", accountFingerprint = "", accountVersion = 0;
function sessionMarker() {
  const value = session();
  if (!value) { accountToken = ""; accountFingerprint = ""; return ""; }
  if (accountToken === value.accessToken) return String(accountVersion);
  accountToken = value.accessToken;
  let fingerprint = value.refreshToken;
  try {
    const encoded = value.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = new Uint8Array(wx.base64ToArrayBuffer(encoded + "=".repeat((4 - encoded.length % 4) % 4)));
    const claims = JSON.parse(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) as { sub?: string; session_id?: string };
    if (claims.sub && claims.session_id) fingerprint = claims.sub + ":" + claims.session_id;
  } catch { /* Opaque sessions use their in-memory refresh identity. */ }
  if (fingerprint !== accountFingerprint) { accountFingerprint = fingerprint; accountVersion++; }
  return String(accountVersion);
}
export function runtimeContextMarker() {
  return [safeOrigin(), sessionMarker(), runtimeLocale(), currentParticipant()].join("|");
}

type Filters = Record<string, Record<string, string>>;
function filters(screen: string, params: RuntimeParams = {}): Record<string, Record<string, string>> {
  return read<Filters>(storageKey("filters-" + screen + "-" + runtimeParamsKey(params))) || {};
}
export function setBlockFilter(screen: string, block: string, facet: string, value: string, params: RuntimeParams = {}) {
  const all = filters(screen, params), current = { ...(all[block] || {}) };
  if (value) current[facet] = value; else delete current[facet];
  all[block] = current;
  write(storageKey("filters-" + screen + "-" + runtimeParamsKey(params)), all);
}

const screens = new Map<string, RuntimeScreen>();
let screensSession = "";
function screenCache() {
  const marker = runtimeContextMarker();
  if (marker !== screensSession) { screens.clear(); screensSession = marker; }
  return screens;
}
const screenKey = (id: string, params: RuntimeParams) => id + ":" + runtimeParamsKey(params) + ":" + JSON.stringify(filters(id, params));
export function cachedScreen(id: string, params: RuntimeParams = {}): RuntimeScreen | null { return screenCache().get(screenKey(id, params)) || null; }
function query(screen: string, extra: Record<string, string> = {}, params: RuntimeParams = {}) {
  const parts = ["locale=" + runtimeLocale()], participant = currentParticipant(), chosen = filters(screen, params);
  if (participant) parts.push("participant=" + participant);
  if (Object.keys(chosen).length) parts.push("filters=" + encodeURIComponent(JSON.stringify(chosen)));
  if (Object.keys(params).length) parts.push("context=" + encodeURIComponent(JSON.stringify(runtimeParams(params))));
  Object.entries(extra).forEach(([key, value]) => { if (value) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value)); });
  return parts.join("&");
}
export async function loadScreen(id: string, params: RuntimeParams = {}): Promise<RuntimeScreen> {
  const marker = runtimeContextMarker();
  const value = await runtimeRead<RuntimeScreen>("screen?id=" + encodeURIComponent(id) + "&" + query(id, {}, params));
  if (marker !== runtimeContextMarker()) throw new ApiError("CONTEXT_CHANGED");
  if (!value || !Array.isArray(value.blocks)) throw new Error("INVALID_SCREEN");
  if (value.participant && value.participant !== currentParticipant()) {
    setParticipant(value.participant);
    void refreshApp(true);
  }
  value.blocks = runtimeCompatibleBlocks(value.blocks, runtimeClientVersion, runtimeLocale());
  screenCache().set(screenKey(id, params), value);
  return value;
}
export async function loadBlock(screen: string, block: string, extra: Record<string, string> = {}, params: RuntimeParams = {}): Promise<RuntimeBlockResult> {
  const marker = runtimeContextMarker();
  const result = await runtimeRead<RuntimeBlockResult>("block?screen=" + encodeURIComponent(screen) + "&block=" + encodeURIComponent(block) + "&" + query(screen, extra, params));
  if (marker !== runtimeContextMarker()) throw new ApiError("CONTEXT_CHANGED");
  return { ...result, block: result.block ? runtimeCompatibleBlocks([result.block], runtimeClientVersion, runtimeLocale())[0] : null };
}
/** Replaces one block in the tree; a hidden result removes it. */
export function replaceBlock(rows: RuntimeBlockView[], id: string, next: RuntimeBlockView | null): RuntimeBlockView[] {
  return rows.reduce<RuntimeBlockView[]>((all, row) => {
    if (row.id === id) { if (next) all.push(next); }
    else if (row.type === "section" || row.type === "collapse") all.push({ ...row, blocks: replaceBlock(row.blocks, id, next) });
    else if (row.type === "tabs") all.push({ ...row, tabs: row.tabs.map(tab => ({ ...tab, blocks: replaceBlock(tab.blocks, id, next) })) });
    else all.push(row);
    return all;
  }, []);
}
function nested(row: RuntimeBlockView): RuntimeBlockView[] {
  if (row.type === "section" || row.type === "collapse") return row.blocks;
  if (row.type === "tabs") return row.tabs.reduce<RuntimeBlockView[]>((all, tab) => all.concat(tab.blocks), []);
  return [];
}
export function findBlock(rows: RuntimeBlockView[], id: string): RuntimeBlockView | null {
  for (const row of rows) {
    if (row.id === id) return row;
    const found = findBlock(nested(row), id);
    if (found) return found;
  }
  return null;
}
/** Every block id in the tree, for refreshing the lists of a screen after a command. */
export function blockIds(rows: RuntimeBlockView[], type?: RuntimeBlockView["type"]): string[] {
  return rows.reduce<string[]>((all, row) => all.concat(!type || row.type === type ? [row.id] : [], blockIds(nested(row), type)), []);
}

/** `/api/…` paths load from the API origin, `asset:` names from the package, and HTTPS URLs as published. Charts arrive as SVG data. */
export function runtimeImage(value: string): string {
  if (!value) return "";
  if (value.startsWith("asset:")) return "/assets/" + value.slice(6).replace(/[^a-z0-9/-]/g, "") + ".png";
  if (value.startsWith("/api/")) { const origin = safeOrigin(); return origin ? origin + value : ""; }
  if (value.startsWith("data:image/svg+xml;base64,")) return value;
  return value.startsWith("https://") ? value : "";
}
export function runtimeMedia(value: string): string {
  if (value.startsWith("/api/")) { const origin = safeOrigin(); return origin ? origin + value : ""; }
  return value.startsWith("https://") ? value : "";
}
/** Applies image paths for the renderer without changing the published structure. */
export function prepareBlocks(rows: RuntimeBlockView[]): RuntimeBlockView[] {
  return rows.map(row => {
    switch (row.type) {
      case "section": case "collapse": return { ...row, blocks: prepareBlocks(row.blocks) };
      case "tabs": return { ...row, tabs: row.tabs.map(tab => ({ ...tab, blocks: prepareBlocks(tab.blocks) })) };
      case "image": case "feature": case "card": return { ...row, image: runtimeImage(row.image) };
      case "entries": return { ...row, items: row.items.map(item => ({ ...item, icon: runtimeImage(item.icon) })) };
      case "list": return { ...row, items: row.items.map(item => ({ ...item, image: runtimeImage(item.image), avatar: runtimeImage(item.avatar || ""),
        images: (item.images || []).map(runtimeImage).filter(Boolean) })) };
      case "video": return { ...row, src: runtimeMedia(row.src), poster: runtimeImage(row.poster) };
      case "audio": return { ...row, tracks: row.tracks.map(track => ({ ...track, src: runtimeMedia(track.src), cover: runtimeImage(track.cover) })) };
      case "badges": return { ...row, items: row.items.map(item => ({ ...item, image: runtimeImage(item.image) })) };
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
export function clearRuntimeSession() { screens.clear(); app = null; appCheckedAt = 0; appPending = null; }

const text = (value: { zh: string; en: string } | undefined) => runtimeLocalText(value, runtimeLocale());
const fail = (error?: unknown) => {
  const strings = currentApp().strings;
  wx.showToast({ title: error instanceof ApiError && error.code === "UNAUTHENTICATED" ? strings.signInPrompt : strings.unavailable, icon: "none" });
};

/** Opens a Mathin path or an HTTPS page on a business domain. Signed-in families arrive signed in. */
async function openWeb(url: string, signIn: boolean) {
  let target = url.startsWith("/") ? safeOrigin() + url : url;
  if (signIn && url.startsWith("/") && session()) {
    wx.showLoading({ title: currentApp().strings.opening, mask: true });
    try { target = (await runtimeWebTicket(url)).url; } catch { /* Opens without signing in; the page offers its own sign-in. */ }
    finally { wx.hideLoading(); }
  }
  if (target.startsWith("https://") || target.startsWith("http://")) wx.navigateTo({ url: "/pages/web/index?src=" + encodeURIComponent(target) });
}
async function openDocument(url: string) {
  wx.showLoading({ title: currentApp().strings.opening, mask: true });
  try {
    const filePath = await runtimeDownload(url);
    await new Promise<void>((resolve, reject) => wx.openDocument({ filePath, showMenu: true, success: () => resolve(), fail: reject }));
  } catch (error) { fail(error); }
  finally { wx.hideLoading(); }
}
async function saveImage(url: string) {
  try {
    // Bundled images are already local files; others are downloaded first.
    const filePath = url.startsWith("asset:") ? runtimeImage(url) : await runtimeDownload(runtimeImage(url).replace(safeOrigin(), "") || url);
    await new Promise<void>((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject }));
    wx.showToast({ title: currentApp().strings.saved, icon: "success" });
  } catch (error) {
    // A refused album permission can be changed in the Mini Program settings.
    if (String((error as { errMsg?: string })?.errMsg || "").includes("auth")) wx.openSetting({});
    else fail(error);
  }
}

/** Runs a command from a button or form and returns the effects Mathin decided. */
export async function runCommand(command: string, params: Record<string, string>, context: { screen: string; block: string; values?: RuntimeAnswers; params?: RuntimeParams }): Promise<RuntimeEffect[]> {
  const marker = runtimeContextMarker();
  const result = await runtimePost<RuntimeCommandResult>("command", { id: requestId(), command, params, values: context.values, screen: context.screen,
    block: context.block, context: runtimeParams(context.params), participant: currentParticipant(), locale: runtimeLocale() });
  if (marker !== runtimeContextMarker()) throw new ApiError("CONTEXT_CHANGED");
  if (result.accepted === false) throw new ApiError("UPDATE_REQUIRED");
  return Array.isArray(result?.effects) ? runtimeCompatibleEffects(result.effects, runtimeClientVersion, runtimeLocale()) : [];
}
export async function resolveCode(code: string, kind: "scan" | "scene"): Promise<RuntimeEffect[]> {
  const result = await runtimeRead<RuntimeResolveResult>("resolve?kind=" + kind + "&locale=" + runtimeLocale() + "&code=" + encodeURIComponent(code));
  return Array.isArray(result?.effects) ? runtimeCompatibleEffects(result.effects, runtimeClientVersion, runtimeLocale()) : [];
}

/** Launch scenes from Mini Program codes are offered to Mathin once, by the first screen that appears. */
let launchScene = "";
export function rememberLaunchScene(scene: unknown) { if (typeof scene === "string" && scene) launchScene = decodeURIComponent(scene).slice(0, 200); }
export function takeLaunchScene() { const scene = launchScene; launchScene = ""; return scene; }

/** WeChat checks for a new version at launch; when it is ready the family can restart into it. */
let updateReady = false;
export function watchForUpdate() {
  if (!wx.canIUse("getUpdateManager")) return;
  const manager = wx.getUpdateManager();
  manager.onUpdateReady(() => {
    updateReady = true;
    const strings = currentApp().strings;
    wx.showModal({ content: strings.updateReady, confirmText: strings.confirm, cancelText: strings.cancel, success: result => { if (result.confirm) manager.applyUpdate(); } });
  });
}
function checkUpdate() {
  const strings = currentApp().strings;
  if (updateReady) wx.showModal({ content: strings.updateReady, confirmText: strings.confirm, cancelText: strings.cancel, success: result => { if (result.confirm) wx.getUpdateManager().applyUpdate(); } });
  else {
    let version = "";
    try { version = wx.getAccountInfoSync().miniProgram.version || ""; } catch { /* Development builds have no version. */ }
    wx.showToast({ title: strings.updateLatest + (version ? " " + version : ""), icon: "none" });
  }
}
/** Clears saved screens and filters; the session and chosen child stay. */
function clearCache() {
  try {
    const keep = storageKey("participant");
    wx.getStorageInfoSync().keys.filter(key => key.startsWith("gezhi.runtime.") && key !== keep).forEach(key => wx.removeStorageSync(key));
  } catch { /* Storage is optional. */ }
  clearRuntimeSession();
  wx.showToast({ title: currentApp().strings.cacheCleared, icon: "success" });
}

/** Runs a published action. `reload` asks the caller to read its screen again; host-only actions return their kind. */
export async function runAction(action: RuntimeAction | null | undefined): Promise<"reload" | "none" | "sheet" | "command" | "participant"> {
  if (!action) return "none";
  action = runtimeCompatibleAction(action, runtimeClientVersion);
  switch (action.type) {
    case "screen":
      if (action.sheet) return "sheet";
      wx.navigateTo({ url: "/pages/screen/index?id=" + encodeURIComponent(action.screen) + (action.params ? "&params=" + encodeURIComponent(JSON.stringify(runtimeParams(action.params))) : "") }); return "none";
    case "tab": wx.switchTab({ url: runtimeTabRoutes[action.slot] }); return "none";
    case "route": { const search = encode(action.query); openPage(`/pages/${action.route}/index` + (search ? "?" + search : "")); return "none"; }
    case "web": await openWeb(action.url, action.signIn === true); return "none";
    case "phone": wx.makePhoneCall({ phoneNumber: action.number }); return "none";
    case "copy": wx.setClipboardData({ data: action.text }); return "none";
    case "toast": wx.showToast({ title: text(action.text), icon: "none" }); return "none";
    case "preview": { const urls = action.images.map(runtimeImage).filter(Boolean); if (urls.length) wx.previewImage({ urls, current: urls[0] }); return "none"; }
    case "save": await saveImage(action.image); return "none";
    case "document": await openDocument(action.url); return "none";
    case "location": wx.openLocation({ latitude: action.latitude, longitude: action.longitude, name: text(action.name), address: text(action.address), scale: 16 }); return "none";
    case "command": case "subscribe": case "scan": return "command";
    case "participant": return "participant";
    case "clearCache": clearCache(); return "reload";
    case "update": checkUpdate(); return "none";
    // Customer service and sharing are native button types; a plain tap shows the share menu.
    case "share": wx.showShareMenu({ withShareTicket: false, menus: ["shareAppMessage", "shareTimeline"] }); return "none";
    case "contact": return "none";
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

/** Commands, subscriptions and scans talk to Mathin; the effects that come back are run by the host. */
export async function commandEffects(action: RuntimeAction, context: { screen: string; block: string; params?: RuntimeParams }): Promise<RuntimeEffect[] | null> {
  const marker = runtimeContextMarker();
  if (action.type === "scan") {
    const code = await new Promise<string>(resolve => wx.scanCode({ success: result => resolve(result.result || ""), fail: () => resolve("") }));
    return code ? resolveCode(code, "scan") : null;
  }
  if (!session()) { openLogin(); return null; }
  if (action.type === "subscribe") {
    const accepted = await new Promise<string[]>(resolve => wx.requestSubscribeMessage({ tmplIds: action.templates,
      success: result => resolve(action.templates.filter(id => (result as unknown as Record<string, string>)[id] === "accept")), fail: () => resolve([]) }));
    return accepted.length ? runCommand("subscriptions.record", { accepted: accepted.join(",") }, context) : null;
  }
  if (action.type !== "command") return null;
  if (action.confirm) {
    const strings = currentApp().strings;
    const confirmed = await new Promise<boolean>(resolve => wx.showModal({ content: text(action.confirm), confirmText: strings.confirm, cancelText: strings.cancel,
      success: result => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirmed) return null;
  }
  if (marker !== runtimeContextMarker()) return null;
  return runCommand(action.command, action.params || {}, context);
}
