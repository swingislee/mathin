import { describe, expect, it, vi } from "vitest";
import { Agent } from "node:https";
import { createWebPushAgent, createWebPushLookup, isPublicPushAddress } from "../scripts/lib/web-push-network.mjs";

const host = "wns2-sg2p.notify.windows.com";
describe("socket-time WNS address guard", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "172.31.0.1", "100.64.0.1",
    "0.0.0.0", "198.18.0.1", "224.0.0.1", "240.0.0.1", "::1", "::", "fe80::1", "fc00::1",
    "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::", "not-an-address"])("blocks %s", (address) => {
    expect(isPublicPushAddress(address)).toBe(false);
  });
  it.each(["13.107.6.175", "52.182.141.192", "2603:1061:10::10"])("accepts public %s", (address) => {
    expect(isPublicPushAddress(address)).toBe(true);
  });
  it("binds the actual HTTPS agent to the validated WNS hostname", () => {
    const agent = createWebPushAgent(`https://${host}/w/?token=test-only`, `https://${host}`);
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.options.lookup).toBeTypeOf("function");
    agent.destroy();
  });
  it("uses one lookup result for the socket and rejects any private member", () => {
    const resolve = vi.fn((_host, _options, cb) => cb(null, [{ address: "13.107.6.175", family: 4 }, { address: "127.0.0.1", family: 4 }]));
    const callback = vi.fn();
    createWebPushLookup(host, resolve)(host, { all: true }, callback);
    expect(resolve).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toMatchObject({ code: "WEB_PUSH_TARGET_FORBIDDEN" });
  });
  it("checks every new lookup instead of trusting a previous public answer", () => {
    const resolve = vi.fn().mockImplementationOnce((_host, _options, cb) => cb(null, [{ address: "13.107.6.175", family: 4 }]))
      .mockImplementationOnce((_host, _options, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]));
    const lookup = createWebPushLookup(host, resolve);
    const callback = vi.fn();
    lookup(host, 4, callback);
    expect(callback.mock.calls[0]).toEqual([null, "13.107.6.175", 4]);
    lookup(host, 4, callback);
    expect(callback.mock.calls[1][0]).toMatchObject({ code: "WEB_PUSH_TARGET_FORBIDDEN" });
  });
  it("rejects a changed hostname without resolving it", () => {
    const resolve = vi.fn();
    const callback = vi.fn();
    createWebPushLookup(host, resolve)("internal.example.test", {}, callback);
    expect(resolve).not.toHaveBeenCalled();
    expect(callback.mock.calls[0][0]).toMatchObject({ code: "WEB_PUSH_TARGET_FORBIDDEN" });
  });
});
