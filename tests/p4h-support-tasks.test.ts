import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H-9 workbench scope wiring and support task model", () => {
  it("defines the class_support_tasks model with generation triggers and a controlled completion RPC", () => {
    const migration = read("supabase", "migrations", "20260720001000_p4h_support_tasks.sql");
    expect(migration).toContain("create table public.class_support_tasks");
    expect(migration).toContain("'preclass_notice','absence_check','makeup_followup','postclass_followup'");
    expect(migration).toContain("create or replace function public.generate_preclass_support_task");
    expect(migration).toContain("create or replace function public.generate_postclass_support_task");
    expect(migration).toContain("create or replace function public.complete_support_task");
    expect(migration).toContain("create or replace function public.list_my_support_tasks");
    expect(migration).not.toContain("grant insert on table public.class_support_tasks");
    expect(migration).not.toContain("grant update on table public.class_support_tasks");
  });

  it("wires assign/remove classroom staff actions to the P4H-2 RPCs, previously unwired", () => {
    const actions = read("src", "features", "school", "actions", "classroom-staff.ts");
    expect(actions).toContain('rpc("assign_classroom_staff"');
    expect(actions).toContain('rpc("remove_classroom_staff"');
    expect(actions).toContain('authorizedClient("class.manage")');
  });

  it("gates support-task completion behind the login guard, not a single permission key (kind-specific gate lives in SQL)", () => {
    const actions = read("src", "features", "school", "actions", "support-tasks.ts");
    expect(actions).toContain('rpc("complete_support_task"');
    expect(actions).toContain("UNAUTHENTICATED");
  });

  it("carries a scope query param on every teaching/research/all dashboard tile link, not the account's default scope", () => {
    const staffHome = read("src", "features", "school", "home", "StaffHome.tsx");
    expect(staffHome).toContain('href: "/dashboard/classes?scope=teaching"');
    expect(staffHome).toContain('href: "/dashboard/courses?scope=research"');
    expect(staffHome).toContain('href: "/dashboard/classes?scope=all"');
    expect(staffHome).toContain('href: "/dashboard/classes?scope=support"');
    expect(staffHome).toContain('href: "/dashboard/courseware"');
  });

  it("registers the two new tiles and places them in the relevant default orders", () => {
    const tiles = read("src", "features", "school", "tiles.ts");
    expect(tiles).toContain('key: "coursewareTasks"');
    expect(tiles).toContain('key: "supportTasks"');
    expect(tiles).toContain('"coursewareTasks"');
    expect(tiles.includes('STAFF_RESEARCH_ORDER: readonly string[] = ["templateUrgent", "templateProgress", "coursewareTasks"')).toBe(true);
  });

  it("classroom detail exposes staffAssignments for the new management dialog without a second query", () => {
    const classes = read("src", "features", "school", "classes.ts");
    expect(classes).toContain("staffAssignments: StaffAssignmentSummary[]");
    expect(classes).toContain("const staffAssignments: StaffAssignmentSummary[] = assignments.map");
  });
});
