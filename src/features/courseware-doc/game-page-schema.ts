import { z } from "zod";
import { parseGameCoursewarePayload } from "@/features/games/courseware/contracts";
import { gamePageGridLayoutSchema } from "@/features/games/courseware/game-page-layout";

export const GAME_PAGE_DOC_VERSION = "game-page-v1" as const;
export const GAME_PAGE_MAX_BYTES = 2 * 1_024 * 1_024;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const gamePageValidationSchema = z.object({
  payloadHash: sha256HexSchema,
  validatorVersion: z.string().min(1).max(100),
  publishable: z.boolean(),
  code: z.string().min(1).max(100),
  details: z.unknown(),
}).strict();

export const gamePageDocSchema = z.object({
  docVersion: z.literal(GAME_PAGE_DOC_VERSION),
  canvas: z.object({
    width: z.literal(960),
    height: z.literal(720),
    backgroundColor: z.string().nullable(),
  }).strict(),
  gameId: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  contentVersion: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  payload: z.unknown(),
  layout: gamePageGridLayoutSchema.optional(),
  validation: gamePageValidationSchema,
}).strict().superRefine((doc, context) => {
  try {
    parseGameCoursewarePayload(doc.gameId, doc.contentVersion, doc.payload);
  } catch {
    context.addIssue({
      code: "custom",
      path: ["payload"],
      message: "payload does not match a registered game courseware contract",
    });
  }
  if (new TextEncoder().encode(JSON.stringify(doc)).byteLength > GAME_PAGE_MAX_BYTES) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "game page exceeds the document size limit",
    });
  }
});

export type GamePageValidation = z.infer<typeof gamePageValidationSchema>;
export type GamePageDoc = z.infer<typeof gamePageDocSchema>;

export function isGamePageDoc(
  doc: { readonly docVersion: string },
): doc is GamePageDoc {
  return doc.docVersion === GAME_PAGE_DOC_VERSION;
}
