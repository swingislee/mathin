// 员工桌面提醒首轮只支持 Windows Edge；客户端、同源入口与 Worker 复用同一支持范围。
export function detectBrowserFamily(userAgent) {
  if (/Edg\//i.test(userAgent)) return "edge";
  if (/Chrome\//i.test(userAgent) || /Chromium\//i.test(userAgent)) return "chrome";
  if (/Firefox\//i.test(userAgent)) return "firefox";
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "safari";
  return "unknown";
}

export function detectPlatformFamily(userAgent) {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  if (/Linux/i.test(userAgent)) return "linux";
  return "unknown";
}

export function isSupportedWebPushDevice(browserFamily, platformFamily) {
  return browserFamily === "edge" && platformFamily === "windows";
}

export function isSupportedWebPushUserAgent(userAgent) {
  return isSupportedWebPushDevice(detectBrowserFamily(userAgent), detectPlatformFamily(userAgent));
}
