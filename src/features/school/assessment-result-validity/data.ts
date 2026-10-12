import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { databaseUuid } from "@/lib/database-uuid";
import { assessmentWorkbenchHasFinalResult, type AssessmentWorkbenchRow } from "../assessment-workbench-contract";
import { referencePolicySchema, referenceValiditySchema, type AssessmentReferenceValidity } from "./contract";

type Client = Awaited<ReturnType<typeof createClient>>;
// Parse each JSON projection at this boundary before returning it to a client.
export async function referenceRpc(client: Client, name: string, args: Record<string, unknown> = {}) {
  const rpc = (client.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>).bind(client);
  const result = await rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function readAssessmentReferencePolicy(client?: Client) {
  return referencePolicySchema.parse(await referenceRpc(client ?? await createClient(), "get_assessment_reference_policy"));
}

export async function readAssessmentReferenceValidities(registrationIds: readonly string[], client?: Client) {
  const ids = [...new Set(registrationIds)];
  const values: Record<string, AssessmentReferenceValidity> = {};
  if (!ids.length) return values;
  const db = client ?? await createClient();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const data = await referenceRpc(db, "get_assessment_reference_validities", { p_registration_ids: ids.slice(offset, offset + 100) });
    Object.assign(values, z.record(databaseUuid, referenceValiditySchema).parse(data));
  }
  return values;
}

export async function withAssessmentReferenceValidity(rows: AssessmentWorkbenchRow[], client?: Client): Promise<AssessmentWorkbenchRow[]> {
  const completed = rows.filter(row => row.registrationId && assessmentWorkbenchHasFinalResult(row));
  const values = await readAssessmentReferenceValidities(completed.map(row => row.registrationId!), client);
  return rows.map(row => row.registrationId && assessmentWorkbenchHasFinalResult(row)
    ? { ...row, referenceValidity: values[row.registrationId] ?? null } : { ...row, referenceValidity: null });
}
