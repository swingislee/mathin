import "server-only";
import { readPublishedSettings } from "@/features/participant-portal/settings-server";
export async function familyFormDisplay() {
  const { config } = await readPublishedSettings();
  return { stages: config!.stages.flatMap(group => group.stages.map(({ stageNumber, label, visible }) => ({ stageNumber, label, visible }))), brandName: config!.brand.name };
}
