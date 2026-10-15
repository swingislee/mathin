import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLimitedRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({ channel: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: database.channel };
    return { from: () => query, rpc: database.receipt };
  },
}));
vi.mock("@/features/wechat/broker-config", () => ({
  requireWechatTokenConfig: () => ({ clientId: "fixture-client", clientSecret: "fixture-secret", authCallbackUrl: "https://example.test/callback" }),
}));
import { POST as reportCsp } from "@/app/api/csp-report/route";
import { POST as acceptWebhook } from "@/app/api/integrations/webhooks/[provider]/route";
import { exchangeBrokerToken } from "@/features/wechat/broker";

const encoder = new TextEncoder();
function streamRequest(chunks: Uint8Array[], headers?: HeadersInit, cancelFailure = false) {
  let reads = 0;
  const cancel = vi.fn(() => { if (cancelFailure) throw new Error("stream closed"); });
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[reads++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  const init: ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" } = { method: "POST", headers, body: stream, duplex: "half" };
  return { request: new NextRequest("https://example.test/endpoint", init), cancel, reads: () => reads };
}

beforeEach(() => {
  database.channel.mockReset().mockResolvedValue({ data: { status: "enabled", secret_ref: "UNIT_WEBHOOK_SECRET", degraded_until: null }, error: null });
  database.receipt.mockReset().mockResolvedValue({ data: "fixture-receipt", error: null });
  vi.stubEnv("UNIT_WEBHOOK_SECRET", "fixture-webhook-secret");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("bounded request text", () => {
  it("preserves Request.text UTF-8 and BOM decoding across byte boundaries at the exact limit", async () => {
    const bytes = encoder.encode('\ufeff{"title":"数学𠮷"}\r\n');
    const expected = await new Request("https://example.test", { method: "POST", body: bytes }).text();
    const fixture = streamRequest([...bytes].map(byte => new Uint8Array([byte])));
    expect(await readLimitedRequestText(fixture.request, bytes.length)).toBe(expected);
    expect(fixture.request.body?.locked).toBe(false);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("cancels an oversized stream without trusting Content-Length %s", async (length) => {
    const fixture = streamRequest([encoder.encode("数学"), encoder.encode("x"), encoder.encode("unread")],
      length ? { "content-length": length } : undefined);
    await expect(readLimitedRequestText(fixture.request, 6)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.reads()).toBe(2);
    expect(fixture.request.body?.locked).toBe(false);
  });

  it("rejects an oversized declared body before pulling chunks", async () => {
    const fixture = streamRequest([encoder.encode("unread")], { "content-length": "100" });
    await expect(readLimitedRequestText(fixture.request, 6)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.reads()).toBe(0);
  });

  it("retains the size error when cancellation fails and accepts an absent body", async () => {
    const fixture = streamRequest([encoder.encode("oversized")], undefined, true);
    await expect(readLimitedRequestText(fixture.request, 1)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(fixture.request.body?.locked).toBe(false);
    expect(await readLimitedRequestText(new Request("https://example.test"), 1)).toBe("");
  });
});

describe("public request limits", () => {
  it("keeps CSP's 204 response and skips logging an oversized stream", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = streamRequest([new Uint8Array(8193), encoder.encode("unread")]);
    expect((await reportCsp(fixture.request)).status).toBe(204);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    const valid = streamRequest([encoder.encode('{"csp-report":{"effective-directive":"script-src"}}')]);
    expect((await reportCsp(valid.request)).status).toBe(204);
    expect(JSON.parse(warn.mock.calls[0][0] as string).directive).toBe("script-src");
  });

  function webhookHeaders(body: string, length?: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      "x-mathin-event-id": "fixture-event",
      "x-mathin-timestamp": timestamp,
      "x-mathin-signature": createHmac("sha256", "fixture-webhook-secret").update(`${timestamp}.fixture-event.${body}`).digest("hex"),
      ...(length ? { "content-length": length } : {}),
    };
  }
  const context = { params: Promise.resolve({ provider: "fixture" }) };

  it("cancels a webhook with an oversized declared body before the channel lookup", async () => {
    const fixture = streamRequest([encoder.encode("unread")], webhookHeaders("", String(256 * 1024 + 1)));
    expect((await acceptWebhook(fixture.request, context)).status).toBe(413);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.reads()).toBe(0);
    expect(database.channel).not.toHaveBeenCalled();
    expect(database.receipt).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("rejects oversized webhook bytes before signature/receipt processing with length %s", async (length) => {
    const fixture = streamRequest([new Uint8Array(256 * 1024), encoder.encode("x"), encoder.encode("unread")], webhookHeaders("", length));
    const result = await acceptWebhook(fixture.request, context);
    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE" });
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.reads()).toBe(2);
    expect(database.receipt).not.toHaveBeenCalled();
  });

  it("preserves signed webhook whitespace and multibyte text, and rejects a changed signature", async () => {
    const body = '{ "title": "数学𠮷" }\r\n';
    const bytes = encoder.encode(body);
    const fixture = streamRequest([...bytes].map(byte => new Uint8Array([byte])), webhookHeaders(body));
    const result = await acceptWebhook(fixture.request, context);
    expect(result.status).toBe(202);
    expect(database.receipt).toHaveBeenCalledWith("accept_webhook_receipt", expect.objectContaining({
      p_payload: { title: "数学𠮷" }, p_payload_digest: createHash("sha256").update(body).digest("hex"),
    }));
    database.receipt.mockClear();
    const invalid = streamRequest([bytes], webhookHeaders("different"));
    expect((await acceptWebhook(invalid.request, context)).status).toBe(401);
    expect(database.receipt).not.toHaveBeenCalled();
  });

  it("keeps the broker invalid_request response while stopping before the rest of an oversized token body", async () => {
    const fixture = streamRequest([new Uint8Array(8193), encoder.encode("unread")], { "content-type": "application/x-www-form-urlencoded" });
    const result = await exchangeBrokerToken(fixture.request);
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "invalid_request" });
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(database.receipt).not.toHaveBeenCalled();
    expect(database.channel).not.toHaveBeenCalled();
  });
});
