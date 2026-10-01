import { z } from "zod";
import { miniappWechatCodeSchema } from "@/features/wechat/miniapp-provider";

export const parentWechatAuthCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), code: miniappWechatCodeSchema }).strict(),
  z.object({ action: z.literal("bind"), code: miniappWechatCodeSchema,
    password: z.string().min(6).max(128), confirm: z.literal(true) }).strict(),
]);
