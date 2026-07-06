import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mathin.club"),
  title: { default: "Mathin", template: "%s · Mathin" },
  description: "探索数学故事、游戏、思维与工具。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const savedTheme = (await cookies()).get("mathin-theme")?.value;
  const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      data-theme={theme}
      className={`h-full antialiased ${theme === "system" ? "" : theme}`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
