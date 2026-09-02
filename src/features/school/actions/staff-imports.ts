"use server";

import { createHash, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalizeStaffRoleTokens } from "../staff-role-input";
import { authorizedClient } from "./guards";
import { COMMON_CODES, intInRange, parse, requiredText, uuid } from "./schemas";
import {
  STAFF_IMPORT_TEMPLATE_VERSION,
  type PreviewStaffImportInput,
  type StaffImportBatchResult,
} from "./types";

// Keep row-level business findings in the RPC. The action only rejects an
// invalid transport shape or a payload large enough to bypass importer limits.
const previewStaffImportSchema = z.object({
  templateVersion: z.literal(STAFF_IMPORT_TEMPLATE_VERSION),
  idempotencyKey: requiredText(200),
  rows: z.array(z.object({
    name: z.string().max(500),
    identifier: z.string().max(500),
    roles: z.array(z.string().max(200)).max(50),
    validDays: intInRange(1, 30),
  })).min(1).max(500),
});

const STAFF_IMPORT_CODES = [
  "INVALID_TEMPLATE",
  "INVALID_IDEMPOTENCY",
  "INVALID_ROWS",
  "IDEMPOTENCY_CONFLICT",
  "BATCH_NOT_FOUND",
  "BATCH_KIND_MISMATCH",
  "BATCH_EXPIRED",
  "BATCH_HAS_ERRORS",
  "BATCH_STALE",
  "ACCOUNT_EXISTS",
  "PROVISION_IN_PROGRESS",
  "AUTH_PROVIDER_FAILED",
  "PROVISION_FINALIZE_FAILED",
  ...COMMON_CODES,
] as const;

interface StaffProvisioningRow {
  row_no: number;
  display_name: string;
  identifier_type: "email" | "phone";
  identifier_normalized: string;
  role_keys: string[];
}

interface PreparedStaffAccount {
  invitation_id: string;
  display_name: string;
  identifier_type: "email" | "phone";
  identifier_normalized: string;
  role_keys: string[];
  expires_at: string;
}

const INITIAL_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PROVISIONING_ERROR_CODES = ["ACCOUNT_EXISTS", "PROVISION_IN_PROGRESS", "BATCH_STALE"] as const;

function initialPassword() {
  let password = "M!9";
  for (let index = 0; index < 15; index += 1) {
    password += INITIAL_PASSWORD_ALPHABET[randomInt(INITIAL_PASSWORD_ALPHABET.length)];
  }
  return password;
}

function provisioningErrorCode(message: string) {
  return PROVISIONING_ERROR_CODES.find((code) => message.includes(code));
}

