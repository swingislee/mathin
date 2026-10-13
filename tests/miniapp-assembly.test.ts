import { describe, expect, it } from "vitest";
import { addAssemblyBlock, addAssemblyField, assemblyNodes } from "../src/features/school/miniapp-settings/assembly-model";
import { defaultMiniappSettings } from "../contracts/participant-api/miniapp-settings";
import { defaultMiniappExperience } from "../contracts/participant-api/miniapp-experience-templates";
import { experienceIssues } from "../contracts/participant-api/miniapp-experience-validation";
import { miniappSettingsSchema } from "../src/features/school/miniapp-settings/contract";
const configured = () => { const value = defaultMiniappSettings(); return { ...value, experience: defaultMiniappExperience(value) }; };

describe("page assembly", () => {
  it("adds public content beneath the live calendar and reuses the same document for the next component", () => {
    const original = configured();
    const first = addAssemblyBlock(original, { kind: "native", id: "calendar" }, "paragraph", "afterPageId", "intro", "calendar-extra");
    const second = addAssemblyBlock(first.config, { kind: "native", id: "calendar" }, "activities", "afterPageId", "activities", "unused-page");
    expect(miniappSettingsSchema.safeParse(second.config).success).toBe(true);
    expect(experienceIssues(second.config.experience)).toEqual([]);
    expect(second.config.experience.pages).toHaveLength(original.experience.pages.length + 1);
    const page = second.config.experience.pages.find(p => p.id === "calendar-extra")!;
    expect(page).toMatchObject({ audience: "all", enabled: true, purpose: "page" });
    expect(page.blocks.map(b => b.id)).toEqual(["intro", "activities"]);
    expect(second.config.experience.screens?.find(s => s.id === "calendar")?.afterPageId).toBe(page.id);
    expect(original.experience.screens).toBeUndefined();
    const nodes = assemblyNodes(second.config, { kind: "native", id: "calendar" }, "zh");
    expect(nodes.find(n => n.key === "calendar")?.children?.[0]).toMatchObject({ id: "agenda", tab: "native-pages" });
    expect(nodes.find(n => n.key === "afterPageId")?.children?.map(n => n.part)).toEqual(["block:intro", "block:activities"]);
  });

  it("adds a choice to the selected form group without changing preceding conditional fields", () => {
    const config = configured(), form = config.experience.forms[0], originalFields = structuredClone(form.groups[0].fields);
    const added = addAssemblyField(config, form.id, "select", { zh: "新选择", en: "New choice" }, form.groups[0].id);
    const result = added.config.experience.forms[0].groups[0].fields;
    expect(result.slice(0, -1)).toEqual(originalFields);
    expect(result.at(-1)).toMatchObject({ type: "select", options: [{ label: { zh: "选项一", en: "Option one" } }] });
    expect(added.focus.part).toBe(`field:${form.groups[0].id}:${result.at(-1)?.id}`);
    expect(miniappSettingsSchema.safeParse(added.config).success).toBe(true);
  });

  it("keeps live personal records out of frozen report layouts", () => {
    const config = configured(), report = config.experience.pages.find(p => p.purpose === "report")!;
    expect(() => addAssemblyBlock(config, { kind: "page", id: report.id }, "accountRecords", "afterPageId")).toThrow("LIVE_RECORDS_IN_REPORT");
  });
});
