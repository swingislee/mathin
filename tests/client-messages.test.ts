import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import ChineseMessages from "@/i18n/client-messages-zh";
import EnglishMessages from "@/i18n/client-messages-en";
import zh from "../messages/zh.json";
import en from "../messages/en.json";

const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;

function TranslatedContent() {
  const common = useTranslations("common");
  const nav = useTranslations("school.nav");
  const changes = useTranslations("changes");
  return createElement("div", { lang: useLocale() }, [common("skipToContent"), nav("sidebarLabel"), changes("title")].join(" | "));
}

describe("static client message catalogs", () => {
  it.each([
    ["zh", ChineseMessages, zh],
    ["en", EnglishMessages, en],
  ] as const)("keeps the complete %s catalog and inherited locale available during SSR", (locale, Messages, messages) => {
    const content = createElement(TranslatedContent);
    const render = (children: ReactNode, catalog: typeof messages | null) => renderToStaticMarkup(createElement(
      Provider, { locale, messages: catalog, timeZone: "Asia/Shanghai" }, children,
    ));
    expect(render(createElement(Messages as ComponentType<PropsWithChildren>, null, content), null)).toEqual(render(content, messages));
  });
});
