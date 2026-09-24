import "server-only";
import type { User } from "@supabase/supabase-js";
import { WECHAT_PROVIDER, safeWechatAvatar, type WechatAccountState } from "./contract";
import { getWechatConfig } from "./config";
import { readGuest } from "./store";

export async function getWechatAccountState(user: User): Promise<WechatAccountState> {
  const config = getWechatConfig();
  const identity = user.identities?.find((item) => item.provider === WECHAT_PROVIDER);
  // 已验证的 Auth identity 读取绑定状态；可修改的 user_metadata 不参与判定。
  const name = identity?.identity_data?.name;
  const guest = config ? await readGuest() : null;
  return {
    available: Boolean(config), phoneLinkingAvailable: Boolean(config?.phoneLinking || user.email),
    linked: Boolean(identity), nickname: typeof name === "string" ? name.slice(0, 100) : null,
    avatarUrl: safeWechatAvatar(identity?.identity_data?.picture), pendingNickname: guest?.nickname ?? null,
  };
}
