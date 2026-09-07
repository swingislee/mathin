import { act, createElement, StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebGLRenderer } from "three";
import { useCubeDrafts, type CubeDraftLibrary } from "@/features/tools/spatial-lab/useCubeDrafts";
import { CubeDraftError, cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import type { CubeDraftOverview, CubeDraftStore, CubeSavedDraft } from "@/features/tools/spatial-lab/cube-structures-draft-store";
import { createCubeSession, operateCubeSession, type CubeWorkbenchSession } from "@/features/tools/spatial-lab/cube-structures-session";

const initial = () => createCubeSession([]);
const saved: CubeSavedDraft = { id: "20000000-0000-4000-8000-000000000001", name: "保存的草稿", revision: 1,
  createdAt: "2026-09-07T01:00:00Z", updatedAt: "2026-09-07T01:00:00Z", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 3) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

async function setup(store: CubeDraftStore) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  let library!: CubeDraftLibrary; let current!: CubeWorkbenchSession; let edit!: (session: CubeWorkbenchSession) => void;
  function Probe() {
    const [prepared, setPrepared] = useState(initial);
    const result = useCubeDrafts({ prepared, store, getIdentity: () => 5, onOpen: (draft) => setPrepared(draft.snapshot.session) });
    useLayoutEffect(() => { library = result; current = prepared; edit = setPrepared; }, [result, prepared]);
    return null;
  }
  await act(async () => { root.render(createElement(StrictMode, null, createElement(Probe))); });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { library: () => library, current: () => current, edit: (session: CubeWorkbenchSession) => act(async () => edit(session)) };
}
function storeMock() {
  return { overview: vi.fn<CubeDraftStore["overview"]>().mockResolvedValue({ drafts: [saved], lastOpenedId: null }),
    read: vi.fn<CubeDraftStore["read"]>().mockResolvedValue(saved), save: vi.fn<CubeDraftStore["save"]>().mockResolvedValue(saved), remember: vi.fn<CubeDraftStore["remember"]>() };
}
describe("account draft editor lifecycle", () => {
  it("restores after asynchronous list/detail reads under StrictMode without marking content dirty", async () => {
    const store = storeMock(); const list = deferred<CubeDraftOverview>();
    store.overview.mockReturnValue(list.promise);
    const rig = await setup(store); expect(rig.library().loading).toBe(true);
    await act(async () => list.resolve({ drafts: [saved], lastOpenedId: saved.id }));
    expect(rig.current()).toEqual(saved.snapshot.session); expect(rig.library().current?.id).toBe(saved.id);
    expect(rig.library().loading).toBe(false); expect(rig.library().dirty).toBe(false);
  });
  it("retains edited content and revision when a save conflicts", async () => {
    const store = storeMock(); store.overview.mockResolvedValue({ drafts: [saved], lastOpenedId: saved.id });
    const rig = await setup(store);
    const changed = operateCubeSession(rig.current(), { kind: "axes", visible: false }); await rig.edit(changed);
    store.save.mockRejectedValueOnce(new CubeDraftError("conflict"));
    await act(async () => { expect(await rig.library().save()).toBe(false); });
    expect(rig.current()).toBe(changed); expect(rig.library().dirty).toBe(true); expect(rig.library().current?.revision).toBe(1);
    expect(rig.library().error).toBe("conflict");
  });
  it("does not overwrite editing that occurs while a save is pending", async () => {
    const store = storeMock(); const saving = deferred<CubeSavedDraft>(); store.save.mockReturnValue(saving.promise);
    const rig = await setup(store); await act(async () => rig.library().setName("保存的草稿"));
    let pending!: Promise<boolean>; await act(async () => { pending = rig.library().save(); });
    const later = operateCubeSession(rig.current(), { kind: "axes", visible: false }); await rig.edit(later);
    await act(async () => { saving.resolve({ ...saved, snapshot: cubeDraftSnapshot(initial(), 5) }); await pending; });
    expect(rig.current()).toBe(later); expect(rig.library().dirty).toBe(true);
    expect(store.remember).toHaveBeenCalledWith(saved.id);
  });
  it("keeps current work on a failed open and never remembers the failed target", async () => {
    const store = storeMock(); const rig = await setup(store); const original = rig.current();
    store.read.mockRejectedValueOnce(new CubeDraftError("unavailable"));
    await act(async () => { expect(await rig.library().open(saved.id)).toBe(false); });
    expect(rig.current()).toBe(original); expect(store.remember).not.toHaveBeenCalled();
  });
  it("allows login recovery by list refresh without replacing anonymous work", async () => {
    const store = storeMock(); store.overview.mockRejectedValue(new CubeDraftError("auth-required"));
    const rig = await setup(store); expect(rig.library().accountReady).toBe(false);
    const changed = operateCubeSession(rig.current(), { kind: "axes", visible: false }); await rig.edit(changed);
    store.overview.mockResolvedValue({ drafts: [saved], lastOpenedId: saved.id });
    await act(async () => { await rig.library().refresh(); });
    expect(rig.library().accountReady).toBe(true); expect(rig.library().error).toBeNull(); expect(rig.current()).toBe(changed); expect(store.read).not.toHaveBeenCalled();
  });
  it("blocks save-as after account switching and preserves the original workspace", async () => {
    const store = storeMock(); const rig = await setup(store);
    await act(async () => rig.library().setName("保留现场")); const original = rig.current();
    store.save.mockRejectedValueOnce(new CubeDraftError("account-changed"));
    await act(async () => { await rig.library().save(true); });
    expect(rig.library().accountReady).toBe(false); expect(rig.current()).toBe(original);
    await act(async () => { expect(await rig.library().save(true)).toBe(false); });
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
