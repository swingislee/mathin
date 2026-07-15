"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGame } from "./registry";
import type { Difficulty } from "./types";
import { getVerifier } from "./verify";

// 客户端计时与服务端 started_at 的允许偏差（docs/plan/03-3.2）
const DURATION_TOLERANCE_MS = 10_000;

export type StartGameResult =
  | { ok: true; sessionId: string; seed: string }
  | { ok: false; error: "unauthenticated" | "invalid" };

/** 开局：服务端生成 seed 并留档 game_sessions，作为提交成绩的唯一凭据。 */
export async function startGame(gameId: string, difficulty: Difficulty): Promise<StartGameResult> {
  const game = getGame(gameId);
  if (!game || !game.difficulties.includes(difficulty)) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const seed = crypto.randomUUID().replaceAll("-", "");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("game_sessions")
    .insert({ user_id: user.id, game_id: gameId, difficulty, seed })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "invalid" };
  return { ok: true, sessionId: data.id, seed };
}

export type SubmitScoreResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "invalid" };

/**
 * 提交成绩：核对对局归属与未核销状态 → 校验 proof 确为该 seed 题目的有效解 →
 * 校验客户端用时与服务端流逝时间一致（容差 10s）→ 落库并核销对局。
 */
export async function submitScore(sessionId: string, durationMs: number, proof: unknown): Promise<SubmitScoreResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!Number.isInteger(durationMs) || durationMs <= 3000) return { ok: false, error: "invalid" };

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("game_sessions")
    .select("user_id, game_id, difficulty, seed, started_at")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .is("completed_at", null)
    .single();
  if (!session) return { ok: false, error: "invalid" };

  const verify = getVerifier(session.game_id);
  if (!verify) return { ok: false, error: "invalid" };
  const elapsedMs = Date.now() - new Date(session.started_at).getTime();
  if (Math.abs(elapsedMs - durationMs) > DURATION_TOLERANCE_MS) return { ok: false, error: "invalid" };
  if (!verify(session.seed, session.difficulty as Difficulty, proof)) return { ok: false, error: "invalid" };

  const { error } = await admin.from("game_scores").insert({
    user_id: user.id,
    game_id: session.game_id,
    difficulty: session.difficulty,
    seed: session.seed,
    duration_ms: durationMs,
    proof,
  });
  if (error) return { ok: false, error: "invalid" };
  await admin.from("game_sessions").update({ completed_at: new Date().toISOString() }).eq("id", sessionId);
  return { ok: true };
}