export async function previewStaffImportAction(
  input: PreviewStaffImportInput,
): Promise<ActionResult<StaffImportBatchResult>> {
  try {
    const value = parse(previewStaffImportSchema, input);
    const { supabase } = await authorizedClient("staff.invite");
    const { data: roleAliases, error: roleError } = await supabase
      .from("staff_roles")
      .select("key,name");
    if (roleError) throw new Error(roleError.message);
    const canonicalRows = value.rows.map((row) => ({
      ...row,
      roles: canonicalizeStaffRoleTokens(row.roles, roleAliases ?? []),
    }));
    const inputHash = createHash("sha256").update(JSON.stringify(canonicalRows)).digest("hex");
    const { data, error } = await supabase.rpc("preview_staff_account_import", {
      p_template_version: value.templateVersion,
      p_rows: canonicalRows as unknown as Json,
      p_idempotency_key: value.idempotencyKey,
      p_input_hash: inputHash,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as unknown as StaffImportBatchResult };
  } catch (error) {
    return actionError<StaffImportBatchResult>(error, STAFF_IMPORT_CODES);
  }
}

export async function applyStaffImportAction(
  batchId: string,
): Promise<ActionResult<StaffImportBatchResult>> {
  try {
    const id = parse(uuid, batchId);
    const { supabase } = await authorizedClient("staff.invite");
    const admin = createAdminClient();
    const { data: pendingData, error: pendingError } = await supabase.rpc(
      "get_staff_import_provisioning_rows",
      { p_batch_id: id },
    );
    if (pendingError) throw new Error(pendingError.message);

    const provisionOne = async (row: StaffProvisioningRow) => {
      const password = initialPassword();
      const codeHash = createHash("md5").update(password).digest("hex");
      let prepared: PreparedStaffAccount | undefined;
      let authUserCreated = false;

      const credential = () => prepared ? {
        row: row.row_no,
        name: prepared.display_name,
        identifierType: prepared.identifier_type,
        identifier: prepared.identifier_normalized,
        roleKeys: prepared.role_keys,
        inviteCode: password,
        expiresAt: prepared.expires_at,
      } : null;

      try {
        const { data: preparedData, error: prepareError } = await supabase.rpc(
          "prepare_staff_import_account",
          { p_batch_id: id, p_row_no: row.row_no, p_code_hash: codeHash },
        );
        if (prepareError) {
          const code = provisioningErrorCode(prepareError.message);
          if (!code) throw new Error(prepareError.message);
          await supabase.rpc("record_staff_import_provision_failure", {
            p_batch_id: id,
            p_row_no: row.row_no,
            p_code: code,
          });
          return null;
        }

        prepared = ((preparedData ?? []) as unknown as PreparedStaffAccount[])[0];
        if (!prepared) throw new Error("PROVISION_FINALIZE_FAILED");
        const attributes = {
          password,
          user_metadata: {
            display_name: prepared.display_name,
            registration_invite_code: password,
          },
        };
        const { data: created, error: createError } = prepared.identifier_type === "email"
          ? await admin.auth.admin.createUser({
            ...attributes,
            email: prepared.identifier_normalized,
            email_confirm: true,
          })
          : await admin.auth.admin.createUser({
            ...attributes,
            phone: prepared.identifier_normalized,
            phone_confirm: true,
          });

        if (createError || !created.user) {
          await supabase.rpc("cancel_staff_import_account", {
            p_invitation_id: prepared.invitation_id,
            p_failure_code: "AUTH_PROVIDER_FAILED",
          });
          return null;
        }
        authUserCreated = true;

        const { error: finalizeError } = await supabase.rpc("finalize_staff_import_account", {
          p_invitation_id: prepared.invitation_id,
          p_user_id: created.user.id,
        });
        if (finalizeError) {
          await supabase.rpc("record_staff_import_provision_failure", {
            p_batch_id: id,
            p_row_no: row.row_no,
            p_code: "PROVISION_FINALIZE_FAILED",
          });
        }

        return credential();
      } catch {
        if (authUserCreated) return credential();
        if (prepared) {
          await supabase.rpc("cancel_staff_import_account", {
            p_invitation_id: prepared.invitation_id,
            p_failure_code: "AUTH_PROVIDER_FAILED",
          });
        } else {
          await supabase.rpc("record_staff_import_provision_failure", {
            p_batch_id: id,
            p_row_no: row.row_no,
            p_code: "BATCH_STALE",
          });
        }
        return null;
      }
    };

    const credentials: StaffImportBatchResult["invitations"] = [];
    const pendingRows = (pendingData ?? []) as unknown as StaffProvisioningRow[];
    for (let offset = 0; offset < pendingRows.length; offset += 8) {
      const results = await Promise.all(pendingRows.slice(offset, offset + 8).map(provisionOne));
      credentials.push(...results.filter((item): item is NonNullable<typeof item> => item !== null));
    }

    const { data: batchData, error: batchError } = await supabase.rpc(
      "get_staff_import_batch",
      { p_batch_id: id },
    );
    if (batchError) throw new Error(batchError.message);
    const batch = batchData as unknown as StaffImportBatchResult;
    revalidatePath("/[locale]/dashboard/staff", "page");
    return {
      ok: true,
      data: {
        ...batch,
        codesAvailable: credentials.length > 0,
        invitations: credentials.sort((left, right) => left.row - right.row),
      },
    };
  } catch (error) {
    return actionError<StaffImportBatchResult>(error, STAFF_IMPORT_CODES);
  }
}
