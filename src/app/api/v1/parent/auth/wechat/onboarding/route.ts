import { onboardingPost } from "@/features/parent-portal/onboarding-server";
import { parentWechatAuthFailure } from "@/features/parent-portal/wechat-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await onboardingPost(request); } catch (error) { return parentWechatAuthFailure(error); }
}
