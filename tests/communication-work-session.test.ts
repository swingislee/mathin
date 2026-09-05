import { describe, expect, it } from "vitest";
import { communicationFactWithOverride, nextUnprocessedCommunicationKey, reconcileCommunicationWorkSession } from "../src/features/school/communication-work-session";

type Row = { key: string; source: "contact" | "invitation" | "post"; value: { state: string; note?: string } };
const keyOf = (row: Row) => row.key;
const sameFact = (left: Row, right: Row) => left.source === right.source && left.value === right.value;
const base = { boundary: "today:mine:page1", selection: "uncontacted", keyOf, sameFact };

describe("communication work session", () => {
  it("keeps the selected person and position when first contact becomes a confirmed invitation", () => {
    const first: Row = { key: "lead:first", source: "contact", value: { state: "uncontacted" } };
    const second: Row = { key: "lead:second", source: "contact", value: { state: "uncontacted" } };
    const authorizedKeys = ["lead:first", "lead:second"];
    const initial = reconcileCommunicationWorkSession(null, { ...base, authorizedKeys, rows: [first, second], selectedRows: [first, second] });
    const confirmed: Row = { key: "lead:first", source: "invitation", value: { state: "confirmed" } };
    const updated = reconcileCommunicationWorkSession(initial, { ...base, authorizedKeys, rows: [confirmed, second], selectedRows: [second] });
    expect(updated.keys).toEqual(["lead:first", "lead:second"]);
    expect(updated.facts.get("lead:first")).toBe(confirmed);
    expect(reconcileCommunicationWorkSession(updated, { ...base, rows: [confirmed, second], selectedRows: [second] })).toBe(updated);
  });

  it("removes cached personal facts when the authoritative server page no longer permits the row", () => {
    const removed: Row = { key: "lead:private", source: "contact", value: { state: "contacted", note: "private phone and conversation" } };
    const visible: Row = { key: "post:visible", source: "post", value: { state: "waiting" } };
    const initial = reconcileCommunicationWorkSession(null, { ...base, authorizedKeys: [removed.key, visible.key], rows: [removed, visible], selectedRows: [removed, visible] });
    const refreshed = reconcileCommunicationWorkSession(initial, { ...base, authorizedKeys: [visible.key], rows: [visible], selectedRows: [visible] });
    expect(refreshed.keys).toEqual([visible.key]);
    expect(refreshed.facts.has(removed.key)).toBe(false);
    expect([...refreshed.facts.values()]).toEqual([visible]);
    const empty = reconcileCommunicationWorkSession(refreshed, { ...base, authorizedKeys: [], rows: [], selectedRows: [] });
    expect(empty.keys).toEqual([]);
    expect(empty.facts.size).toBe(0);
  });

  it("updates a historical correction without changing the current working order", () => {
    const old: Row = { key: "post:corrected", source: "post", value: { state: "waiting", note: "old note" } };
    const initial = reconcileCommunicationWorkSession(null, { ...base, rows: [old], selectedRows: [old] });
    const corrected = { ...old, value: { state: "waiting", note: "corrected note" } };
    const refreshed = reconcileCommunicationWorkSession(initial, { ...base, rows: [corrected], selectedRows: [corrected], authorizedKeys: [old.key] });
    expect(refreshed.keys).toEqual(initial.keys);
    expect(refreshed.facts.get(old.key)?.value.note).toBe("corrected note");
  });

  it("keeps saved rows during refresh without silently appending a newly matching person", () => {
    const saved: Row = { key: "lead:saved", source: "contact", value: { state: "contacted" } };
    const initial = reconcileCommunicationWorkSession(null, { ...base, rows: [saved], selectedRows: [saved] });
    const other: Row = { key: "lead:other", source: "contact", value: { state: "uncontacted" } };
    const refreshed = reconcileCommunicationWorkSession(initial, { ...base, rows: [other], selectedRows: [other] });
    expect(refreshed.keys).toEqual(["lead:saved"]);
    expect(refreshed.facts.get("lead:saved")).toBe(saved);
    const reselected = reconcileCommunicationWorkSession(refreshed, { ...base, selection: "new-explicit-filter", rows: [other], selectedRows: [other] });
    expect(reselected.keys).toEqual(["lead:other"]);
  });

  it("honors explicit sorting and date/page boundaries", () => {
    const a: Row = { key: "post:a", source: "post", value: { state: "waiting" } };
    const b: Row = { key: "lead:b", source: "contact", value: { state: "contacted" } };
    const initial = reconcileCommunicationWorkSession(null, { ...base, rows: [a, b], selectedRows: [a, b] });
    const sorted = reconcileCommunicationWorkSession(initial, { ...base, selection: "name-desc", rows: [a, b], selectedRows: [b, a] });
    expect(sorted.keys).toEqual(["lead:b", "post:a"]);
    const nextPage = reconcileCommunicationWorkSession(sorted, { ...base, boundary: "tomorrow:mine:page2", rows: [], selectedRows: [] });
    expect(nextPage.keys).toEqual([]);
    expect(nextPage.facts.size).toBe(0);
  });

  it("accepts fresh server facts instead of masking them with an older local post-contact override", () => {
    const original = { state: "waiting", note: "before" };
    const saved = { state: "unreachable", note: "local save" };
    const override = { base: original, value: saved };
    expect(communicationFactWithOverride(original, override)).toBe(saved);
    const fresh = { state: "enrolled", note: "new server fact" };
    expect(communicationFactWithOverride(fresh, override)).toBe(fresh);
  });

  it("advances past completed people and does not select the just-saved person again", () => {
    const keys = ["lead:a", "lead:b", "post:c", "lead:d"];
    expect(nextUnprocessedCommunicationKey(keys, new Set(["lead:b", "post:c"]), "lead:a")).toBe("lead:d");
    expect(nextUnprocessedCommunicationKey(keys, new Set(["lead:a", "lead:b", "post:c"]), "lead:d")).toBeNull();
    expect(nextUnprocessedCommunicationKey(keys, new Set(), "lead:d")).toBeNull();
  });
});
