import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "always",
  localeCookie: { name: "mathin-locale", maxAge: 60 * 60 * 24 * 365 },
});
