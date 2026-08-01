import "server-only";

import { createClient } from "@/lib/supabase/server";

export type DataQualitySeverity = "info" | "warning" | "error" | "critical";

export interface DataQualityFinding {
  id: string;
  ruleKey: string;
  ruleVersion: number;
  severity: DataQualitySeverity;
  objectType: string;
  objectId: string | null;
  dedupeKey: string;
  evidence: Record<string, unknown>;
  observedAt: string;
}

export interface DataQualityRun {
  id: string;
  ruleSetVersion: string;
  rulesHash: string;
  snapshotAt: string;
  status: "completed";
  total: number;
  counts: Record<DataQualitySeverity, number>;
  findingsHash: string;
  completedAt: string;
  truncated: boolean;
  findings: DataQualityFinding[];
}

export async function getLatestDataQualityRun(): Promise<DataQualityRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_latest_data_quality_run");
  if (error) throw new Error(error.message);
  return data as unknown as DataQualityRun | null;
}