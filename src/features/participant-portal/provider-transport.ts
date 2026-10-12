import "server-only";
import { createHash, createHmac } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { publicWebsiteUrl } from "@/features/school/miniapp-settings/experience-schema";
import { providerCapabilities, type ExperienceConnection, type ProviderCapability } from "../../../contracts/participant-api/miniapp-experience";
import { PortalError } from "@/features/parent-portal/server";

const configuration = z.object({ endpoint: z.string().max(2000).refine(publicWebsiteUrl), token: z.string().min(16).max(4096), identityKey: z.string().min(32).max(256) }).strict();
export type ProviderConfiguration = z.infer<typeof configuration>;
export function providerConfiguration(id: string): ProviderConfiguration | null {
  try { const all = JSON.parse(process.env.MATHIN_MINIAPP_PROVIDERS || "{}"); if (!Object.hasOwn(all, id)) return null; const parsed = configuration.safeParse(all[id]); return parsed.success ? parsed.data : null; } catch { return null; }
}
export function providerBindingKey(config: ProviderConfiguration) { return createHash("sha256").update(config.endpoint + "\n" + config.identityKey).digest("hex"); }
export function providerActor(config: ProviderConfiguration, userId: string) { return createHmac("sha256", config.identityKey).update("participant:" + userId).digest("hex"); }
/** The connector uses public IPv4 addresses only and pins the resolved address to prevent DNS rebinding. */
export function publicProviderAddress(address: string) {
  const parts = address.split(".").map(Number); if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
export async function callProvider(config: ProviderConfiguration, operation: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = new URL(config.endpoint);
  if (!publicWebsiteUrl(url.href)) throw new PortalError("UNAVAILABLE");
  const addresses = await resolve4(url.hostname).catch(() => []);
  if (!addresses.length || addresses.some(ip => !publicProviderAddress(ip))) throw new PortalError("UNAVAILABLE");
  const body = JSON.stringify({ version: 1, operation, ...payload });
  if (Buffer.byteLength(body) > 256 * 1024) throw new PortalError("TOO_LARGE");
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: "POST", agent: false, servername: url.hostname, signal: AbortSignal.timeout(10_000),
      // Force IPv4 so Node does not request an all-address lookup for family auto-selection.
      family: 4, lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.token}`, "Content-Length": Buffer.byteLength(body), "User-Agent": "Miniapp-Booking-Connector/1" },
    }, res => {
      // Redirects are never followed; provider errors and response bodies are not exposed in logs.
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || !res.headers["content-type"]?.includes("application/json")) { res.resume(); reject(new PortalError("UNAVAILABLE")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 512 * 1024) { res.destroy(); reject(new PortalError("TOO_LARGE")); } else chunks.push(chunk); });
      res.on("error", () => reject(new PortalError("UNAVAILABLE")));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new PortalError("UNAVAILABLE")); } });
    });
    req.on("error", () => reject(new PortalError("UNAVAILABLE"))); req.end(body);
  });
}
const capabilitiesSchema = z.object({ version: z.literal(1), capabilities: z.array(z.enum(providerCapabilities)).max(30), contracts: z.array(z.string().max(64)).max(30) }).strict();
const capabilitiesCache = new Map<string, { expires: number; value: z.infer<typeof capabilitiesSchema> }>();
export async function providerHandshake(id: string, force = false) {
  const config = providerConfiguration(id); if (!config) throw new PortalError("UNAVAILABLE");
  const key = providerBindingKey(config), cached = capabilitiesCache.get(key);
  if (!force && cached && cached.expires > Date.now()) return cached.value;
  const value = capabilitiesSchema.parse(await callProvider(config, "capabilities.read", {}));
  if (capabilitiesCache.size >= 100) capabilitiesCache.clear();
  capabilitiesCache.set(key, { expires: Date.now() + 60_000, value }); return value;
}
export async function connectedProvider(connection: ExperienceConnection, operation: ProviderCapability, contracts: string[] = []) {
  const config = providerConfiguration(connection.id); if (!config || !connection.enabled || connection.adapter !== "http-v1" || !connection.capabilities.includes(operation)) throw new PortalError("UNAVAILABLE");
  const actual = await providerHandshake(connection.id);
  if (!actual.capabilities.includes(operation) || contracts.some(c => !actual.contracts.includes(c))) throw new PortalError("UNAVAILABLE");
  return config;
}
