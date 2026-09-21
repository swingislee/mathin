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
        description: "从观察、推理到表达，发现思维探索的主题与安排。",
      },
      mistakes: {
        title: "思考回顾",
        tabLabel: "回顾",
        description: "回看练习中的疑问与思路，把每一步想明白。",
      },
      homework: {
        title: "每日练习",
        tabLabel: "练习",
        description: "查看每日练习，提交思考过程，记录点滴进步。",
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
        description: "Discover themes and schedules for exploring observation, reasoning and expression.",
      },
      mistakes: {
        title: "Reflect on Ideas",
        tabLabel: "Reflect",
        description: "Revisit questions and approaches to understand each step more clearly.",
      },
      homework: {
        title: "Daily Practice",
        tabLabel: "Practice",
        description: "View daily practice, share your approach, and track your progress.",
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
