import { guardianBindingPost } from "@/features/parent-portal/guardian-binding-server";
import { parentWechatAuthFailure } from "@/features/parent-portal/wechat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return await guardianBindingPost(request); }
  catch (error) { return parentWechatAuthFailure(error); }
}
