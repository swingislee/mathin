# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mathin is a bilingual (zh/en) math exploration website. Chinese is the default locale. See `AGENTS.md` (in Chinese) for the full engineering conventions and Next.js 16 migration notes — the essentials are summarized below.

**Before implementing any feature or visual change, read `docs/plan/` (Chinese)** — it is the authoritative product plan: `00-overview.md` (sections, roles, hard rules for agents), `01-design-system.md` (Little Prince design tokens — never hardcode colors/fonts), `02-pages.md` (per-page layout specs), `03-data-and-tech.md` (data model, RLS, registry patterns), `04-roadmap.md` (phase order and acceptance criteria). Do not build ahead of the current phase.

## Commands

```bash
pnpm dev        # dev server on 0.0.0.0:3130 (LAN: http://192.168.5.213:3130)
pnpm lint       # eslint . — next build does NOT lint in Next.js 16
pnpm typecheck  # tsc --noEmit
pnpm build
```

There is no test suite. Requires `.env.local` (copy from `.env.example`) with the self-hosted Supabase URL and publishable key.

## Test accounts

A fixed set of 5 reusable test accounts (admin / teacher / sales / student / parent, all `@mathin.local`) already exists on the self-hosted dev DB, with roles/staff_role_members/student profile/guardian link pre-bound. Credentials and IDs are in `.claude/test-accounts.local.md` (gitignored, not in this repo — read that file when you need to log in or emulate one of these users). **Reuse this account set for all manual/agent testing; do not create new test accounts.** If a task genuinely requires a new/different account (e.g. testing an unclaimed bind-code flow, multi-child parent, or privilege-escalation case), ask the user to confirm first.

## Stack constraints

- **Next.js pinned to stable 16.2.10** (App Router, React 19, Turbopack default). Do not use 16.3 canary/preview.
- Tailwind CSS 4, next-intl, Supabase SSR, shadcn/ui (`components.json`), pnpm.
- Next.js 16 breaking changes apply: `params`/`searchParams`/`cookies()`/`headers()` are async-only (page props are `Promise<...>` and must be awaited); `revalidateTag(tag)` single-arg is deprecated — use `revalidateTag(tag, "max")` or `updateTag(tag)` in Server Actions; use `next/image` with `remotePatterns`.
- **Route boundary logic lives in `src/proxy.ts` (exports `proxy`). Never create a `middleware.ts`** — it is deprecated in Next.js 16.

## Architecture

**Routing / i18n.** Every route lives under `src/app/[locale]/` and URLs always carry a `/zh` or `/en` prefix (`localePrefix: "always"` in `src/i18n/routing.ts`). Translations are in `messages/{zh,en}.json`. Use the locale-aware navigation helpers from `src/i18n/navigation.ts` instead of `next/link`/`next/navigation` primitives when linking between pages.

**Sections.** Content sections are a single dynamic route, `src/app/[locale]/[section]/page.tsx`, which whitelists public sections (`story`, `games`, `minds`, `terms`, `tools`) and protected ones (`dashboard`, `classroom`, `notebook`, `whiteboard`), then renders the shared `SectionPage` component. Adding a section means updating those lists plus both message files.

**Auth (two layers, both required).**
1. `src/proxy.ts` runs the next-intl middleware, refreshes Supabase auth cookies, and does an *optimistic* redirect to `/{locale}/login` for protected paths. It is not the authorization layer.
2. Protected pages must independently call `requireUser(locale)` from `src/lib/auth.ts`, which uses `supabase.auth.getUser()`. **Never use `getSession()` for server-side authorization.** Real data authorization relies on database RLS.

Login/signup are Server Actions in `src/app/[locale]/(auth)/actions.ts` (note the `next` redirect param is validated against open redirects); the email confirmation/OAuth callback is `src/app/[locale]/auth/callback/route.ts`. Supabase clients: `src/lib/supabase/client.ts` (browser), `server.ts` (Server Components/Actions), `config.ts` (env validation).

**Supabase security.** Only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may reach the browser; never commit secret/service-role keys. Self-hosting details are in `docs/supabase-self-hosting.md`.
