import { beforeEach, describe, expect, it, vi } from "vitest";
import { dialogReturnTo, dialogRouterHref, isPlainLoginClick, type LoginState } from "@/components/auth/login-contract";
import { emailInputIdentifier, mainlandPhoneInput, phoneInputIdentifier, splitEmailInput } from "@/components/auth/login-identifier-input";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ signIn: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { login, submitLogin } from "@/app/[locale]/(auth)/actions";

const initial: LoginState = { ok: false };
function form(username = "Member@Example.com", presentation = "dialog", next = "/en/notebook?tab=mine#notes") {
  const input = new FormData();
  input.set("username", username); input.set("password", "test-only-password");
  input.set("locale", "en"); input.set("presentation", presentation); input.set("next", next);
  return input;
}
beforeEach(() => {
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.createClient.mockReset().mockResolvedValue({ auth: { signInWithPassword: h.signIn } });
});

describe("password login presentation", () => {
  it("returns dialog success using the existing normalized email/password login", async () => {
    await expect(submitLogin(initial, form())).resolves.toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledWith({ email: "member@example.com", password: "test-only-password" });
  });
  it("uses the same phone normalization without creating or merging accounts", async () => {
    await expect(submitLogin(initial, form("138 0000 0000"))).resolves.toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledWith({ phone: "+8613800000000", password: "test-only-password" });
  });
  it("submits a pasted full email with a custom domain through the existing login action", async () => {
    const parts = splitEmailInput(" Member+tag@School.Example ", "qq.com");
    expect(parts).toEqual({ localPart: "Member+tag", domain: "school.example" });
    await expect(submitLogin(initial, form(emailInputIdentifier(parts)))).resolves.toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledWith({ email: "member+tag@school.example", password: "test-only-password" });
  });
  it("retains the selected email provider while editing the username", async () => {
    const parts = splitEmailInput(" member ", "outlook.com");
    await expect(submitLogin(initial, form(emailInputIdentifier(parts)))).resolves.toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledWith({ email: "member@outlook.com", password: "test-only-password" });
  });
  it("rejects incomplete or malformed split email input before contacting Auth", async () => {
    for (const parts of [{ localPart: "", domain: "qq.com" }, { localPart: "member", domain: "" }, splitEmailInput("member@@example.com", "qq.com")]) {
      await expect(submitLogin(initial, form(emailInputIdentifier(parts)))).resolves.toEqual({ ok: false, code: "credentials" });
    }
    expect(h.signIn).not.toHaveBeenCalled();
  });
  it.each(["13800000000", "+86 138 0000 0000", "0086 (138) 0000-0000", "8613800000000"])("submits one country prefix for pasted phone %s", async (input) => {
    const national = mainlandPhoneInput(input);
    expect(national).toBe("13800000000");
    await expect(submitLogin(initial, form(phoneInputIdentifier(national)))).resolves.toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledWith({ phone: "+8613800000000", password: "test-only-password" });
  });
  it("keeps empty and unsupported phone input invalid with the +86-only picker", async () => {
    for (const phone of ["", "+86", "+1 415 555 2671"]) {
      await expect(submitLogin(initial, form(phoneInputIdentifier(phone)))).resolves.toEqual({ ok: false, code: "credentials" });
    }
    expect(h.signIn).not.toHaveBeenCalled();
  });
  it("keeps validation and provider failures in the card and does not reveal provider details", async () => {
    await expect(submitLogin(initial, form("invalid"))).resolves.toEqual({ ok: false, code: "credentials" });
    expect(h.signIn).not.toHaveBeenCalled();
    h.signIn.mockResolvedValue({ error: { status: 400, message: "private provider detail" } });
    await expect(submitLogin(initial, form())).resolves.toEqual({ ok: false, code: "credentials" });
    await expect(submitLogin(initial, form("a@example.com", "unknown"))).resolves.toEqual({ ok: false, code: "credentials" });
  });
  it("reports unavailable Auth without navigating away or returning exception details", async () => {
    h.createClient.mockRejectedValue(new Error("private connection detail"));
    await expect(submitLogin(initial, form())).resolves.toEqual({ ok: false, code: "unavailable" });
  });
  it("preserves the protected-page return target after successful full-page login", async () => {
    await expect(submitLogin(initial, form("a@example.com", "page"))).rejects.toThrow("redirect:/en/notebook?tab=mine#notes");
    await expect(submitLogin(initial, form("a@example.com", "page", "https://outside.example/"))).rejects.toThrow("redirect:/en/dashboard");
  });
  it("keeps the original login action compatible, including its safe retry target", async () => {
    h.signIn.mockResolvedValue({ error: { status: 400 } });
    await expect(login(form("a@example.com", "page", "//outside.example"))).rejects.toThrow("redirect:/en/login?error=credentials&next=%2Fen%2Fdashboard");
  });
});

describe("voluntary login navigation", () => {
  it("retains the originating page, filters, hash and locale when no target is specified", () => {
    expect(dialogReturnTo(undefined, "/zh/games/sudoku?level=2#board", "zh")).toBe("/zh/games/sudoku?level=2#board");
    expect(dialogReturnTo(undefined, "/en", "en")).toBe("/en/");
    expect(dialogReturnTo("//outside.example", "/en/notebook", "en")).toBe("/en/notebook");
    expect(dialogReturnTo("/zh/dashboard", "/en/notebook", "en")).toBe("/en/notebook");
  });
  it("keeps native new-tab/modified clicks instead of opening a dialog", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainLoginClick(click)).toBe(true);
    for (const change of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      expect(isPlainLoginClick({ ...click, ...change })).toBe(false);
    }
    expect(isPlainLoginClick(click, "_blank")).toBe(false);
  });
  it("cannot turn a localized next into a protocol-relative router destination", () => {
    expect(dialogRouterHref("/zh/dashboard/account-security?section=identities", "zh")).toBe("/dashboard/account-security?section=identities");
    for (const value of ["/zh//outside.example", "/zh/..//outside.example", "/zh/\\outside.example", "https://outside.example/"]) {
      expect(dialogRouterHref(value, "zh")).toBe("/");
    }
  });
});
