import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { idbDelete, idbGet, idbPut, openClassroomDb, STORE_META } from "@/features/classroom/sync/idb";

afterEach(() => vi.restoreAllMocks());

describe("classroom IndexedDB write durability", () => {
  it("does not acknowledge a put until its transaction commits", async () => {
    const db = await openClassroomDb();
    const transaction = db.transaction.bind(db);
    let completed = false;
    vi.spyOn(db, "transaction").mockImplementation((...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = transaction(...args);
      tx.addEventListener("complete", () => { completed = true; });
      return tx;
    });
    await idbPut(STORE_META, crypto.randomUUID(), "saved");
    expect(completed).toBe(true);
  });

  it("rejects a put whose request succeeds before its transaction aborts", async () => {
    const key = crypto.randomUUID();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const request = put.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });

    await expect(idbPut(STORE_META, key, "must roll back")).rejects.toThrow();
    expect(await idbGet(STORE_META, key)).toBeUndefined();
  });

  it("rejects a delete whose request succeeds before its transaction aborts", async () => {
    const key = crypto.randomUUID();
    await idbPut(STORE_META, key, "keep after rollback");
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["delete"]>) {
      const request = remove.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });

    await expect(idbDelete(STORE_META, [key])).rejects.toThrow();
    expect(await idbGet(STORE_META, key)).toBe("keep after rollback");
  });
});
