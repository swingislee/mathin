import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("courseware shared asset pagination", () => {
  it("loads ten rows per page and signs previews only for the visible page", () => {
    const data = read("src/features/courseware-studio/data.ts");
    const pageRowsAt = data.indexOf("const pageRows = rows.slice(0, ASSET_LIBRARY_PAGE_SIZE)");
    const revisionIdsAt = data.indexOf("const imageRevisionIds = pageRows");
    const signedUrlsAt = data.indexOf("createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)");

    expect(data).toContain("export const ASSET_LIBRARY_PAGE_SIZE = 10");
    expect(data).toContain("p_limit: ASSET_LIBRARY_PAGE_SIZE + 1");
    expect(data).toContain("p_offset: (filters.page - 1) * ASSET_LIBRARY_PAGE_SIZE");
    expect(pageRowsAt).toBeGreaterThan(0);
    expect(revisionIdsAt).toBeGreaterThan(pageRowsAt);
    expect(signedUrlsAt).toBeGreaterThan(revisionIdsAt);
  });

  it("keeps the resource collection as a paged table with linear chrome", () => {
    const page = read("src/app/[locale]/dashboard/courseware-assets/page.tsx");
    expect(page).toContain("hasNextPage");
    expect(page).toContain("assetPreviousPage");
    expect(page).toContain("assetNextPage");
    expect(page).toContain("<Table");
    expect(page).toContain("DashboardTableShell");
    expect(page).not.toContain('className="rounded-none border-x-0"');
  });
});
