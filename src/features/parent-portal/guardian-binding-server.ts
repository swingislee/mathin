import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { wechatIdentitySchema } from "@/features/wechat/contract";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappWechatCode, MiniappWechatError } from "@/features/wechat/miniapp-provider";
import { exchangeMiniappPhone } from "@/features/wechat/miniapp-phone";
import { limitMiniappWechat } from "@/features/wechat/miniapp-session";
import { assertAccountActive, findWechatUser, issueTicket, readTicket } from "@/features/wechat/store";
import { randomToken } from "@/features/wechat/provider";
import { establishReservedMiniappAccount, familyOnboardingAvailable, policies, verifiedAccountPhone } from "./onboarding-server";
import { guardianBindingCommand, guardianInviteCode } from "./guardian-binding-contract";
import { authorize, PortalError, readJson, requireResult, response } from "./server";
import type { GuardianBindingPreview, GuardianBindingStep } from "../../../contracts/participant-api/portal";

const identityProof = z.object({ purpose: z.literal("guardian-phone"), identity: wechatIdentitySchema, invitation: guardianInviteCode });
const confirmationProof = identityProof.extend({ purpose: z.literal("guardian-confirm"),
  phone: z.string().regex(/^\+[0-9]{7,20}$/), localPhone: z.string().regex(/^[0-9]{6,18}$/) });
const previewSchema = z.object({ maskedName: z.string(), expiresAt: z.string() });
const reservationSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid(), created: z.boolean(), completed: z.boolean() });
const completionSchema = z.object({ studentId: z.string().uuid(), grade: z.number().int().nullable(), participantIds: z.array(z.string().uuid()) });

async function preview(code: string): Promise<GuardianBindingPreview> {
  const row = requireResult(await createAdminClient().rpc("miniapp_guardian_preview", { p_code: code }));
  if (!row) throw new PortalError("NOT_FOUND");
  return previewSchema.parse(row);
}
async function proof(payload: object) {
  const token = randomToken();
  return issueTicket("guest", payload, token, 14 * 60, token);
}
async function confirmationStep(value: z.infer<typeof identityProof>, phone: { phone: string; localPhone: string }) {
  return { state: "confirmation_required", ticket: await proof({ ...value, ...phone, purpose: "guardian-confirm" }),
    maskedPhone: phone.phone.slice(0, 5) + "****" + phone.phone.slice(-4), ...await policies() } satisfies GuardianBindingStep;
}

export async function hasConfirmedGuardianBinding(userId: string) {
  const row = requireResult(await createAdminClient().from("miniapp_intakes").select("id")
    .eq("intake_kind", "guardian").eq("registration_user_id", userId).not("completed_at", "is", null).limit(1).maybeSingle());
  return Boolean(row);
}

export async function guardianBindingPost(request: Request) {
  const input = guardianBindingCommand.parse(await readJson(request));
  await limitMiniappWechat(request, "login");
  if (input.action === "preview") return response(await preview(input.invitation));
  const config = getMiniappWechatConfig();
  if (!config || !familyOnboardingAvailable(config)) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_NOT_CONFIGURED");
  if (input.action === "login") {
    await preview(input.invitation);
    const identity = await exchangeMiniappWechatCode(config, input.code);
    const owner = await findWechatUser(identity.subject);
    if (request.headers.has("authorization")) {
      const { user } = await authorize(request);
      if (user.id !== owner) throw new PortalError("CONFLICT");
    }
    let phone: ReturnType<typeof verifiedAccountPhone>;
    if (owner) {
      await assertAccountActive(owner);
      const { data, error } = await createAdminClient().auth.admin.getUserById(owner);
      if (error || !data.user) throw new PortalError("UNAUTHENTICATED");
      phone = verifiedAccountPhone(data.user);
    }
    const value = { purpose: "guardian-phone" as const, identity, invitation: input.invitation };
    return response(phone ? await confirmationStep(value, phone)
      : { state: "phone_required", ticket: await proof(value) } satisfies GuardianBindingStep);
  }
  if (input.action === "phone") {
    const value = await readTicket("guest", input.ticket, input.ticket, identityProof, true);
    if (!value) throw new PortalError("UNAUTHENTICATED");
    await preview(value.invitation);
    return response(await confirmationStep(value, await exchangeMiniappPhone(config, input.code)));
  }
  // Confirmation proofs are retained briefly for the same identity's lost-response retry.
  const value = await readTicket("guest", input.ticket, input.ticket, confirmationProof);
  if (!value) throw new PortalError("UNAUTHENTICATED");
  if (request.headers.has("authorization")) {
    const { user } = await authorize(request);
    if (user.id !== await findWechatUser(value.identity.subject)) throw new PortalError("CONFLICT");
  }
  const admin = createAdminClient(), lease = randomUUID();
  const reserved = reservationSchema.parse(requireResult(await admin.rpc("miniapp_prepare_guardian", {
    p_code: value.invitation, p_subject: value.identity.subject, p_phone: value.phone, p_local_phone: value.localPhone,
    p_answers: input.confirmation, p_lease: lease,
  })));
  return response(await establishReservedMiniappAccount(config, value.identity, value, reserved, lease, async () =>
    completionSchema.parse(requireResult(await admin.rpc("miniapp_complete_guardian", {
      p_id: reserved.id, p_subject: value.identity.subject, p_lease: lease,
    })))));
}
