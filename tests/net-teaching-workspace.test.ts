// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { NetTeachingWorkspace } from "@/features/tools/net-teaching/NetTeachingWorkspace";
import { createDefaultPaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { createDefaultSolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { netInitialState, type NetTeachingInitial } from "@/features/tools/net-teaching/contract";

const workspace = vi.hoisted(() => ({ current: null as null | {
  initial: unknown; onSnapshot: (next: unknown) => void; workspaceSelector?: ReactNode; modeSelector?: ReactNode;
  runtime?: { state?: unknown }; readOnly?: boolean;
} }));
vi.mock("next/dynamic", () => ({ default: () => function Stub(props: NonNullable<typeof workspace.current>) {
  workspace.current = props; return createElement(Fragment, null, props.workspaceSelector, props.modeSelector);
} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const paper = (): Extract<NetTeachingInitial, { mode: "free-paper" }> => ({ mode: "free-paper", data: createDefaultPaperFoldingSnapshot() });
async function render(props: Parameters<typeof NetTeachingWorkspace>[0]) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: createElement(NetTeachingWorkspace, props) })));
}
async function select(label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Folding workspace"]')!.click());
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
describe("one folding tool hosts distinct teaching spaces", () => {
  it("switches modes through a compact nonmodal control and retains each prepared scene", async () => {
    const initial = paper(), capture = vi.fn(); await render({ initial, onSnapshot: capture });
    const edited = { ...createDefaultPaperFoldingSnapshot(), labelsVisible: false };
    await act(async () => workspace.current!.onSnapshot(edited));
    expect(capture.mock.lastCall![0]).toEqual({ mode: "free-paper", data: edited });
    const unchangedOrigin = workspace.current!.initial;
    await act(async () => workspace.current!.onSnapshot(edited));
    expect(workspace.current!.initial).toBe(unchangedOrigin);
    await select("Cuboid and prism");
    expect(host.querySelector("[data-net-teaching-mode]")!.getAttribute("data-net-teaching-mode")).toBe("solid-net");
    expect(workspace.current!.initial).toEqual(createDefaultSolidNetsSnapshot());
    await select("Free paper");
    expect(workspace.current!.initial).toEqual(edited);
    expect(initial.data.labelsVisible).toBe(true);
  });
  it("waits for authoritative classroom mode changes and retains the current workspace on failure", async () => {
    const initial = paper(), fail = vi.fn().mockRejectedValue(new Error("offline"));
    await render({ initial, runtime: { state: netInitialState(initial), onChange: fail } });
    await select("Cuboid and prism");
    expect(fail).toHaveBeenCalledOnce();
    expect(fail.mock.lastCall![0].mode).toBe("solid-net");
    expect(host.querySelector("[data-net-teaching-mode]")!.getAttribute("data-net-teaching-mode")).toBe("free-paper");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("not saved");
    const incoming = { mode: "solid-net" as const, data: createDefaultSolidNetsSnapshot("triangular-prism") };
    await render({ initial, runtime: { state: incoming } });
    expect(workspace.current!.runtime!.state).toEqual(incoming.data);
    expect(workspace.current!.readOnly).toBe(true);
  });
  it("locks the mode switch during a paper drag without replacing its initial snapshot", async () => {
    await render({ initial: paper() }); const origin = workspace.current!.initial;
    await act(async () => workspace.current!.onSnapshot(null));
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Folding workspace"]')!.disabled).toBe(true);
    expect(workspace.current!.initial).toBe(origin);
    await act(async () => workspace.current!.onSnapshot(createDefaultPaperFoldingSnapshot()));
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Folding workspace"]')!.disabled).toBe(false);
  });
});
