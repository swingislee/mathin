import { AuthForm } from "@/components/auth-form";
export default async function SignupPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) { const [{ locale }, query] = await Promise.all([params, searchParams]); return <AuthForm mode="signup" locale={locale} hasError={Boolean(query.error)} />; }
