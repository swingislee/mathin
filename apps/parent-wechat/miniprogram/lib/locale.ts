export const brandName = "格致未来思维";
export const sections = ["courses", "mistakes", "homework", "account"] as const;
export type Section = typeof sections[number];
export type Locale = "zh" | "en";

type Copy = { title: string; tabLabel: string; description: string };
type Messages = { availability: string; sections: Record<Section, Copy> };

export const messages: Record<Locale, Messages> = {
  zh: {
    availability: "此功能正在准备中。",
    sections: {
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
        title: "每日练习",
        tabLabel: "练习",
        description: "用照片与视频记录思考，让每个发现留下痕迹。",
      },
      account: {
        title: "我的",
        tabLabel: "我的",
        description: "管理账号与个人资料。",
      },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
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
        title: "Daily Practice",
        tabLabel: "Practice",
        description: "Capture your thinking through photos and videos.",
      },
      account: {
        title: "Account",
        tabLabel: "Account",
        description: "Manage your account and profile.",
      },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
