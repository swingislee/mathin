"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { COMMON_EMAIL_DOMAINS, mainlandPhoneInput, splitEmailInput, type EmailInputParts } from "./login-identifier-input";

type FieldProps = { id: string; disabled: boolean; autoFocus: boolean };
const groupClass = "flex h-11 min-w-0 items-center rounded-full border border-line bg-transparent shadow-sm focus-within:border-crater focus-within:ring-2 focus-within:ring-crater/25";
const inputClass = "h-full min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0";

export function EmailLoginInput({ id, disabled, autoFocus, value, onChange }: FieldProps & { value: EmailInputParts; onChange: (value: EmailInputParts) => void }) {
  const t = useTranslations("auth");
  return <div className="space-y-2">
    <Label htmlFor={`${id}-local`}>{t("email")}</Label>
    <div className={groupClass} role="group" aria-label={t("email")}>
      <Input id={`${id}-local`} name="emailLocalPart" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
        className={`${inputClass} w-0 flex-1 rounded-l-full pl-4 pr-1`} value={value.localPart} placeholder={t("emailLocalPart")}
        aria-label={t("emailLocalPart")} pattern={"[^@\\s]+"} required maxLength={254} readOnly={disabled} autoFocus={autoFocus}
        onChange={(event) => onChange(splitEmailInput(event.target.value, value.domain))} />
      <span className="shrink-0 px-1 text-sm text-muted" aria-hidden>@</span>
      <Input id={`${id}-domain`} name="emailDomain" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
        className={`${inputClass} w-0 flex-1 px-1`} value={value.domain} placeholder={t("emailDomainPlaceholder")}
        aria-label={t("emailDomain")} pattern={"[^@\\s]+\\.[^@\\s]+"} required maxLength={253} readOnly={disabled}
        onChange={(event) => onChange({ ...value, domain: event.target.value.replace(/^@/, "") })} />
      <Select value={value.domain} onValueChange={(domain) => onChange({ ...value, domain })} disabled={disabled}>
        <SelectTrigger aria-label={t("commonEmailDomains")} className="mr-1 h-9 w-8 shrink-0 justify-center rounded-full border-0 bg-transparent p-0 shadow-none hover:translate-y-0 focus:ring-0">
          <span className="sr-only">{value.domain}</span>
        </SelectTrigger>
        <SelectContent align="end">{COMMON_EMAIL_DOMAINS.map((domain) => <SelectItem key={domain} value={domain}>{domain}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  </div>;
}

export function PhoneLoginInput({ id, disabled, autoFocus, value, onChange }: FieldProps & { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("auth");
  return <div className="space-y-2">
    <Label htmlFor={id}>{t("phoneNumber")}</Label>
    <div className={groupClass} role="group" aria-label={t("phoneNumber")}>
      <Select value="+86" disabled={disabled}>
        <SelectTrigger aria-label={t("phoneCountryCode")} className="h-full w-24 shrink-0 rounded-l-full rounded-r-none border-0 border-r bg-transparent pl-4 shadow-none hover:translate-y-0 focus:ring-0"><span>+86</span></SelectTrigger>
        <SelectContent align="start"><SelectItem value="+86">+86</SelectItem></SelectContent>
      </Select>
      <Input id={id} name="phoneNational" type="tel" inputMode="numeric" autoComplete="tel-national" className={`${inputClass} flex-1 rounded-r-full pl-3 pr-4`}
        value={value} placeholder={t("phoneNationalPlaceholder")} pattern="1[3-9][0-9]{9}" required maxLength={20} readOnly={disabled} autoFocus={autoFocus}
        onChange={(event) => onChange(mainlandPhoneInput(event.target.value))} />
    </div>
  </div>;
}
