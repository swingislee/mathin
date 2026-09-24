// @vitest-environment jsdom
import React, { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { EmailLoginInput } from "@/components/auth/LoginIdentifierFields";
import { emailInputIdentifier } from "@/components/auth/login-identifier-input";

let host: HTMLDivElement;
let root: Root;
function EmailForm() {
  const [value, onChange] = useState({ localPart: "member", domain: "qq.com" });
  return createElement("form", null,
    createElement(EmailLoginInput, { id: "email", disabled: false, autoFocus: false, value, onChange }),
    createElement("output", { "data-identifier": true }, emailInputIdentifier(value)));
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", timeZone: "UTC", messages: en, children: createElement(EmailForm) })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const input = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
async function enter(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(name), value);
    input(name).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("editable email domain inside the login form", () => {
  it("keeps every typed character after clearing a common provider", async () => {
    await enter("emailDomain", "");
    for (const letter of "school.example") {
      const expected = input("emailDomain").value + letter;
      await enter("emailDomain", expected);
      expect(input("emailDomain").value).toBe(expected);
    }
    expect(host.querySelector("output")!.textContent).toBe("member@school.example");
  });
  it("retains a custom domain pasted as part of a complete email", async () => {
    await enter("emailLocalPart", "parent+tag@school.example");
    expect(input("emailLocalPart").value).toBe("parent+tag");
    expect(input("emailDomain").value).toBe("school.example");
    expect(host.querySelector("output")!.textContent).toBe("parent+tag@school.example");
  });
  it("can choose a preset and then edit it without changing the username", async () => {
    await enter("emailDomain", "school.example");
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "outlook.com"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(input("emailDomain").value).toBe("outlook.com");
    await enter("emailDomain", "outlook.co");
    expect(input("emailDomain").value).toBe("outlook.co");
    expect(input("emailLocalPart").value).toBe("member");
  });
});
