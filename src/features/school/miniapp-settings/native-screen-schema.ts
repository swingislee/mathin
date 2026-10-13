import { z } from "zod";
import { nativeScreens, type NativeScreenConfig } from "../../../../contracts/participant-api/miniapp-native";
const text = (max: number) => z.object({ zh: z.string().max(max), en: z.string().max(max) }).strict();
const reference = z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/);
// A screen only accepts modules actually rendered by its controller. Required steps cannot be hidden.
const definitions = nativeScreens.filter(s => !s.redirect).map(screen => {
  const schema = z.object({
  id: z.literal(screen.id), title: text(120), description: text(1000), beforePageId: reference, afterPageId: reference,
  modules: z.array(z.union(screen.modules.map(module => z.object({
    id: z.literal(module.id), title: text(120), visible: module.required ? z.literal(true) : z.boolean(),
    density: module.compact ? z.enum(["comfortable", "compact"]) : z.literal("comfortable"),
  }).strict()))).max(screen.modules.length).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  }).strict();
  return ["discover", "calendar", "account"].includes(screen.id) ? schema.extend({ tabLabel: text(10).optional() }) : schema;
});
export const nativeScreensSchema: z.ZodType<NativeScreenConfig[]> = z.array(z.union(definitions)).max(definitions.length)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
