import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ resolve: vi.fn(), request: vi.fn(), status: 200, type: "application/json", body: '{"ok":true}' }));
vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ resolve4: network.resolve }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("@/features/parent-portal/server", () => ({ PortalError: class extends Error {} }));
import { callProvider, publicProviderAddress, providerActor, providerBindingKey } from "@/features/participant-portal/provider-transport";
import { publicWebsiteUrl, miniappExperienceSchema } from "@/features/school/miniapp-settings/experience-schema";
import { defaultMiniappExperience } from "../contracts/participant-api/miniapp-experience-templates";
import { defaultMiniappSettings } from "../contracts/participant-api/miniapp-settings";
import { experienceIssues } from "../contracts/participant-api/miniapp-experience-validation";
import { cleanExperienceAnswers, experienceAnswerErrors, type ExperienceForm } from "../contracts/participant-api/miniapp-experience";
const config = { endpoint: "https://booking.example.com/rpc", token: "unit-fixture-provider-credential", identityKey: "unit-fixture-identity-key-with-minimum-length" };
const credentialFixture = new URL(config.endpoint);
credentialFixture.username = "fixture-user"; credentialFixture.password = "fixture-password";
beforeEach(() => {
  network.resolve.mockReset().mockResolvedValue(["93.184.216.34"]); network.request.mockReset();
  network.status = 200; network.type = "application/json"; network.body = '{"ok":true}';
  network.request.mockImplementation((_url, _options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: network.status, headers: { "content-type": network.type }, resume: vi.fn(), destroy: vi.fn() });
      callback(res); queueMicrotask(() => { res.emit("data", Buffer.from(network.body)); res.emit("end"); });
    };
    return request;
  });
});
describe("provider transport boundaries", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "198.18.0.1", "224.0.0.1"])("rejects non-public address %s", address => expect(publicProviderAddress(address)).toBe(false));
  it.each(["http://booking.example.com", "https://127.0.0.1", "https://[::1]", "https://localhost", credentialFixture.href, "https://booking.example.com/?token=secret"])("rejects unsafe endpoint %s", url => expect(publicWebsiteUrl(url)).toBe(false));
  it("rejects a mixed public and private DNS answer before sending credentials", async () => {
    network.resolve.mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
    await expect(callProvider(config, "capabilities.read", {})).rejects.toThrow("UNAVAILABLE"); expect(network.request).not.toHaveBeenCalled();
  });
  it("pins the validated address while retaining TLS hostname verification", async () => {
    await expect(callProvider(config, "capabilities.read", {})).resolves.toEqual({ ok: true });
    const options = network.request.mock.calls[0][1]; expect(options.family).toBe(4); expect(options.servername).toBe("booking.example.com");
    const callback = vi.fn(); options.lookup("booking.example.com", {}, callback); expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.rejectUnauthorized).not.toBe(false); expect(options.agent).toBe(false);
  });
  it("does not follow redirects and bounds provider responses", async () => {
    network.status = 302; await expect(callProvider(config, "capabilities.read", {})).rejects.toThrow("UNAVAILABLE"); expect(network.request).toHaveBeenCalledTimes(1);
    network.status = 200; network.body = '"' + "x".repeat(512 * 1024) + '"'; await expect(callProvider(config, "capabilities.read", {})).rejects.toThrow("TOO_LARGE");
  });
  it("separates provider identities and pins booking history to its identity mapping", () => {
    expect(providerActor(config, "participant-a")).not.toBe(providerActor(config, "participant-b"));
    expect(providerBindingKey(config)).toBe(providerBindingKey({ ...config, token: "replacement-credential" }));
    expect(providerBindingKey(config)).not.toBe(providerBindingKey({ ...config, identityKey: "changed-identity-key" }));
  });
});
describe("configuration and conditional answers", () => {
  it("ships usable templates and rejects executable configuration", () => {
    const experience = defaultMiniappExperience(defaultMiniappSettings());
    expect(miniappExperienceSchema.safeParse(experience).success).toBe(true); expect(experienceIssues(experience)).toEqual([]);
    const unsafe = structuredClone(experience); Object.assign(unsafe.pages[0].blocks[0], { script: "unexpected" });
    expect(miniappExperienceSchema.safeParse(unsafe).success).toBe(false);
  });
  it("removes hidden dependent values before evaluating the next condition", () => {
    const base = { label: { zh: "名称", en: "Name" }, help: { zh: "", en: "" }, placeholder: { zh: "", en: "" }, required: true, options: [] };
    const form: ExperienceForm = { id: "form", version: 1, title: base.label, introduction: base.help, submitLabel: base.label, successMessage: base.help, purpose: "request", audience: "signedIn", enabled: true,
      groups: [{ id: "group", title: base.label, description: base.help, repeat: false, minEntries: 1, maxEntries: 1, fields: [
        { ...base, id: "first", type: "text" }, { ...base, id: "second", type: "text", visibleWhen: { fieldId: "first", operator: "equals", value: "yes" } },
        { ...base, id: "third", type: "text", visibleWhen: { fieldId: "second", operator: "answered", value: "" } },
      ] }] };
    const clean = cleanExperienceAnswers(form, { group: [{ first: "no", second: "stale", third: "private" }] });
    expect(clean).toEqual({ group: [{ first: "no" }] }); expect(experienceAnswerErrors(form, clean)).toEqual([]);
  });
});
