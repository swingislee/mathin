import { messages, resolveLocale, sections, type Section } from "./locale";

export function createPlaceholderPage(section: Section) {
  return {
    data: {
      ...messages.zh.sections[section],
      availability: messages.zh.availability,
    },
    onShow() {
      const locale = resolveLocale(wx.getAppBaseInfo().language);
      const copy = messages[locale];
      this.setData({ ...copy.sections[section], availability: copy.availability });
      wx.setNavigationBarTitle({ title: copy.sections[section].title });
      sections.forEach((key, index) => {
        wx.setTabBarItem({ index, text: copy.sections[key].tabLabel });
      });
    },
  } as WechatMiniprogram.Page.Options<
    { title: string; tabLabel: string; description: string; availability: string },
    Record<string, never>
  >;
}
