/* Mathin notification-only Service Worker.
 * It intentionally has no fetch handler and never caches application pages.
 */

const DATABASE_NAME = "mathin-notification-runtime";
const DATABASE_VERSION = 1;
const DELIVERY_STORE = "deliveries";
const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TTL_MS = 4 * 60 * 60 * 1000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DELIVERY_STORE)) {
        database.createObjectStore(DELIVERY_STORE, { keyPath: "deliveryId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("WEB_PUSH_IDB_OPEN_FAILED"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("WEB_PUSH_IDB_ABORTED"));
    transaction.onerror = () => reject(transaction.error || new Error("WEB_PUSH_IDB_FAILED"));
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("WEB_PUSH_IDB_REQUEST_FAILED"));
  });
}

async function reserveDelivery(deliveryId, expiresAt) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DELIVERY_STORE, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(DELIVERY_STORE);
    const existing = await requestValue(store.get(deliveryId));
    if (existing) {
      await completed;
      return false;
    }
    store.put({ deliveryId, expiresAt });
    await completed;
    return true;
  } finally {
    database.close();
  }
}

async function clearExpiredDeliveries(now = Date.now()) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DELIVERY_STORE, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(DELIVERY_STORE);
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (!Number.isFinite(cursor.value?.expiresAt) || cursor.value.expiresAt <= now) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("WEB_PUSH_IDB_CURSOR_FAILED"));
    });
    await completed;
  } finally {
    database.close();
  }
}

function parsePayload(event) {
  let value;
  try {
    value = event.data?.json();
  } catch {
    return null;
  }
  if (
    value?.v !== 1
    || typeof value.deliveryId !== "string"
    || !DELIVERY_ID.test(value.deliveryId)
    || (value.locale !== "zh" && value.locale !== "en")
    || !Number.isFinite(value.expiresAt)
  ) return null;
  const now = Date.now();
  if (value.expiresAt <= now || value.expiresAt > now + MAX_TTL_MS + 60_000) return null;
  return {
    deliveryId: value.deliveryId,
    locale: value.locale,
    expiresAt: value.expiresAt,
  };
}

function genericCopy(locale) {
  return locale === "en"
    ? { title: "Mathin work reminder", body: "You have a new work notification. Sign in to view it." }
    : { title: "Mathin 工作提醒", body: "你有一条新的工作通知，登录后可查看。" };
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), clearExpiredDeliveries()]));
});

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  if (!payload) return;
  event.waitUntil((async () => {
    await clearExpiredDeliveries();
    if (!(await reserveDelivery(payload.deliveryId, payload.expiresAt))) return;
    const copy = genericCopy(payload.locale);
    await self.registration.showNotification(copy.title, {
      body: copy.body,
      tag: `mathin:${payload.deliveryId}`,
      renotify: false,
      requireInteraction: false,
      data: { deliveryId: payload.deliveryId, locale: payload.locale },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deliveryId = event.notification.data?.deliveryId;
  const locale = event.notification.data?.locale === "en" ? "en" : "zh";
  if (typeof deliveryId !== "string" || !DELIVERY_ID.test(deliveryId)) return;
  const target = new URL(`/${locale}/dashboard/notifications/${deliveryId}`, self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "MATHIN_WEB_PUSH_SUBSCRIPTION_CHANGED" });
  })());
});
