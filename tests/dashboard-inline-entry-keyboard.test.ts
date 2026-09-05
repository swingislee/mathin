import { describe, expect, it } from "vitest";
import { inlineEntryCommand } from "@/features/school/dashboard-page/inline-entry-keyboard";

describe("continuous entry keyboard commands", () => {
  it("selects numbered results while preserving numbers typed in fields", () => {
    expect(inlineEntryCommand({ key: "3" })).toEqual({ type: "choice", index: 2 });
    expect(inlineEntryCommand({ key: "3" }, true)).toBeNull();
    expect(inlineEntryCommand({ key: "3", altKey: true }, true)).toEqual({ type: "choice", index: 2 });
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("saves from a field using %j + Enter", modifier => {
    expect(inlineEntryCommand({ key: "Enter", ...modifier }, true)).toEqual({ type: "submit" });
    expect(inlineEntryCommand({ key: "Enter" }, true)).toBeNull();
  });

  it("preserves IME confirmation and suppresses repeated saves and selections", () => {
    expect(inlineEntryCommand({ key: "Enter", ctrlKey: true, isComposing: true }, true)).toBeNull();
    expect(inlineEntryCommand({ key: "Escape", isComposing: true }, true)).toBeNull();
    expect(inlineEntryCommand({ key: "Enter", ctrlKey: true, repeat: true })).toBeNull();
    expect(inlineEntryCommand({ key: "3", repeat: true })).toBeNull();
  });

  it("leaves browser tab and modified shortcuts alone", () => {
    expect(inlineEntryCommand({ key: "3", ctrlKey: true })).toBeNull();
    expect(inlineEntryCommand({ key: "3", metaKey: true })).toBeNull();
    expect(inlineEntryCommand({ key: "3", shiftKey: true })).toBeNull();
    expect(inlineEntryCommand({ key: "Enter", ctrlKey: true, altKey: true })).toBeNull();
    expect(inlineEntryCommand({ key: "0" })).toBeNull();
  });

  it("collapses the current entry from the row or a field", () => {
    expect(inlineEntryCommand({ key: "Escape" })).toEqual({ type: "close" });
    expect(inlineEntryCommand({ key: "Escape" }, true)).toEqual({ type: "close" });
  });
});
