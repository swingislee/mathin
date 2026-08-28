import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260828000330_teaching_calendar_impact_preview_v2.sql"),
  "utf8",
);

describe("DEV-ORG-1 teaching calendar impact preview", () => {
  it("derives campus impact only through the selected room", () => {
    expect(migration).toContain("left join public.campus_rooms room_row on room_row.id = session_row.room_id");
    expect(migration).toContain("room_row.campus_id = p_campus_id");
    expect(migration).not.toContain("classroom_row.campus_id");
  });

  it("separates future mutable sessions from historical facts", () => {
    expect(migration).toContain("scheduled_at >= now()");
    expect(migration).toContain("cancelled_by is null");
    expect(migration).toContain("voided_at is null");
    expect(migration).toContain("historicalSessionCount");
  });
});
