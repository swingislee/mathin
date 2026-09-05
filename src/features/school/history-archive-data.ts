import "server-only";
import fs from "node:fs";
import path from "node:path";
import { readHistoryArchiveDetail, readHistoryArchivePage } from "../../../scripts/lib/history-archive-store.mjs";
import { isLocalHistoryArchiveEnvironment, type HistoryArchiveDetail, type HistoryArchiveFilters, type HistoryArchivePageData } from "./history-archive-contract";
import { getProfile, requireDashboardEnvironment } from "@/lib/auth";

async function archivePath(): Promise<string | null> {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("HISTORY_ARCHIVE_LOCAL_ONLY");
  // Keep the authorization boundary here as well as in the page, before any private file read.
  const { user } = await requireDashboardEnvironment("zh", ["staff"]);
  const profile = await getProfile(user.id);
  if (profile?.role !== "admin") throw new Error("FORBIDDEN");
  const root = path.resolve(process.cwd(), ".tmp/history-archive-rehearsal");
  const pointer = path.join(root, "current.json");
  if (!fs.existsSync(pointer)) return null;
  const current = JSON.parse(fs.readFileSync(pointer, "utf8")) as { database?: unknown };
  if (typeof current.database !== "string" || !/^run-[a-zA-Z0-9-]+\/archive\.sqlite$/.test(current.database)) throw new Error("HISTORY_ARCHIVE_POINTER");
  const database = path.join(root, current.database);
  const realRoot = fs.realpathSync(root);
  const realDatabase = fs.realpathSync(database);
  const relative = path.relative(realRoot, realDatabase);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("HISTORY_ARCHIVE_PATH");
  return realDatabase;
}

export async function loadHistoryArchivePage(filters: HistoryArchiveFilters): Promise<HistoryArchivePageData> {
  const database = await archivePath();
  if (database) return readHistoryArchivePage(database, filters) as HistoryArchivePageData;
  return { summary: {available:false,generatedAt:null,sourceCount:0,tableCount:0,recordCount:0,contentRecordCount:0,matchedCount:0,reviewCount:0,singleCandidateReviewCount:0,multipleCandidateReviewCount:0,unmatchedCount:0,gradeCorrectionCount:0,excludedCommunicationCount:0,archivedClassCount:0,tables:[]},rows:[],total:0,page:1,pageSize:filters.pageSize };
}

export async function loadHistoryArchiveDetail(id: string, page = 1): Promise<HistoryArchiveDetail | null> {
  const database = await archivePath();
  return database ? readHistoryArchiveDetail(database, id, page) as HistoryArchiveDetail | null : null;
}
