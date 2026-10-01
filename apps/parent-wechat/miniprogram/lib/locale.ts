export const brandName = "格致未来思维";
export const sections = ["discover", "reservations", "agenda", "account"] as const;
export type Section = typeof sections[number] | "courses" | "mistakes" | "homework";
export type Locale = "zh" | "en";

type Copy = { title: string; tabLabel: string; description: string };
type Messages = { availability: string; sections: Record<Section, Copy> };

export const messages: Record<Locale, Messages> = {
  zh: {
    availability: "此功能正在准备中。",
    sections: {
      discover: { title: "发现", tabLabel: "发现", description: "填写一份信息，发现一次值得参与的活动。" },
      reservations: { title: "我的预约", tabLabel: "预约", description: "查看预约进度，安排下一次参与。" },
      agenda: { title: "参与安排", tabLabel: "安排", description: "按日期查看已关联的课程和活动安排。" },
      courses: {
        title: "思维探索",
        tabLabel: "探索",
        description: "发现新主题，开启一次思维探索。",
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
        title: "我的",
        tabLabel: "我的",
        description: "个人资料、家庭成员与常用服务。",
      },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
      discover: { title: "Discover", tabLabel: "Discover", description: "Share a few details and find an activity to join." },
      reservations: { title: "My reservations", tabLabel: "Bookings", description: "Check your reservations and plan your next visit." },
      agenda: { title: "My schedule", tabLabel: "Schedule", description: "View linked courses and activities by date." },
      courses: {
        title: "Explore Ideas",
        tabLabel: "Explore",
        description: "Discover a new theme and begin an exploration.",
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
        title: "Account",
        tabLabel: "Account",
        description: "Your profile, family members and services.",
      },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
