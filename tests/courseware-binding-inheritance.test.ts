import { describe, expect, it } from "vitest";
import {
  editorBindingLookupTracks,
  selectEditorBindingRows,
} from "@/features/courseware-studio/binding-inheritance";

type Row = {
  binding_key: string;
  track: "native-16x9" | "adapted-4x3";
  value: string;
};

describe("courseware editor binding inheritance", () => {
  const rows: Row[] = [
    { binding_key: "shared", track: "native-16x9", value: "native" },
    { binding_key: "shared", track: "adapted-4x3", value: "adapted" },
    { binding_key: "native-only", track: "native-16x9", value: "inherited" },
    { binding_key: "adapted-only", track: "adapted-4x3", value: "specific" },
  ];

  it("loads both tracks only for the adapted editor", () => {
    expect(editorBindingLookupTracks("adapted-4x3")).toEqual(["native-16x9", "adapted-4x3"]);
    expect(editorBindingLookupTracks("native-16x9")).toEqual(["native-16x9"]);
  });

  it("inherits missing native bindings and lets adapted bindings override", () => {
    expect(selectEditorBindingRows("adapted-4x3", rows)).toEqual([
      { binding_key: "shared", track: "adapted-4x3", value: "adapted" },
      { binding_key: "native-only", track: "native-16x9", value: "inherited" },
      { binding_key: "adapted-only", track: "adapted-4x3", value: "specific" },
    ]);
  });

  it("does not leak adapted bindings into the native editor", () => {
    expect(selectEditorBindingRows("native-16x9", rows)).toEqual([
      { binding_key: "shared", track: "native-16x9", value: "native" },
      { binding_key: "native-only", track: "native-16x9", value: "inherited" },
    ]);
  });
});
