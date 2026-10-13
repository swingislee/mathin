/** Mini Program runtime protocol 1: Mathin composes screens for the current identity; clients render views and run actions. */
export const runtimeProtocol = 1;
/** Highest view protocol understood by this client build. The server replaces newer blocks with their fallback. */
export const runtimeClientVersion = 1;

export const runtimeTabSlots = [1, 2, 3, 4, 5] as const;
export type RuntimeTabSlot = typeof runtimeTabSlots[number];
/** Tab routes are fixed by app.json; Mathin decides which slots are shown and what each one displays. */
export const runtimeTabRoutes: Readonly<Record<RuntimeTabSlot, string>> = {
  1: "/pages/discover/index", 2: "/pages/calendar/index", 3: "/pages/account/index", 4: "/pages/tab-4/index", 5: "/pages/tab-5/index",
};
/** Icons bundled with the client. Uploaded images can be used anywhere an icon or image is accepted. */
export const runtimeIcons = ["discover", "calendar", "account", "activity", "book", "report", "task", "participants", "form", "privacy", "reservations", "complete", "ticket", "cancel"] as const;
export type RuntimeIcon = typeof runtimeIcons[number];
/** Existing native pages that runtime actions may open while their business flows are migrated. */
export const runtimeRoutes = ["assessment", "activity-catalog", "activity-detail", "activity-requests", "agenda", "reservations", "reflections", "records", "register",
  "guardian-binding", "service", "document", "experience", "service-catalog", "service-detail", "experience-form", "experience-requests", "provider-bookings",
  "experience-notifications", "task", "web"] as const;
export type RuntimeRoute = typeof runtimeRoutes[number];

export type RuntimeText = { zh: string; en: string };
export type RuntimeLocale = "zh" | "en";
export const runtimeText = (zh = "", en = ""): RuntimeText => ({ zh, en });
export const runtimeLocalText = (value: RuntimeText | undefined, locale: RuntimeLocale) => value?.[locale] || value?.zh || value?.en || "";

/** Visibility is always evaluated by Mathin for the requesting account; commands are checked again when executed. */
export type RuntimeRule =
  | { kind: "signedIn" } | { kind: "signedOut" }
  | { kind: "hasParticipants" } | { kind: "noParticipants" }
  | { kind: "stage"; stages: number[] }
  | { kind: "between"; from: string; to: string }
  | { kind: "all"; rules: RuntimeRule[] } | { kind: "any"; rules: RuntimeRule[] } | { kind: "not"; rule: RuntimeRule };

export type RuntimeAction =
  | { type: "screen"; screen: string; params?: Record<string, string> }
  | { type: "tab"; slot: RuntimeTabSlot }
  | { type: "route"; route: RuntimeRoute; query?: Record<string, string> }
  | { type: "phone"; number: string }
  | { type: "copy"; text: string }
  | { type: "login" } | { type: "logout" } | { type: "back" } | { type: "refresh" };

export const runtimeSources = ["activities.catalog", "account.bookings", "account.tasks", "account.reports"] as const;
export type RuntimeSource = typeof runtimeSources[number];
export type RuntimeFacetKind = "stage" | "topic";

type BlockBase = { id: string; visibleWhen?: RuntimeRule };
export type RuntimeLinkSpec = { label: RuntimeText; action: RuntimeAction };
export type RuntimeEntrySpec = { id: string; label: RuntimeText; icon: string; action: RuntimeAction; visibleWhen?: RuntimeRule };
export type RuntimeBlockSpec = BlockBase & (
  | { type: "section"; title: RuntimeText; style: "card" | "plain"; more?: RuntimeLinkSpec; blocks: RuntimeBlockSpec[] }
  | { type: "text"; text: RuntimeText; tone: "body" | "muted" | "notice" }
  | { type: "image"; image: string; fit: "width" | "cover"; action?: RuntimeAction }
  | { type: "feature"; title: RuntimeText; body: RuntimeText; image: string; action?: RuntimeAction }
  | { type: "entries"; title: RuntimeText; style: "grid" | "floating"; items: RuntimeEntrySpec[] }
  | { type: "list"; title: RuntimeText; source: RuntimeSource; template: "card" | "row"; limit: number; empty: RuntimeText;
      more?: RuntimeLinkSpec; facets: RuntimeFacetKind[]; actionLabel: RuntimeText }
  | { type: "participants"; title: RuntimeText; empty: RuntimeText }
  | { type: "calendar"; title: RuntimeText; empty: RuntimeText; more?: RuntimeLinkSpec }
  | { type: "account"; trailing?: RuntimeLinkSpec }
  | { type: "content"; pageId: string }
  | { type: "button"; label: RuntimeText; appearance: "primary" | "secondary" | "link"; action: RuntimeAction }
  | { type: "divider" }
);
export type RuntimeBlockType = RuntimeBlockSpec["type"];
export const runtimeBlockTypes: readonly RuntimeBlockType[] = ["section", "text", "image", "feature", "entries", "list", "participants", "calendar", "account", "content", "button", "divider"];
/** Client view protocol that first rendered each block type. */
export const runtimeBlockVersions: Readonly<Record<RuntimeBlockType, number>> = {
  section: 1, text: 1, image: 1, feature: 1, entries: 1, list: 1, participants: 1, calendar: 1, account: 1, content: 1, button: 1, divider: 1,
};

