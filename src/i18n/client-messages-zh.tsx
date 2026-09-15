"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../messages/zh.json";

export default function ChineseMessages({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="zh" messages={messages}>{children}</NextIntlClientProvider>;
}
