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
        description: "从观察、推理到表达，了解适合孩子的思维主题与参与安排。",
      },
      mistakes: {
        title: "思考回顾",
        tabLabel: "回顾",
        description: "回看练习中的疑问与思路，陪孩子把每一步想明白。",
      },
      homework: {
        title: "每日练习",
        tabLabel: "练习",
        description: "查看每天的小练习，提交孩子的思考过程，记录点滴进步。",
      },
      account: {
        title: "我的",
        tabLabel: "我的",
        description: "在这里管理家长账号与孩子信息。",
      },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
      courses: {
        title: "Explore Ideas",
        tabLabel: "Explore",
        description: "Explore observation, reasoning and expression, and find suitable themes and schedules for your child.",
      },
      mistakes: {
        title: "Reflect Together",
        tabLabel: "Reflect",
        description: "Revisit questions and ways of thinking, and help your child understand each step.",
      },
      homework: {
        title: "Daily Practice",
        tabLabel: "Practice",
        description: "View daily practice, submit your child's work, and follow their progress.",
      },
      account: {
        title: "Account",
        tabLabel: "Account",
        description: "Manage your parent account and your children's information here.",
      },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
