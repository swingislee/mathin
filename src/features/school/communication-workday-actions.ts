"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { staffRpcClient } from "./actions/guards";
import { COMMON_CODES, dateOnly, datetime, parse, requiredText, text, uuid } from "./actions/schemas";
import { CONTACT_CHANNELS, CONTACT_ROUTES } from "./enrollment-workflow-contract";
import { communicationDayBounds, type CommunicationWorklist } from "./communication-workday-contract";
import { communicationWorkdayRpc, getCommunicationWorklist, getCommunicationWorklists } from "./communication-workday-data";

const day = dateOnly.refine((value) => { try { communicationDayBounds(value); return true; } catch { return false; } });
const rowKey = z.string().refine((value) => /^(lead|post):/.test(value) && uuid.safeParse(value.slice(5)).success);
const createSchema = z.object({ name: requiredText(100), date: day, keys: z.array(rowKey).min(1).max(10000) }).strict();
const completeSchema = z.object({ worklistId: uuid, key: rowKey, completed: z.boolean() }).strict();
const listSchema = z.object({ date: day.optional() }).strict();
const occurrenceTime = z.string().regex(/T.+(?:Z|[+-]\d{2}:\d{2})$/i).pipe(datetime);
const commonPatch = { note: text(2000).optional(), channel: z.enum(CONTACT_CHANNELS).optional(), occurredAt: occurrenceTime.optional() };
const contactPatch = z.object({ ...commonPatch,
  outcome: z.enum(["connected", "unreachable", "declined", "invalid_number"]).optional(),
  wechatAdded: z.boolean().nullable().optional(), visitCommitted: z.boolean().nullable().optional(),
  interestLevel: z.enum(["A", "B", "C"]).nullable().optional(),
}).strict();
const postPatch = z.object({ ...commonPatch, outcome: z.enum(["connected", "unreachable"]).optional(), route: z.enum(CONTACT_ROUTES).optional() }).strict();
const invitationPatch = z.object(commonPatch).strict();
const revisionBase = { eventId: uuid, expectedRevision: uuid.nullable() };
const revisionSchema = z.discriminatedUnion("source", [
  z.object({ ...revisionBase, source: z.literal("contact"), patch: contactPatch }).strict(),
  z.object({ ...revisionBase, source: z.literal("post_activity"), patch: postPatch }).strict(),
  z.object({ ...revisionBase, source: z.literal("invitation"), patch: invitationPatch }).strict(),
]).refine((value) => Object.values(value.patch).some((item) => item !== undefined));
export type ReviseCommunicationRecordInput = z.input<typeof revisionSchema>;
const ERRORS = ["FORBIDDEN_SCOPE", "REVISION_CONFLICT", "CORRECTION_REQUIRES_WORKFLOW", "NOT_FOUND", ...COMMON_CODES] as const;

function refreshCommunication() {
  revalidatePath("/[locale]/dashboard/followups", "layout");
  revalidatePath("/[locale]/dashboard/activities", "layout");
}

export async function createCommunicationWorklistAction(input: z.input<typeof createSchema>): Promise<ActionResult<CommunicationWorklist>> {
  try {
    const value = parse(createSchema, input);
    await staffRpcClient();
    const id = parse(uuid, await communicationWorkdayRpc("create_communication_worklist", {
      p_name: value.name, p_work_date: value.date, p_row_keys: [...new Set(value.keys)],
    }));
    const worklist = await getCommunicationWorklist(id);
    refreshCommunication();
    return { ok: true, data: worklist };
  } catch (error) { return actionError(error, ERRORS); }
}

export async function completeCommunicationWorklistItemAction(input: z.input<typeof completeSchema>): Promise<ActionResult<CommunicationWorklist>> {
  try {
    const value = parse(completeSchema, input);
    await staffRpcClient();
    await communicationWorkdayRpc("complete_communication_worklist_item", {
      p_worklist_id: value.worklistId, p_row_key: value.key, p_completed: value.completed,
    });
    const worklist = await getCommunicationWorklist(value.worklistId);
    refreshCommunication();
    return { ok: true, data: worklist };
  } catch (error) { return actionError(error, ERRORS); }
}

export async function getCommunicationWorklistsAction(input: z.input<typeof listSchema> = {}): Promise<ActionResult<CommunicationWorklist[]>> {
  try {
    const value = parse(listSchema, input);
    await staffRpcClient();
    return { ok: true, data: await getCommunicationWorklists(value.date) };
  } catch (error) { return actionError(error, ERRORS); }
}

export async function reviseCommunicationRecordAction(input: ReviseCommunicationRecordInput): Promise<ActionResult<{ revisionId: string }>> {
  try {
    const value = parse(revisionSchema, input);
    await staffRpcClient();
    const revisionId = parse(uuid, await communicationWorkdayRpc("revise_communication_record", {
      p_source: value.source, p_event_id: value.eventId, p_expected_revision: value.expectedRevision, p_patch: value.patch,
    }));
    refreshCommunication();
    return { ok: true, data: { revisionId } };
  } catch (error) { return actionError(error, ERRORS); }
}
