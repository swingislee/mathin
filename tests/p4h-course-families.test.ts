import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260720000300_p4h_course_families.sql"),
  "utf8",
);
const seed = JSON.parse(fs.readFileSync(path.join(root, "supabase", "seed", "teaching-plans.json"), "utf8")) as Array<{
  productCode: string;
  catalogVersion: string;
  lectures: unknown[];
}>;

describe("P4H course-family migration contract", () => {
  it("pins the current E-series seed set and preserves versioned product-code lookup", () => {
    expect(seed).toHaveLength(90);
    expect(seed.flatMap((plan) => plan.lectures)).toHaveLength(1135);
    expect(seed.filter((plan) => plan.catalogVersion === "2025")).toHaveLength(54);
    expect(seed.filter((plan) => plan.catalogVersion === "2026")).toHaveLength(36);
    for (const plan of seed) expect(migration).toContain(`'${plan.productCode}'`);
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain("courses_active_family_variant_idx");
    expect(migration).toContain("assign_legacy_course_family");
    expect(migration).toContain("create_legacy_course");
  });

  it("keeps the seed and query contracts family-first without exposing page documents", () => {
    const generator = fs.readFileSync(path.join(root, "scripts", "seed-courses.mjs"), "utf8");
    const importer = fs.readFileSync(path.join(root, "scripts", "cw-import.mjs"), "utf8");
    expect(generator).toContain("course_families");
    expect(generator).toContain("course_catalog_versions");
    expect(generator).toContain("on conflict (catalog_version_id, product_code)");
    expect(generator).toContain("family_id");
    expect(importer).toContain("product_code");
    expect(migration).toContain("function public.list_course_families");
    expect(migration).toContain("function public.get_course_family_detail");
    expect(migration).not.toContain("page_doc_url");
  });
});
