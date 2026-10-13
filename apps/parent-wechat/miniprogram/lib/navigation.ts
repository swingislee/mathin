// 只在当前运行中保存返回位置和所选 ID，账号退出时一起清除。
import { nativeScreenIds } from "./miniapp-native";
let returnPath = "";
let loginRequested = false;
let participantId = "";
const tabs = ["discover", "calendar", "account", "tab-4", "tab-5"];
// Runtime screens and the extra tab slots are valid return targets alongside the original pages.
const pages = [...(nativeScreenIds as readonly string[]), ...tabs, "screen"];
function isDestination(url: string): boolean {
  const match = /^\/pages\/([a-z0-9-]+)\/index(\?[^#]*)?$/.exec(url);
  return !!match && pages.includes(match[1]) && !(tabs.includes(match[1]) && match[2]);
}

export function openPage(url: string) {
  if (tabs.some(tab => url === `/pages/${tab}/index`)) wx.switchTab({ url });
  else if (isDestination(url)) wx.navigateTo({ url });
}
export function rememberReturn(url: unknown) {
  returnPath = typeof url === "string" && isDestination(url) ? url : "";
}
export function requestLogin(url: unknown) { rememberReturn(url); loginRequested = true; }
export function takeLoginRequest() { const requested = loginRequested; loginRequested = false; return requested; }
export function cancelLogin() { returnPath = ""; loginRequested = false; }
export function resumeAfterLogin() {
  const target = returnPath;
  cancelLogin();
  if (target) openPage(target);
  return Boolean(target);
}
/** Hands the requested return page to the sign-in page and clears the pending request. */
export function takeReturn() { const target = returnPath; cancelLogin(); return target; }
export function isTabPath(url: string) { return tabs.some(tab => url === `/pages/${tab}/index`); }
export function selectedParticipant() { return participantId; }
export function hasReturn() { return Boolean(returnPath); }
export function selectParticipant(id: string) { participantId = id; }
export function clearNavigation() { cancelLogin(); participantId = ""; }
