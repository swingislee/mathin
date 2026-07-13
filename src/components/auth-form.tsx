import { getTranslations } from "next-intl/server";
import { Star4 } from "@/components/star4";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { login, signup } from "@/app/[locale]/(auth)/actions";
import { Input } from "@/components/ui/input";

export async function AuthForm({ mode, locale, hasError, next }: { mode: "login" | "signup"; locale: string; hasError: boolean; next?: string }) {
  const t = await getTranslations("auth");
  const action = mode === "login" ? login : signup;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Star4 size={24} className="mb-6" />
        <form action={action} className="w-full rounded-[2rem] border bg-card p-8 shadow-sm">
          <Link href="/" className="font-display text-xl">Mathin</Link>
          <h1 className="mb-8 mt-8 font-display text-3xl">{t(mode === "login" ? "loginTitle" : "signupTitle")}</h1>
          <Input type="hidden" name="locale" value={locale} />
          {next && <Input type="hidden" name="next" value={next} />}
          <label className="mb-2 block text-sm" htmlFor="email">{t("email")}</label>
          <Input className="mb-5 rounded-full bg-transparent px-4 py-3" id="email" name="email" type="email" required autoComplete="email" />
          <label className="mb-2 block text-sm" htmlFor="password">{t("password")}</label>
          <Input className="rounded-full bg-transparent px-4 py-3" id="password" name="password" type="password" minLength={6} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {hasError && <p className="mt-4 text-sm text-rose">{t("error")}</p>}
          <button className={cn(buttonVariants({ size: "lg" }), "mt-7 w-full")} type="submit">{t(mode)}</button>
          {mode==="login"&&<Link href="/login/phone" className="mt-3 block text-center text-sm text-crater underline underline-offset-2">{t("phoneLogin")}</Link>}
          <p className="mt-6 text-center text-sm text-muted">
            {t(mode === "login" ? "noAccount" : "hasAccount")}{" "}
            <Link className="underline transition-colors duration-200 hover:text-ink" href={mode === "login" ? "/signup" : "/login"}>{t(mode === "login" ? "signup" : "login")}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
