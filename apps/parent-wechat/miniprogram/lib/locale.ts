export const brandName = "格致未来思维";
export const sections = ["discover", "courses", "account"] as const;
export type Section = typeof sections[number] | "reservations" | "agenda" | "mistakes" | "homework";
export type Locale = "zh" | "en";

type Copy = { title: string; tabLabel: string; description: string };
type Messages = { availability: string; sections: Record<Section, Copy> };

export const messages: Record<Locale, Messages> = {
  zh: {
    availability: "此功能正在准备中。",
    sections: {
      discover: { title: "发现", tabLabel: "发现", description: "" },
      reservations: { title: "我的预约", tabLabel: "预约", description: "" },
      agenda: { title: "全部课表", tabLabel: "课表", description: "" },
      courses: {
        title: "课程",
        tabLabel: "课程",
        description: "",
      },
      mistakes: {
        title: "思考回顾",
        tabLabel: "回顾",
        description: "查看测评结果与老师反馈，发现下一步的方向。",
      },
      homework: {
        title: "练习记录",
        tabLabel: "练习",
        description: "用照片与视频记录思考，让每个发现留下痕迹。",
      },
      account: {
        title: "家长",
        tabLabel: "家长",
        description: "",
      },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
      discover: { title: "Discover", tabLabel: "Discover", description: "" },
      reservations: { title: "My reservations", tabLabel: "Bookings", description: "" },
      agenda: { title: "Timetable", tabLabel: "Timetable", description: "" },
      courses: {
        title: "Courses",
        tabLabel: "Courses",
        description: "",
      },
      mistakes: {
        title: "Reflect on Ideas",
        tabLabel: "Reflect",
        description: "Read assessments and feedback to find your next direction.",
      },
      homework: {
        title: "Practice records",
        tabLabel: "Practice",
        description: "Capture your thinking through photos and videos.",
      },
      account: {
        title: "Parent",
        tabLabel: "Parent",
        description: "",
      },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
