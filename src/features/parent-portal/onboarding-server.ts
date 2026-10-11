import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Session, User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { wechatIdentitySchema, WECHAT_PROVIDER, type WechatIdentity } from "@/features/wechat/contract";
import { getMiniappWechatConfig, type MiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappPhone } from "@/features/wechat/miniapp-phone";
import { MiniappWechatError } from "@/features/wechat/miniapp-provider";
import { createMiniappAuthClient, exchangeMiniappIdentitySession, limitMiniappWechat, miniappSessionContext, revokeMiniappSession } from "@/features/wechat/miniapp-session";
import { randomToken } from "@/features/wechat/provider";
import { assertAccountActive, findWechatUser, issueTicket, readTicket, saveWechatSnapshot } from "@/features/wechat/store";
import { familyRegistrationSchema, onboardingCommandSchema, promotionSceneSchema, type FamilyRegistration } from "./onboarding-contract";
import { familyFormSchema } from "./family-form";
import { familyAnswerErrors, familyChildren } from "../../../contracts/participant-api/onboarding";
import { authorize, PortalError, readJson, requireResult, response } from "./server";
import zh from "../../../messages/zh.json";
import en from "../../../messages/en.json";

const verifiedPhoneSchema = z.object({ userId: z.string().uuid(), phone: z.string().regex(/^\+[0-9]{7,20}$/), localPhone: z.string().regex(/^[0-9]{6,18}$/) });
const identityProofSchema = z.object({ purpose: z.literal("family-phone"), identity: wechatIdentitySchema,
  scene: promotionSceneSchema.nullable(), verifiedPhone: verifiedPhoneSchema.optional() });
const phoneProofSchema = identityProofSchema.extend({ purpose: z.literal("family-registration"),
  phone: z.string().regex(/^\+[0-9]{7,20}$/), localPhone: z.string().regex(/^[0-9]{6,18}$/), formVersion: z.number().int().positive().optional() });
const reservationSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid(), created: z.boolean(), completed: z.boolean(), family: familyRegistrationSchema });
const completionSchema = z.object({ studentId: z.string().uuid().nullable(), grade: z.number().int().nullable(),
  participantIds: z.array(z.string().uuid()).optional() });

export function familyOnboardingAvailable(config = getMiniappWechatConfig()) {
  return Boolean(config?.phoneLinking && process.env.WECHAT_FAMILY_ONBOARDING_ENABLED === "true");
}
function configOrFail() {
  const config = getMiniappWechatConfig();
  if (!config || !familyOnboardingAvailable(config)) throw new MiniappWechatError("UNAVAILABLE", "WECHAT_NOT_CONFIGURED");
  return config;
}
async function newProof(payload: object) {
  const token = randomToken();
  // Keep a margin below the database's 15-minute ceiling for application/database clock skew.
  return issueTicket("guest", payload, token, 14 * 60, token);
}
export async function policies() {
  const rows = requireResult(await createAdminClient().from("consent_policies").select("policy_kind,version,document_path").eq("required", true)) ?? [];
  const privacy = rows.find(row => row.policy_kind === "privacy"), children = rows.find(row => row.policy_kind === "children_privacy");
  if (!privacy || !children) throw new PortalError("UNAVAILABLE");
  const policyText = (copy: typeof zh.compliance | typeof en.compliance) => ({
    privacy: [copy.privacyTitle, copy.privacyIntro, copy.rightsTitle, copy.rightsBody].join("\n\n"),
    children: [copy.childrenTitle, copy.childrenIntro, copy.consentTitle, copy.consentBody, copy.videoTitle, copy.videoBody].join("\n\n"),
  });
  return { privacyVersion: String(privacy.version), childrenPrivacyVersion: String(children.version),
    privacyPath: String(privacy.document_path), childrenPrivacyPath: String(children.document_path),
    policyText: { zh: policyText(zh.compliance), en: policyText(en.compliance) } };
}

export async function readFamilyForm(scene: string | null) {
  const row = requireResult(await createAdminClient().from("miniapp_forms").select("slug,version,title,description,fields")
    .eq("slug", scene || "family-onboarding").in("purpose", ["family", "promotion"]).eq("enabled", true).maybeSingle());
  if (!row) throw new PortalError("NOT_FOUND");
  return familyFormSchema.parse(row);
}

export function verifiedAccountPhone(user: Pick<User, "id" | "phone" | "phone_confirmed_at">) {
  const digits = user.phone?.replace(/\D/g, "") || "";
  if (!user.phone_confirmed_at || !/^[0-9]{7,18}$/.test(digits)) return undefined;
  return { userId: user.id, phone: `+${digits}`, localPhone: /^86\d{11}$/.test(digits) ? digits.slice(2) : digits };
}

export async function beginFamilyOnboarding(identity: WechatIdentity, scene: string | null = null, user?: User) {
  configOrFail();
  if (scene) {
    const form = requireResult(await createAdminClient().from("miniapp_forms").select("slug").eq("slug", scene).eq("purpose", "promotion").eq("enabled", true).maybeSingle());
    if (!form) throw new PortalError("NOT_FOUND");
  }
  const verifiedPhone = user ? verifiedAccountPhone(user) : undefined;
  return { state: "onboarding_required" as const, ticket: await newProof({ purpose: "family-phone", identity, scene, verifiedPhone }),
    ...(verifiedPhone ? { phoneVerified: true } : {}) };
}

