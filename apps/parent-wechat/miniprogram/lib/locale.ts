export const sections = ["courses", "mistakes", "homework", "account"] as const;
export type Section = typeof sections[number];
export type Locale = "zh" | "en";

type Copy = { title: string; description: string };
type Messages = { availability: string; sections: Record<Section, Copy> };

export const messages: Record<Locale, Messages> = {
  zh: {
    availability: "此功能正在准备中。",
    sections: {
      courses: { title: "课程", description: "了解课程安排，为孩子选择合适的课程。" },
      mistakes: { title: "错题", description: "回顾错题与解析，陪孩子梳理学习中的疑问。" },
      homework: { title: "作业", description: "查看每日作业，记录孩子的练习与进步。" },
      account: { title: "我的", description: "在这里管理家长账号与孩子信息。" },
    },
  },
  en: {
    availability: "This feature is coming soon.",
    sections: {
      courses: { title: "Courses", description: "Explore the schedule and find the right courses for your child." },
      mistakes: { title: "Review", description: "Revisit mistakes and explanations together with your child." },
      homework: { title: "Homework", description: "View daily assignments and follow your child's progress." },
      account: { title: "Account", description: "Manage your parent account and your children's information here." },
    },
  },
};

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().startsWith("en") ? "en" : "zh";
}