export type RuntimeScreenSpec = { id: string; title: RuntimeText; navigation: "brand" | "title"; blocks: RuntimeBlockSpec[] };
export type RuntimeTabSpec = { slot: RuntimeTabSlot; screen: string; label: RuntimeText; icon: string; visibleWhen?: RuntimeRule };
export type RuntimeSpec = { version: 1; tabs: RuntimeTabSpec[]; screens: RuntimeScreenSpec[] };

/* Views sent to clients: text is localized and data is already authorized. Image values are `/api/…` paths on the API origin,
 * `asset:<path>` for bundled PNG files under /assets, or HTTPS URLs. */
export type RuntimeLink = { label: string; action: RuntimeAction };
export type RuntimeItem = {
  id: string; title: string; subtitle: string; summary: string; meta: string[]; tags: string[]; image: string;
  status: { label: string; tone: "neutral" | "positive" | "warning" | "muted" } | null; actionLabel: string; action: RuntimeAction | null;
  date: string; start: string; end: string; phase: "" | "upcoming" | "ongoing" | "ended";
};
export type RuntimeFacet = { id: RuntimeFacetKind; label: string; value: string; valueLabel: string; options: { value: string; label: string; group: string }[] };
export type RuntimeDay = { date: string; day: string; weekday: number; today: boolean; count: number };
export type RuntimeDataState = "ready" | "signedOut" | "error";
export type RuntimeBlockView = { id: string; fallback?: string } & (
  | { type: "section"; title: string; style: "card" | "plain"; more: RuntimeLink | null; blocks: RuntimeBlockView[] }
  | { type: "text"; text: string; tone: "body" | "muted" | "notice" }
  | { type: "image"; image: string; fit: "width" | "cover"; action: RuntimeAction | null }
  | { type: "feature"; title: string; body: string; image: string; action: RuntimeAction | null }
  | { type: "entries"; title: string; style: "grid" | "floating"; items: { id: string; label: string; icon: string; action: RuntimeAction }[] }
  | { type: "list"; title: string; template: "card" | "row"; items: RuntimeItem[]; empty: string; more: RuntimeLink | null;
      facets: RuntimeFacet[]; state: RuntimeDataState; message: string }
  | { type: "participants"; title: string; participants: { id: string; name: string; detail: string }[]; selected: string; empty: string; state: RuntimeDataState; message: string }
  | { type: "calendar"; title: string; anchor: string; previous: string; next: string; days: RuntimeDay[]; items: RuntimeItem[];
      empty: string; more: RuntimeLink | null; state: RuntimeDataState; message: string }
  | { type: "account"; signedIn: boolean; name: string; prompt: string; trailing: RuntimeLink | null }
  | { type: "content"; pageId: string }
  | { type: "button"; label: string; appearance: "primary" | "secondary" | "link"; action: RuntimeAction }
  | { type: "divider" }
  | { type: "unsupported" }
);

export const runtimeStringKeys = ["loading", "retry", "unavailable", "signIn", "signInPrompt", "signOut", "today", "weekdays", "all", "close", "updateRequired", "choose", "clear"] as const;
export type RuntimeStringKey = typeof runtimeStringKeys[number];
export type RuntimeTab = { slot: RuntimeTabSlot; label: string; icon: string; activeIcon: string; screen: string };
export type RuntimeApp = {
  protocol: 1; revision: string; locale: RuntimeLocale; signedIn: boolean;
  theme: "paper" | "leaf" | "rose"; brandName: string; tabs: RuntimeTab[]; strings: Record<RuntimeStringKey, string>;
};
export type RuntimeScreen = {
  id: string; revision: string; title: string; navigation: "brand" | "title"; signedIn: boolean; participant: string | null; blocks: RuntimeBlockView[];
};
export type RuntimeBlockResult = { revision: string; block: RuntimeBlockView | null };