/** Existing work accounts can register a household without replacing their account. */
export async function needsFamilyOnboarding(userId: string) {
  const completed = requireResult(await createAdminClient().from("miniapp_intakes").select("id")
    .eq("intake_kind", "family").eq("registration_user_id", userId).not("completed_at", "is", null).limit(1).maybeSingle());
  return !completed;
}

async function existingParticipants(identity: WechatIdentity) {
  const userId = await findWechatUser(identity.subject);
  if (!userId) return [];
  await assertAccountActive(userId);
  const admin = createAdminClient();
  const guardians = requireResult(await admin.from("student_guardians").select("student_id").eq("guardian_id", userId)) ?? [];
  const ids = guardians.map(row => row.student_id);
  const rows = requireResult(await admin.from("students").select("id,name,gender,grade,school")
    .is("deleted_at", null).or(`user_id.eq.${userId}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`).order("name")) ?? [];
  return rows.map(row => ({ id: row.id, childName: row.name, gender: ["female", "male"].includes(row.gender) ? row.gender : "", grade: row.grade, school: row.school }));
}

async function familyFormResponse(proof: z.infer<typeof identityProofSchema>, phone: { phone: string; localPhone: string }) {
  const form = await readFamilyForm(proof.scene);
  const participants = await existingParticipants(proof.identity);
  const ticket = await newProof({ purpose: "family-registration", identity: proof.identity, scene: proof.scene,
    formVersion: form.version, phone: phone.phone, localPhone: phone.localPhone });
  return response({ state: "family_required", ticket, form, existingParticipants: participants,
    maskedPhone: phone.phone.slice(0, 5) + "****" + phone.phone.slice(-4), ...await policies() });
}

async function establishAccount(config: MiniappWechatConfig, identity: WechatIdentity, proof: z.infer<typeof phoneProofSchema>, family: FamilyRegistration) {
  const admin = createAdminClient();
  const lease = randomUUID();
  const reservation = reservationSchema.parse(requireResult(await admin.rpc("miniapp_prepare_family", {
    p_subject: identity.subject, p_phone: proof.phone, p_local_phone: proof.localPhone,
    p_scene: proof.scene, p_family: family, p_lease: lease,
  })));
  return establishReservedMiniappAccount(config, identity, proof, reservation, lease, async () =>
    completionSchema.parse(requireResult(await admin.rpc("miniapp_complete_family", {
      p_id: reservation.id, p_subject: identity.subject, p_lease: lease,
    }))));
}

/** Shared account bootstrap. The caller supplies its own explicit, transactionally confirmed action. */
export async function establishReservedMiniappAccount(config: MiniappWechatConfig, identity: WechatIdentity, proof: { phone: string },
  reservation: { id: string; userId: string; created: boolean; completed: boolean }, lease: string,
  complete: () => Promise<z.infer<typeof completionSchema>>) {
  const admin = createAdminClient();
  let session: Session | undefined;
  let bootstrap: Session | undefined;
  try {
    const owner = await findWechatUser(identity.subject);
    if (owner && owner !== reservation.userId) throw new PortalError("CONFLICT");
    if (owner) {
      session = await exchangeMiniappIdentitySession(config, identity, owner);
    } else {
      // Only the account reserved by this verified identity can receive a temporary bootstrap password.
      // It is kept in memory, never returned to the miniapp, and never changes an existing unrelated account.
      const password = randomBytes(48).toString("base64url");
      if (!reservation.created) {
        const created = await admin.auth.admin.createUser({ id: reservation.userId, phone: proof.phone,
          password, phone_confirm: true, app_metadata: { miniapp_registration_id: reservation.id } });
        if (created.error || created.data.user?.id !== reservation.userId) throw new PortalError("UNAVAILABLE");
      } else {
        const { data, error } = await admin.auth.admin.getUserById(reservation.userId);
        const user = data.user;
        if (error || !user || reservation.completed || user.app_metadata?.miniapp_registration_id !== reservation.id
          || user.email || user.phone?.replace(/\D/g, "") !== proof.phone.slice(1)
          || user.factors?.some(factor => factor.status === "verified")
          || user.identities?.some(item => item.provider === WECHAT_PROVIDER)) throw new PortalError("ACCOUNT_SECURITY");
        await assertAccountActive(user.id);
        const updated = await admin.auth.admin.updateUserById(user.id, { password });
        if (updated.error) throw new PortalError("UNAVAILABLE");
      }
      const auth = createMiniappAuthClient(config);
      const signed = await auth.auth.signInWithPassword({ phone: proof.phone, password });
      bootstrap = signed.data.session ?? undefined;
      if (signed.error || !bootstrap || signed.data.user?.id !== reservation.userId) throw new PortalError("UNAVAILABLE");
      const initial = await miniappSessionContext(config, bootstrap.access_token, reservation.userId);
      if (initial.mfaRequired) throw new PortalError("ACCOUNT_SECURITY");
      const token = bootstrap.access_token;
      session = await exchangeMiniappIdentitySession(config, identity, reservation.userId, {
        token, sessionId: initial.sessionId, verify: async () => {
          const current = await miniappSessionContext(config, token, reservation.userId);
          if (current.sessionId !== initial.sessionId || current.mfaRequired) throw new PortalError("ACCOUNT_SECURITY");
          await assertAccountActive(reservation.userId);
        },
      });
    }
    const context = await miniappSessionContext(config, session.access_token, reservation.userId);
    // A verified WeChat login can complete registration without repeating the account's MFA.
    // Bootstrap/linking checks above still protect accounts without an established WeChat identity.
    if (!session.expires_at) throw new PortalError("ACCOUNT_SECURITY");
    const completed = await complete();
    await saveWechatSnapshot(reservation.userId, identity);
    await authorize(new Request(config.completionUrl, { headers: { authorization: `Bearer ${session.access_token}` } }));
    if (bootstrap) await revokeMiniappSession(bootstrap.access_token, context.sessionId);
    bootstrap = undefined;
    return { state: "authenticated" as const, session: { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at },
      participantId: completed.studentId, grade: completed.grade, ...(completed.participantIds ? { participantIds: completed.participantIds } : {}) };
  } catch (error) {
    if (session) await revokeMiniappSession(session.access_token);
    if (bootstrap && bootstrap.access_token !== session?.access_token) await revokeMiniappSession(bootstrap.access_token);
    throw error;
  } finally {
    // A failed step remains resumable by the same verified WeChat identity, without deleting formal data.
    await admin.from("miniapp_intakes").update({ lease_key: null, lease_until: null }).eq("id", reservation.id).eq("lease_key", lease);
  }
}

