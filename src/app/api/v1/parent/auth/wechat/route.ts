import { parentWechatAuthFailure, parentWechatAuthGet, parentWechatAuthPost } from "@/features/parent-portal/wechat-server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return await parentWechatAuthGet(request); }
  catch (error) { return parentWechatAuthFailure(error); }
}
export async function POST(request: Request) {
  try { return await parentWechatAuthPost(request); }
  catch (error) { return parentWechatAuthFailure(error); }
}
