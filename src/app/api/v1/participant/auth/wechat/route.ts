import { parentWechatAuthFailure, parentWechatAuthGet, parentWechatAuthPost } from "@/features/parent-portal/wechat-server";

// Keep authentication independent of the participant calendar, assessment and activity entry.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { return await parentWechatAuthGet(request); }
  catch (error) { return parentWechatAuthFailure(error); }
}

export async function POST(request: Request) {
  try { return await parentWechatAuthPost(request); }
  catch (error) { return parentWechatAuthFailure(error); }
}
