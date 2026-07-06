import { AuthForm } from "@/components/auth-form";
export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; next?: string }> }) { const [{ locale }, query] = await Promise.all([params, searchParams]); return <AuthForm mode="login" locale={locale} hasError={Boolean(query.error)} next={query.next} />; }
