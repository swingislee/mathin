import { describe, expect, it, vi } from "vitest";
import { createCubeDraftStore, type CubeSavedDraft } from "@/features/tools/spatial-lab/cube-structures-draft-store";
import { CubeDraftError, cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const draft: CubeSavedDraft = { id: "20000000-0000-4000-8000-000000000001", name: "我的结构", revision: 2,
  createdAt: "2026-09-07T01:00:00+00:00", updatedAt: "2026-09-07T02:00:00+00:00", snapshot: cubeDraftSnapshot(createCubeSession([]), 0) };
const envelope = (data: unknown, accountId = owner) => Response.json({ data, accountId });
function setup() {
  let url = new URL(`http://example.test/zh/tools/spatial-lab?cubeDraft=${draft.id}`);
  const fetcher = vi.fn<typeof fetch>();
  const store = createCubeDraftStore({ fetcher, readUrl: () => url, replaceUrl: (next) => { url = next; } });
  return { store, fetcher, url: () => url };
}
describe("account draft transport", () => {
  it("lists only metadata, restores saved URLs and sends a versioned same-account update", async () => {
    const rig = setup();
    rig.fetcher.mockResolvedValueOnce(envelope([draft])).mockResolvedValueOnce(envelope(draft)).mockResolvedValueOnce(envelope({ ...draft, revision: 3 }));
    expect((await rig.store.overview()).lastOpenedId).toBe(draft.id);
    expect(await rig.store.read(draft.id)).toEqual(draft);
    expect((await rig.store.save({ name: draft.name, id: draft.id, expectedRevision: 2, snapshot: draft.snapshot })).revision).toBe(3);
    const options = rig.fetcher.mock.calls[2][1]!;
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", headers: { "x-cube-account": owner } });
    expect(JSON.parse(options.body as string)).toMatchObject({ id: draft.id, expectedRevision: 2 });
    rig.store.remember(null); expect(rig.url().searchParams.has("cubeDraft")).toBe(false);
    rig.store.remember(draft.id); expect(rig.url().searchParams.get("cubeDraft")).toBe(draft.id);
  });
  it("uses a new ID and revision zero for save-as, without sending an owner field", async () => {
    const rig = setup(); rig.fetcher.mockResolvedValueOnce(envelope([])).mockResolvedValueOnce(envelope(draft));
    await rig.store.overview(); await rig.store.save({ name: draft.name, snapshot: draft.snapshot });
    const sent = JSON.parse(rig.fetcher.mock.calls[1][1]!.body as string);
    expect(sent.expectedRevision).toBe(0); expect(sent.id).not.toBe(draft.id); expect(sent).not.toHaveProperty("owner_id");
  });
  it("requires initial account discovery and rejects account switches even with a successful response", async () => {
    const rig = setup();
    await expect(rig.store.save({ name: draft.name, snapshot: draft.snapshot })).rejects.toEqual(new CubeDraftError("auth-required"));
    expect(rig.fetcher).not.toHaveBeenCalled();
    rig.fetcher.mockResolvedValueOnce(envelope([draft])).mockResolvedValueOnce(envelope([], other));
    await rig.store.overview(); await expect(rig.store.overview()).rejects.toEqual(new CubeDraftError("account-changed"));
    expect(rig.fetcher.mock.calls[1][1]!.headers).toMatchObject({ "x-cube-account": owner });
  });
  it.each(["auth-required", "account-security", "account-changed", "conflict", "missing", "limit"] as const)("preserves the %s failure code", async (code) => {
    const rig = setup(); rig.fetcher.mockResolvedValueOnce(Response.json({ code }, { status: 409 }));
    await expect(rig.store.overview()).rejects.toEqual(new CubeDraftError(code));
  });
  it("retains the selected URL when a read fails and rejects malformed saved content", async () => {
    const rig = setup(); rig.fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(rig.store.read(draft.id)).rejects.toEqual(new CubeDraftError("unavailable"));
    expect(rig.url().searchParams.get("cubeDraft")).toBe(draft.id);
    rig.fetcher.mockResolvedValueOnce(envelope({ ...draft, snapshot: {} }));
    await expect(rig.store.read(draft.id)).rejects.toEqual(new CubeDraftError("invalid"));
  });
});
