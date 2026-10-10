import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ authorize: vi.fn(), from: vi.fn(), filter: vi.fn(), eq: vi.fn(), range: vi.fn(),
  rpc: vi.fn(), form: vi.fn(), required: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/features/parent-portal/server", async original => ({ ...await original<object>(), authorize: h.authorize }));
vi.mock("@/features/parent-portal/onboarding-server", () => ({ readFamilyForm: h.form, needsFamilyOnboarding: h.required,
  policies: async () => ({ privacyVersion: "v1", childrenPrivacyVersion: "v1", policyText: { zh: {}, en: {} } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));
import { registrationsGet, registrationsPost } from "@/features/participant-portal/registration-server";
import { projectRegistration } from "@/features/participant-portal/registration-projection";
import { PortalError } from "@/features/parent-portal/server";
import { DEFAULT_FAMILY_FORM } from "../contracts/participant-api/onboarding";
const owner = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const family = { parentName: "Submitted contact", relation: "mother", childName: "Submitted participant", gender: "female",
  grade: 3, school: "Submitted school", interests: [], formVersion: 2, location: { status: "declined" },
  privacyVersion: "v1", childrenPrivacyVersion: "v1", consent: true };
const row = { id, intake_kind: "family", created_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-01T00:01:00Z",
  form_snapshot: DEFAULT_FAMILY_FORM, answers: family };
const request = (query = "") => new Request("https://example.test/api/v1/participant/registrations" + query);
const post = (value: unknown) => new Request(request().url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => {
  vi.clearAllMocks(); h.rows = [row]; h.required.mockResolvedValue(false);
  h.authorize.mockResolvedValue({ user: { id: owner }, db: { rpc: h.rpc } });
  h.rpc.mockResolvedValue({ data: { id, participantId: null, participantIds: [], grade: 3 }, error: null });
  h.from.mockImplementation(() => {
    const q = { select: () => q, eq: (...args: unknown[]) => { h.eq(...args); return q; }, not: () => q,
      or: (value: unknown) => { h.filter(value); return q; }, order: () => q,
      range: (...args: unknown[]) => { h.range(...args); return Promise.resolve({ data: h.rows, error: null }); },
      maybeSingle: async () => ({ data: h.rows[0] || null, error: null }) };
    return q;
  });
});
describe("account-owned participation registrations", () => {
  it("requires authorization before reading any registration or private form", async () => {
    h.authorize.mockRejectedValue(new PortalError("UNAUTHENTICATED"));
    for (const query of ["", "?resource=form", "?resource=receipt&id=" + id])
      await expect(registrationsGet(request(query))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(h.from).not.toHaveBeenCalled(); expect(h.form).not.toHaveBeenCalled();
  });
  it("scopes both ledger kinds to the authenticated owner with bounded pagination", async () => {
    await registrationsGet(request("?page=2&userId=" + id));
    expect(h.filter).toHaveBeenCalledWith(`and(intake_kind.in.(family,family_update),registration_user_id.eq.${owner},completed_at.not.is.null),and(intake_kind.eq.generic,submitted_by.eq.${owner})`);
    expect(h.range).toHaveBeenCalledWith(25, 50);
    await expect(registrationsGet(request("?page=-1"))).rejects.toThrow();
  });
  it("never accepts another owner when recovering an uncertain submission", async () => {
    h.rows = [];
    expect(await (await registrationsGet(request("?resource=receipt&id=" + id + "&userId=" + id))).json()).toBeNull();
    expect(h.eq).toHaveBeenCalledWith("request_id", id);
    expect(h.eq).toHaveBeenCalledWith("registration_user_id", owner);
    expect(h.eq).toHaveBeenCalledWith("intake_kind", "family_update");
  });
  it("projects submitted field snapshots without proofs, coordinates or staff notes", () => {
    const projected = projectRegistration({ ...row, answers: { ...family, location: { latitude: 12.345 },
      lease_key: "private-proof", verified_details: { notes: "internal-staff-note" } } });
    const json = JSON.stringify(projected);
    expect(json).toContain("Submitted participant"); expect(json).toContain("Submitted contact");
    for (const privateValue of ["private-proof", "12.345", "internal-staff-note", "privacyVersion", "consent"])
      expect(json).not.toContain(privateValue);
    expect(projected.submittedAt).toBe(row.completed_at);
  });
  it("does not expose hidden fields or unconfigured generic answers", () => {
    const hidden = projectRegistration({ ...row, form_snapshot: { ...DEFAULT_FAMILY_FORM,
      fields: DEFAULT_FAMILY_FORM.fields.map(field => field.id === "school" ? { ...field, mode: "hidden" } : field) } });
    expect(JSON.stringify(hidden)).not.toContain("Submitted school");
    const generic = projectRegistration({ ...row, intake_kind: "generic", form_snapshot: { fields: [
      { id: "choice", label: { zh: "选项", en: "Choice" }, options: [{ id: "one", label: { zh: "第一项", en: "First" } }] }] },
      answers: { choice: "one", secret: "unconfigured-secret" } });
    expect(generic.sections[0].fields[0].value.en).toBe("First");
    expect(JSON.stringify(generic)).not.toContain("unconfigured-secret");
  });
  it("delegates version and replay checks to the owner-authenticated transaction", async () => {
    expect(await (await registrationsPost(post({ id, family }))).json()).toMatchObject({ id });
    expect(h.rpc).toHaveBeenCalledWith("miniapp_submit_registration_update", { p_request_id: id, p_version: 2, p_answers: family });
    expect(h.form).not.toHaveBeenCalled();
  });
  it("rejects injected identity fields and propagates transaction permission denials", async () => {
    await expect(registrationsPost(post({ id, family, userId: owner }))).rejects.toThrow();
    await expect(registrationsPost(post({ id, family: { ...family, familyId: id } }))).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    await expect(registrationsPost(post({ id, family }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
