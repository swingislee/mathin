export type EditorBindingTrack = "native-16x9" | "adapted-4x3";

export function editorBindingLookupTracks(track: EditorBindingTrack): EditorBindingTrack[] {
  return track === "adapted-4x3"
    ? ["native-16x9", "adapted-4x3"]
    : ["native-16x9"];
}

/**
 * A 4:3 draft inherits the native page's resource bindings unless it declares
 * an explicit binding for the same key. This keeps layout adaptation separate
 * from asset replacement and avoids cloning every binding into every track.
 */
export function selectEditorBindingRows<
  T extends { binding_key: string; track: string },
>(track: EditorBindingTrack, rows: readonly T[]): T[] {
  const selected = new Map<string, T>();
  for (const candidateTrack of editorBindingLookupTracks(track)) {
    for (const row of rows) {
      if (row.track === candidateTrack) selected.set(row.binding_key, row);
    }
  }
  return [...selected.values()];
}
