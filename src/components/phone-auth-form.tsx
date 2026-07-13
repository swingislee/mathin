"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "@/i18n/navigation";

export function PhoneAuthForm(){
 const t=useTranslations("auth");const router=useRouter();const[phone,setPhone]=useState("");const[token,setToken]=useState("");const[sent,setSent]=useState(false);const[pending,setPending]=useState(false);const[error,setError]=useState(false);
 const send=async()=>{setPending(true);setError(false);const{error}=await createClient().auth.signInWithOtp({phone});setPending(false);if(error)setError(true);else setSent(true)};
 const verify=async()=>{setPending(true);setError(false);const{error}=await createClient().auth.verifyOtp({phone,token,type:"sms"});setPending(false);if(error)setError(true);else router.replace("/dashboard")};
 return <main className="grid min-h-screen place-items-center p-6"><div className="w-full max-w-sm rounded-[2rem] border bg-card p-8 shadow-sm"><h1 className="font-display text-3xl">{t("phoneLogin")}</h1><p className="mt-2 text-sm text-muted">{t("phoneHint")}</p><label className="mb-2 mt-6 block text-sm" htmlFor="phone">{t("phone")}</label><Input id="phone" inputMode="tel" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} disabled={sent||pending} placeholder="+86 138 0000 0000"/>{sent&&<><label className="mb-2 mt-5 block text-sm" htmlFor="otp">{t("otp")}</label><Input id="otp" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={event=>setToken(event.target.value)} maxLength={6}/></>}{error&&<p role="alert" className="mt-3 text-sm text-rose">{t("phoneError")}</p>}<Button className="mt-6 w-full" disabled={pending||!phone||(sent&&!token)} onClick={()=>void(sent?verify():send())}>{sent?t("verifyOtp"):t("sendOtp")}</Button></div></main>;
}
