import "server-only";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import type { MiniappWechatConfig } from "./miniapp-config";
import { MiniappWechatError, miniappWechatCodeSchema } from "./miniapp-provider";

// These endpoints carry secrets in their URL/body. Keep them out of Next fetch tracing.
async function privateRequest(url: URL, body?: object): Promise<Response> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new MiniappWechatError("UNAVAILABLE"));
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpsRequest(url, { method: payload ? "POST" : "GET", timeout: 10_000,
      signal: AbortSignal.timeout(10_000), headers: payload ? { "Content-Type": "application/json" } : {} }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) { res.destroy(); fail(); } else chunks.push(chunk); });
      res.on("error", fail);
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502,
        headers: { "Content-Type": res.headers["content-type"] ?? "application/json" } })));
    });
    req.on("timeout", () => { req.destroy(); fail(); }); req.on("error", fail); req.end(payload);
  });
}

let cached: { appId: string; token: string; expires: number } | undefined;
async function accessToken(config: MiniappWechatConfig) {
  if (cached?.appId === config.appId && cached.expires > Date.now()) return cached.token;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/stable_token");
  const response = await privateRequest(url, { grant_type: "client_credential", appid: config.appId, secret: config.appSecret });
  const data = z.object({ access_token: z.string().min(1).max(2048), expires_in: z.number().positive() }).safeParse(await response.json());
  if (!response.ok || !data.success) throw new MiniappWechatError("UNAVAILABLE");
  cached = { appId: config.appId, token: data.data.access_token, expires: Date.now() + Math.max(0, data.data.expires_in - 300) * 1000 };
  return cached.token;
}

export function verifiedPhone(payload: unknown, appId: string, now = Date.now()) {
  const result = z.object({ errcode: z.literal(0), phone_info: z.object({
    phoneNumber: z.string().regex(/^\+?[0-9]{7,20}$/), purePhoneNumber: z.string().regex(/^[0-9]{6,18}$/),
    countryCode: z.string().regex(/^[0-9]{1,3}$/), watermark: z.object({ appid: z.literal(appId), timestamp: z.number().int() }),
  }) }).safeParse(payload);
  if (!result.success) throw new MiniappWechatError("UNAUTHENTICATED");
  const phone = result.data.phone_info;
  if (phone.watermark.timestamp * 1000 < now - 600_000 || phone.watermark.timestamp * 1000 > now + 60_000
    || ![phone.countryCode + phone.purePhoneNumber, ...(phone.countryCode === "86" ? [phone.purePhoneNumber] : [])]
      .includes(phone.phoneNumber.replace(/^\+/, ""))) throw new MiniappWechatError("UNAUTHENTICATED");
  return { phone: "+" + phone.countryCode + phone.purePhoneNumber,
    localPhone: phone.countryCode === "86" ? phone.purePhoneNumber : phone.countryCode + phone.purePhoneNumber, countryCode: phone.countryCode };
}

export async function exchangeMiniappPhone(config: MiniappWechatConfig, code: string) {
  if (!miniappWechatCodeSchema.safeParse(code).success) throw new MiniappWechatError("VALIDATION");
  const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  url.searchParams.set("access_token", await accessToken(config));
  const response = await privateRequest(url, { code });
  if (!response.ok) throw new MiniappWechatError("UNAVAILABLE");
  return verifiedPhone(await response.json(), config.appId);
}

export async function miniappPromotionCode(config: MiniappWechatConfig, scene: string, environment: "release" | "trial" | "develop") {
  if (!/^[a-f0-9]{24}$/.test(scene)) throw new MiniappWechatError("VALIDATION");
  const url = new URL("https://api.weixin.qq.com/wxa/getwxacodeunlimit");
  url.searchParams.set("access_token", await accessToken(config));
  const response = await privateRequest(url, { scene, page: "pages/onboarding/index", env_version: environment,
    check_path: environment === "release", width: 430 });
  const mime = response.headers.get("content-type")?.split(";")[0];
  if (!response.ok || !mime || !["image/png", "image/jpeg"].includes(mime)) throw new MiniappWechatError("UNAVAILABLE");
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime };
}
