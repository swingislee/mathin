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

describe("existing-account sign-in after a WeChat scan", () => {
  it.each([false, true])("shows password and WeChat sign-in together, dialog=%s", async (dialog) => {
    const next = "/en/dashboard/account-security?section=identities";
    await render(createElement(LoginCard, { locale: "en", wechatAvailable: true, dialog, next }));
    expect(password()?.getAttribute("autocomplete")).toBe("current-password");
    expect(host.querySelector("details")).toBeNull();
    const wechat = host.querySelector('button[aria-label="Continue with WeChat"]');
    expect(wechat).not.toBeNull();
    expect(password()!.compareDocumentPosition(wechat!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...host.querySelectorAll<HTMLInputElement>('input[name="next"]')].map(input => input.value)).toEqual([next, next]);
  });

  it.each([{ wechatAvailable: false }, { wechatAvailable: true, error: "credentials" }])("keeps password recovery accessible for %o", async (props) => {
    await render(createElement(LoginCard, { locale: "en", ...props }));
    expect(password()).not.toBeNull();
    expect(host.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it("preserves the binding destination through both the dialog action and the real fallback URL", async () => {
    const next = "/en/dashboard/account-security?section=identities";
    await render(createElement(LoginLink, { next }, "Existing account"));
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    const url = new URL(link.href);
    expect(url.searchParams.get("next")).toBe(next);
    await act(async () => link.click());
    expect(h.open).toHaveBeenCalledWith(next, link);

    const page = await LoginPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ next }) });
    expect(page.props).toMatchObject({ mode: "login", next });
  });
});
