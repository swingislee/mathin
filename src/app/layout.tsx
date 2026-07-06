import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${theme === "system" ? "" : theme}`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
