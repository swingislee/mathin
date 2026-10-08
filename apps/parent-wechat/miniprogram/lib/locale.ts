export const brandName = "格致未来思维";
export const sections = ["discover", "calendar", "account"] as const;
export type Section = typeof sections[number] | "reservations" | "agenda" | "reflections" | "records";
export type Locale = "zh" | "en";

type Copy = { title: string; tabLabel: string; description: string };
type Messages = { availability: string; sections: Record<Section, Copy> };

export const messages: Record<Locale, Messages> = {
  zh: {
    availability: "此功能正在准备中。",
    sections: {
      discover: { title: "发现", tabLabel: "发现", description: "" },
      reservations: { title: "我的预约", tabLabel: "预约", description: "" },
      agenda: { title: "全部安排", tabLabel: "日程", description: "" },
      calendar: {
        title: "日历",
        tabLabel: "日历",
        description: "",
      },
      reflections: {
        title: "思考回顾",
        tabLabel: "回顾",
        description: "查看诊断结果与活动反馈，发现下一步的方向。",
      },
      records: {
        title: "活动记录",
        tabLabel: "记录",
        description: "用照片与视频记录思考，让每个发现留下痕迹。",
      },
      account: {
        title: "我的",
        tabLabel: "我的",
        description: "",
      },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
      discover: { title: "Discover", tabLabel: "Discover", description: "" },
      reservations: { title: "My reservations", tabLabel: "Bookings", description: "" },
      agenda: { title: "Arrangements", tabLabel: "Arrangements", description: "" },
      calendar: {
        title: "Calendar",
        tabLabel: "Calendar",
        description: "",
      },
      reflections: {
        title: "Reflect on Ideas",
        tabLabel: "Reflect",
        description: "Read assessments and feedback to find your next direction.",
      },
      records: {
        title: "Activity records",
        tabLabel: "Records",
        description: "Capture your thinking through photos and videos.",
      },
      account: {
        title: "Me",
        tabLabel: "Me",
        description: "",
      },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