/** Finish a previously linked but interrupted registration using the persisted, consented form. */
export async function resumePendingFamily(config: MiniappWechatConfig, identity: WechatIdentity, userId: string) {
  const row = requireResult(await createAdminClient().from("miniapp_intakes").select("verified_phone,local_phone,form_slug,answers,completed_at")
    .eq("intake_kind", "family").eq("registration_user_id", userId).eq("wechat_subject", identity.subject).maybeSingle());
  if (!row || row.completed_at) return null;
  if (!familyOnboardingAvailable(config)) throw new PortalError("UNAVAILABLE");
  const proof = phoneProofSchema.parse({ purpose: "family-registration", identity, phone: row.verified_phone, localPhone: row.local_phone,
    scene: row.form_slug === "family-onboarding" ? null : row.form_slug });
  return establishAccount(config, identity, proof, familyRegistrationSchema.parse(row.answers));
}

export async function onboardingPost(request: Request) {
  const config = configOrFail();
  const input = onboardingCommandSchema.parse(await readJson(request));
  await limitMiniappWechat(request, "login");
  if (input.action === "phone" || input.action === "form") {
    const proof = await readTicket("guest", input.ticket, input.ticket, identityProofSchema, true);
    if (!proof) throw new PortalError("UNAUTHENTICATED");
    if (input.action === "phone") return familyFormResponse(proof, await exchangeMiniappPhone(config, input.code));
    const verified = proof.verifiedPhone;
    if (!verified || await findWechatUser(proof.identity.subject) !== verified.userId) throw new PortalError("UNAUTHENTICATED");
    const { data, error } = await createAdminClient().auth.admin.getUserById(verified.userId);
    if (error || !data.user || verifiedAccountPhone(data.user)?.phone !== verified.phone) throw new PortalError("UNAUTHENTICATED");
    // This short-lived server proof already ties the verified WeChat identity to the account and phone.
    return familyFormResponse(proof, verified);
  }
  // Retain the short-lived proof for idempotent retries when the network loses the success response.
  const proof = await readTicket("guest", input.ticket, input.ticket, phoneProofSchema);
  if (!proof) throw new PortalError("UNAUTHENTICATED");
  const form = await readFamilyForm(proof.scene);
  if ((proof.formVersion !== undefined && proof.formVersion !== form.version)
    || (input.family.formVersion !== undefined && input.family.formVersion !== form.version)) throw new PortalError("FORM_CHANGED");
  if (familyAnswerErrors(form, input.family).length) throw new PortalError("VALIDATION");
  const children = familyChildren(input.family);
  if (children.some(child => child.participantId)) {
    const allowed = new Set((await existingParticipants(proof.identity)).map(row => row.id));
    if (children.some(child => child.participantId && !allowed.has(child.participantId))) throw new PortalError("FORBIDDEN");
  }
  const family: FamilyRegistration = { ...input.family, ...children[0], children, formVersion: form.version };
  // The child's local key belongs to the children array, not the family-level payload.
  delete (family as FamilyRegistration & { key?: string }).key;
  delete (family as FamilyRegistration & { participantId?: string }).participantId;
  return response(await establishAccount(config, proof.identity, proof, family));
}
