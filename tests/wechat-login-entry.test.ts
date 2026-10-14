// @vitest-environment jsdom
import React, { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";

const h = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/app/[locale]/(auth)/actions", () => ({ submitLogin: vi.fn() }));
vi.mock("@/features/wechat/actions", () => ({ beginWechatLogin: vi.fn() }));
vi.mock("@/components/auth/LoginDialogProvider", () => ({ useLoginDialog: () => h.open }));
vi.mock("@/components/auth-form", () => ({ AuthForm: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, onNavigate, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string | { pathname: string; query: Record<string, string> }; onNavigate?: () => void }) => {
    void onNavigate;
    const target = typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`;
    return createElement("a", { ...props, href: target });
  },
}));
import { LoginCard } from "@/components/auth/LoginCard";
import { LoginLink } from "@/components/auth/LoginLink";
import LoginPage from "@/app/[locale]/(auth)/login/page";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.open.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(child: React.ReactNode) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", timeZone: "UTC", messages: en, children: child })));
}
const password = () => host.querySelector('input[name="password"]');
const activeMethod = () => host.querySelector('[aria-label="Choose a sign-in method"] [data-state="active"]')?.textContent;

describe("existing-account sign-in after a WeChat scan", () => {
  it("shows password fields immediately when the guest entry requests password sign-in", async () => {
    await render(createElement(LoginCard, { locale: "en", wechatAvailable: true, initialMethod: "password", next: "/en/dashboard/account-security?section=identities" }));
    expect(activeMethod()).toBe("Account password");
    expect(password()?.getAttribute("autocomplete")).toBe("current-password");
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector('button[aria-label="Continue with WeChat"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/en/dashboard/account-security?section=identities");
  });

  it("lets a regular visitor switch directly from WeChat to password sign-in", async () => {
    await render(createElement(LoginCard, { locale: "en", wechatAvailable: true }));
    expect(activeMethod()).toBe("Continue with WeChat");
    expect(password()).toBeNull();
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === "Account password")!;
    await act(async () => tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(activeMethod()).toBe("Account password");
    expect(password()).not.toBeNull();
  });

  it.each([{ wechatAvailable: false }, { wechatAvailable: true, error: "credentials" }])("keeps password recovery accessible for %o", async (props) => {
    await render(createElement(LoginCard, { locale: "en", ...props }));
    expect(activeMethod()).toBe("Account password");
    expect(password()).not.toBeNull();
    expect(host.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it("carries the password choice through both the dialog action and the real fallback URL", async () => {
    const next = "/en/dashboard/account-security?section=identities";
    await render(createElement(LoginLink, { method: "password", next }, "Existing account"));
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    const url = new URL(link.href);
    expect(url.searchParams.get("method")).toBe("password");
    expect(url.searchParams.get("next")).toBe(next);
    await act(async () => link.click());
    expect(h.open).toHaveBeenCalledWith(next, link, "password");

    const page = await LoginPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ method: url.searchParams.get("method")!, next }) });
    expect(page.props).toMatchObject({ loginMethod: "password", next });
  });
});
