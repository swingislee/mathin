import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSROOM_BACKDROP_ID,
  listClassroomBackdrops,
  resolveClassroomBackdrop,
} from "@/features/classroom/live/classroom-backdrops";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("classroom ambience backdrop", () => {
  it("registers the Story day/night pair under one stable id", () => {
    const definitions = listClassroomBackdrops();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      id: DEFAULT_CLASSROOM_BACKDROP_ID,
      dayAsset: "/illustrations/story-journey-day.webp",
      nightAsset: "/illustrations/story-journey-night.webp",
    });
  });

  it("uses explicit scope precedence and safely falls back for unknown ids", () => {
    expect(resolveClassroomBackdrop({
      sessionBackdropId: DEFAULT_CLASSROOM_BACKDROP_ID,
      classBackdropId: DEFAULT_CLASSROOM_BACKDROP_ID,
    })).toMatchObject({
      requestedId: DEFAULT_CLASSROOM_BACKDROP_ID,
      scope: "session",
      fellBack: false,
    });

    expect(resolveClassroomBackdrop({ sessionBackdropId: "missing-backdrop" })).toMatchObject({
      backdrop: { id: DEFAULT_CLASSROOM_BACKDROP_ID },
      requestedId: "missing-backdrop",
      scope: "system",
      fellBack: true,
    });
  });

  it("keeps ambience behind functional classroom surfaces without changing shell tokens", () => {
    const component = read("src", "features", "classroom", "live", "ClassroomBackdrop.tsx");
    const shell = read("src", "features", "classroom", "live", "LiveShell.tsx");

    expect(component).toContain('aria-hidden="true"');
    expect(component).toContain("pointer-events-none absolute inset-0 -z-10");
    expect(component).toContain("scene-day scene-adaptive");
    expect(shell).toContain("relative isolate flex h-dvh");
    expect(shell).toContain("<ClassroomBackdrop />");
    expect(shell).toContain("rounded-2xl bg-paper/95 shadow-sm");
    expect(shell).not.toContain("scene-story");
  });
});
