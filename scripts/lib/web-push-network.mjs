import { lookup as systemLookup } from "node:dns";
import { Agent } from "node:https";
import { BlockList, isIP } from "node:net";
import { validateWebPushEndpoint } from "../../src/features/events/web-push-runtime.mjs";

const privateV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) privateV4.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  specialV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicPushAddress(address) {
  const family = isIP(address);
  return family === 4 ? !privateV4.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
}

const forbidden = () => Object.assign(new Error("WEB_PUSH_TARGET_FORBIDDEN"), {
  code: "WEB_PUSH_TARGET_FORBIDDEN", configurationFailure: true,
});

// 在 TLS socket 实际解析时验证全部地址；连接复用同一次解析结果，避免先检查后重解析。
export function createWebPushLookup(expectedHost, resolve = systemLookup) {
  return (hostname, options, callback) => {
    if (hostname !== expectedHost) return callback(forbidden());
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses?.length || addresses.some(({ address }) => !isPublicPushAddress(address))) {
        return callback(forbidden());
      }
      if (options?.all) return callback(null, addresses);
      const family = typeof options === "number" ? options : options?.family;
      const selected = addresses.find((address) => !family || address.family === family);
      if (!selected) return callback(forbidden());
      callback(null, selected.address, selected.family);
    });
  };
}

export function createWebPushAgent(endpoint, allowedOrigins) {
  const hostname = new URL(validateWebPushEndpoint(endpoint, allowedOrigins)).hostname;
  return new Agent({ keepAlive: false, lookup: createWebPushLookup(hostname) });
}
