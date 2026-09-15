"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// 按语言加载可缓存的静态消息块，避免每个 HTML/RSC 响应重复序列化全站消息。
// 保持 SSR 与完整消息集合，侧栏导航、弹层及错误状态继续使用同一上下文。
const ChineseMessages = dynamic(() => import("./client-messages-zh"));
const EnglishMessages = dynamic(() => import("./client-messages-en"));

export function ClientMessages({ locale, children }: { locale: "zh" | "en"; children: ReactNode }) {
  const Messages = locale === "en" ? EnglishMessages : ChineseMessages;
  return <Messages>{children}</Messages>;
}
