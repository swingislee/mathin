// 使用独立临时浏览器配置验证厂商 Push 线路；只输出 origin 与聚合结果，结束时注销并清理。
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import webpush from "web-push";

const family = process.argv[2];
if (!['chrome', 'edge'].includes(family)) throw new Error("Specify chrome or edge");
const sw = await readFile(new URL("../public/notification-sw.js", import.meta.url), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/notification-sw.js") {
    res.writeHead(200, { "content-type": "application/javascript", "service-worker-allowed": "/", "cache-control": "no-store" });
    res.end(sw);
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><title>Mathin Push network check</title><button id="enable">Enable test device</button>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profilePath = await mkdtemp(path.join(os.tmpdir(), "mathin-push-browser-"));
let stage = "browser_launch";
let subscription;
let context;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    channel: family === "edge" ? "msedge" : "chrome", headless: true,
    permissions: ["notifications"], ignoreDefaultArgs: ["--disable-background-networking"],
  });
  const page = await context.newPage();
  await page.goto(origin);
  const keys = webpush.generateVAPIDKeys();
  stage = "browser_subscribe";
  subscription = await page.evaluate(async (publicKey) => {
    const decoded = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - publicKey.length % 4) % 4));
    const key = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    await navigator.serviceWorker.register("/notification-sw.js");
    const registration = await navigator.serviceWorker.ready;
    return Promise.race([
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then((s) => s.toJSON()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SUBSCRIBE_TIMEOUT")), 45000)),
    ]);
  }, keys.publicKey);
  const endpointOrigin = new URL(subscription.endpoint).origin;
  process.stdout.write(JSON.stringify({ browser: family, stage, result: "PASS", endpointOrigin }) + "\n");
  stage = "provider_send";
  const deliveryId = randomUUID();
  const payload = JSON.stringify({ v: 1, deliveryId, locale: "zh", expiresAt: Date.now() + 120000 });
  const options = { TTL: 120, timeout: 15000,
    vapidDetails: { subject: "https://mathin.club", publicKey: keys.publicKey, privateKey: keys.privateKey },
    ...(process.env.MATHIN_WEB_PUSH_PROXY ? { proxy: process.env.MATHIN_WEB_PUSH_PROXY } : {}),
  };
  await page.close();
  const sent = await webpush.sendNotification(subscription, payload, options);
  stage = "closed_tab_receipt";
  const check = await context.newPage();
  await check.goto(origin);
  await check.waitForFunction(async (tag) => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications({ tag })).length === 1;
  }, `mathin:${deliveryId}`, { timeout: 45000 });
  await webpush.sendNotification(subscription, payload, options);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const count = await check.evaluate(async (tag) => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications({ tag })).length;
  }, `mathin:${deliveryId}`);
  if (count !== 1) throw new Error("DUPLICATE_NOTIFICATION");
  process.stdout.write(JSON.stringify({ browser: family, result: "PASS", providerStatus: sent.statusCode,
    closedTab: true, notificationCount: count, windowsToastManuallyVerified: false }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ browser: family, stage, result: "BLOCKED", errorClass: error?.name,
    detail: String(error?.message || "").split("\n")[0].replace(/https?:\/\/\S+/g, "[URL]").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 200),
    providerDetail: String(error?.body || "").replace(/https?:\/\/\S+/g, "[URL]").replace(/[A-Za-z0-9_-]{25,}/g, "[redacted]").slice(0, 240),
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null }) + "\n");
  process.exitCode = 1;
} finally {
  if (context && subscription) {
    const cleanup = await context.newPage().catch(() => null);
    if (cleanup) {
      await cleanup.goto(origin).catch(() => {});
      await cleanup.evaluate(async () => {
        for (const registration of await navigator.serviceWorker.getRegistrations()) {
          (await registration.getNotifications()).forEach((notification) => notification.close());
          await (await registration.pushManager.getSubscription())?.unsubscribe();
          await registration.unregister();
        }
      }).catch(() => {});
    }
  }
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  if (path.dirname(profilePath) === path.resolve(os.tmpdir()) && path.basename(profilePath).startsWith("mathin-push-browser-")) {
    await rm(profilePath, { recursive: true, force: true });
  }
}
