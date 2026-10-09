import { z } from "zod";
import { miniappWechatCodeSchema } from "@/features/wechat/miniapp-provider";
import { promotionSceneSchema, registrationLocationSchema } from "./onboarding-contract";

export const parentWechatAuthCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), code: miniappWechatCodeSchema, scene: promotionSceneSchema.optional(), location: registrationLocationSchema.optional() }).strict(),
  z.object({ action: z.literal("bind"), code: miniappWechatCodeSchema,
    password: z.string().min(6).max(128), confirm: z.literal(true) }).strict(),
]);
