"use client";

import { Building2, CalendarDays, Flag, LoaderCircle, MapPin, RotateCcw, Save, Settings2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  archiveSchoolHolidayAction,
  createCampusAction,
  createCampusRoomAction,
  createSchoolHolidayAction,
  rollbackFeatureFlagAction,
  rollbackOrganizationRuleAction,
  setCampusRoomActiveAction,
  setFeatureFlagAction,
  setOrganizationRuleAction,
  updateCampusAction,
  updateOrganizationProfileAction,
} from "./actions/organization-settings";
import {
  ORGANIZATION_FEATURE_KEYS,
  ORGANIZATION_RULE_DOMAINS,
  type CampusSettings,
  type FeatureFlagVersion,
  type OrganizationFeatureKey,
  type OrganizationRuleDomain,
  type OrganizationRuleVersion,
  type OrganizationSettingsSnapshot,
} from "./organization-settings-contract";

const GLOBAL_SCOPE = "__global__";
const CAMPUS_CODE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const SETTINGS_CONTROL_CLASS = "rounded-none border-x-0 border-t-0 border-b border-line/60 bg-transparent px-0 shadow-none hover:translate-y-0 hover:border-crater/70 hover:bg-transparent focus:border-crater focus:ring-0 focus-visible:border-crater focus-visible:ring-0 aria-invalid:border-rose";
const errorMessage = (fallback: string) => ({ default: fallback });

function SettingsInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input className={cn(SETTINGS_CONTROL_CLASS, className)} {...props} />;
}

function SettingsSelectTrigger({ className, ...props }: React.ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className={cn(SETTINGS_CONTROL_CLASS, className)} {...props} />;
}

function SettingsField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 py-1.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <Label htmlFor={htmlFor} className="pt-2 leading-5 text-muted">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SettingsActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid pt-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <div className="flex justify-start sm:col-start-2">{children}</div>
    </div>
  );
}

function localDatetimeNow() {
  const now = new Date(Date.now() + 60_000);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

function isEffective(row: { effectiveFrom: string; effectiveUntil: string | null }, at = Date.now()) {
  return Date.parse(row.effectiveFrom) <= at && (!row.effectiveUntil || Date.parse(row.effectiveUntil) > at);
}

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function nextCampusCode(campuses: CampusSettings[], reservedCode?: string) {
  const existing = new Set(campuses.map((campus) => campus.code));
  if (reservedCode) existing.add(reservedCode);
  let index = Math.max(1, existing.size + 1);
  while (existing.has(`campus-${index}`)) index += 1;
  return `campus-${index}`;
}

function effectiveRule(rows: OrganizationRuleVersion[], domain: OrganizationRuleDomain, campusId: string | null) {
  return rows
    .filter((row) => row.domain === domain && isEffective(row) && (row.campusId === campusId || row.campusId === null))
    .sort((a, b) => Number(b.campusId !== null) - Number(a.campusId !== null) || Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.version - a.version)[0];
}

function effectiveFlag(rows: FeatureFlagVersion[], flagKey: OrganizationFeatureKey, campusId: string | null) {
  return rows
    .filter((row) => row.flagKey === flagKey && isEffective(row) && (row.campusId === campusId || row.campusId === null))
    .sort((a, b) => Number(b.campusId !== null) - Number(a.campusId !== null) || Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.version - a.version)[0];
}

function ScopeSelect({ campuses, value, onChange, globalLabel, triggerId }: { campuses: CampusSettings[]; value: string | null; onChange: (value: string | null) => void; globalLabel: string; triggerId: string }) {
  return (
    <Select value={value ?? GLOBAL_SCOPE} onValueChange={(next) => onChange(next === GLOBAL_SCOPE ? null : next)}>
      <SettingsSelectTrigger id={triggerId}><SelectValue /></SettingsSelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL_SCOPE}>{globalLabel}</SelectItem>
        {campuses.map((campus) => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function SettingsSection({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-crater">{icon}</span>
        <div><h2 className="font-display text-lg text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-muted">{description}</p></div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function OrganizationSettingsPanel({ initial }: { initial: OrganizationSettingsSnapshot }) {
  const t = useTranslations("school.organization");
  const locale = useLocale();
  const router = useRouter();
  const refresh = () => router.refresh();
  const errors = errorMessage(t("actionFailed"));

  const [organizationName, setOrganizationName] = useState(initial.organization.name);
  const [organizationTimezone, setOrganizationTimezone] = useState(initial.organization.timezone);
  const [defaultLocale, setDefaultLocale] = useState<"zh" | "en">(initial.organization.defaultLocale);
  const profileRun = useAction(updateOrganizationProfileAction, { successMessage: t("saved"), errorMessage: errors, onSuccess: refresh });

  const activeCampuses = initial.campuses.filter((campus) => campus.status === "active");
  const [campusId, setCampusId] = useState(initial.campuses[0]?.id ?? "");
  const selectedCampus = initial.campuses.find((campus) => campus.id === campusId) ?? initial.campuses[0];
  const [campusName, setCampusName] = useState(selectedCampus?.name ?? "");
  const [campusTimezone, setCampusTimezone] = useState(selectedCampus?.timezone ?? "");
  const [campusStatus, setCampusStatus] = useState<"active" | "archived">(selectedCampus?.status ?? "active");
  const [campusDefault, setCampusDefault] = useState(selectedCampus?.isDefault ?? false);
  const chooseCampus = (id: string) => {
    const campus = initial.campuses.find((row) => row.id === id);
    setCampusId(id);
    setCampusName(campus?.name ?? "");
    setCampusTimezone(campus?.timezone ?? "");
    setCampusStatus(campus?.status ?? "active");
    setCampusDefault(campus?.isDefault ?? false);
  };
  const updateCampusRun = useAction(updateCampusAction, { successMessage: t("campusSaved"), errorMessage: errors, onSuccess: refresh });
  const [newCampusCode, setNewCampusCode] = useState(() => nextCampusCode(initial.campuses));
  const [newCampusName, setNewCampusName] = useState("");
  const [newCampusTimezone, setNewCampusTimezone] = useState("");
  const createCampusRun = useAction(createCampusAction, {
    successMessage: t("campusCreated"),
    errorMessage: {
      INVALID_CAMPUS: t("campusInvalid"),
      CAMPUS_CODE_EXISTS: t("campusCodeExists"),
      VALIDATION: t("campusInvalid"),
      default: t("actionFailed"),
    },
    onSuccess: () => {
      setNewCampusCode(nextCampusCode(initial.campuses, newCampusCode.trim().toLowerCase()));
      setNewCampusName("");
      setNewCampusTimezone("");
      refresh();
    },
  });

  const [roomCode, setRoomCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const roomRun = useAction(createCampusRoomAction, { successMessage: t("roomCreated"), errorMessage: errors, onSuccess: refresh });
  const roomActiveRun = useAction(setCampusRoomActiveAction, { successMessage: t("roomSaved"), errorMessage: errors, onSuccess: refresh });

  const [holidayCampusId, setHolidayCampusId] = useState<string | null>(null);
  const [holidayName, setHolidayName] = useState("");
  const [holidayKind, setHolidayKind] = useState<"closed" | "teaching" | "makeup">("closed");
  const [holidayStart, setHolidayStart] = useState("");
  const [holidayEnd, setHolidayEnd] = useState("");
  const holidayRun = useAction(createSchoolHolidayAction, { successMessage: t("holidayCreated"), errorMessage: errors, onSuccess: refresh });
  const archiveHolidayRun = useAction(archiveSchoolHolidayAction, { successMessage: t("holidayArchived"), errorMessage: errors, onSuccess: refresh });

  const [ruleDomain, setRuleDomain] = useState<OrganizationRuleDomain>("calendar");
  const [ruleCampusId, setRuleCampusId] = useState<string | null>(null);
  const firstRule = effectiveRule(initial.rules, "calendar", null);
  const [ruleValue, setRuleValue] = useState(JSON.stringify(firstRule?.value ?? {}, null, 2));
  const [ruleEffectiveAt, setRuleEffectiveAt] = useState(localDatetimeNow);
  const [ruleReason, setRuleReason] = useState("");
  const chooseRule = (domain: OrganizationRuleDomain, scope: string | null) => {
    setRuleDomain(domain);
    setRuleCampusId(scope);
    setRuleValue(JSON.stringify(effectiveRule(initial.rules, domain, scope)?.value ?? {}, null, 2));
  };
  const ruleRun = useAction(setOrganizationRuleAction, { successMessage: t("ruleSaved"), errorMessage: errors, onSuccess: refresh });
  const rollbackRuleRun = useAction(rollbackOrganizationRuleAction, { successMessage: t("rollbackCreated"), errorMessage: errors, onSuccess: refresh });
  const ruleHistory = useMemo(() => initial.rules.filter((row) => row.domain === ruleDomain && row.campusId === ruleCampusId), [initial.rules, ruleDomain, ruleCampusId]);

  const [flagKey, setFlagKey] = useState<OrganizationFeatureKey>("finance.enabled");
  const [flagCampusId, setFlagCampusId] = useState<string | null>(null);
  const [flagEnabled, setFlagEnabled] = useState(effectiveFlag(initial.featureFlags, "finance.enabled", null)?.enabled ?? false);
  const [flagEffectiveAt, setFlagEffectiveAt] = useState(localDatetimeNow);
  const [flagReason, setFlagReason] = useState("");
  const chooseFlag = (key: OrganizationFeatureKey, scope: string | null) => {
    setFlagKey(key);
    setFlagCampusId(scope);
    setFlagEnabled(effectiveFlag(initial.featureFlags, key, scope)?.enabled ?? false);
  };
  const flagRun = useAction(setFeatureFlagAction, { successMessage: t("flagSaved"), errorMessage: errors, onSuccess: refresh });
  const rollbackFlagRun = useAction(rollbackFeatureFlagAction, { successMessage: t("rollbackCreated"), errorMessage: errors, onSuccess: refresh });
  const flagHistory = useMemo(() => initial.featureFlags.filter((row) => row.flagKey === flagKey && row.campusId === flagCampusId), [initial.featureFlags, flagKey, flagCampusId]);
  const financeReleaseClosed = flagKey === "finance.enabled";
  const normalizedNewCampusCode = newCampusCode.trim().toLowerCase();
  const newCampusCodeValid = CAMPUS_CODE_PATTERN.test(normalizedNewCampusCode);
  const newCampusCodeExists = initial.campuses.some((campus) => campus.code === normalizedNewCampusCode);
  const normalizedNewCampusTimezone = newCampusTimezone.trim();
  const newCampusTimezoneValid = !normalizedNewCampusTimezone || isIanaTimezone(normalizedNewCampusTimezone);
  const canCreateCampus = Boolean(newCampusName.trim()) && newCampusCodeValid && !newCampusCodeExists && newCampusTimezoneValid;

  const pending = profileRun.pending || createCampusRun.pending || updateCampusRun.pending || roomRun.pending || roomActiveRun.pending
    || holidayRun.pending || archiveHolidayRun.pending || ruleRun.pending
    || rollbackRuleRun.pending || flagRun.pending || rollbackFlagRun.pending;
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return (
    <Tabs defaultValue="profile">
      <TabsList className="h-auto min-h-9 w-fit max-w-full flex-wrap justify-start gap-x-0.5 gap-y-1">
        <TabsTrigger value="profile">{t("tabProfile")}</TabsTrigger>
        <TabsTrigger value="locations">{t("tabLocations")}</TabsTrigger>
        <TabsTrigger value="rules">{t("tabRules")}</TabsTrigger>
        <TabsTrigger value="features">{t("tabFeatures")}</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="mt-0">
        <SettingsSection title={t("profileTitle")} description={t("profileIntro")} icon={<Building2 size={19} />}>
          <div className="space-y-0.5">
            <SettingsField label={t("organizationName")} htmlFor="organization-name">
              <SettingsInput id="organization-name" value={organizationName} maxLength={100} onChange={(event) => setOrganizationName(event.target.value)} />
            </SettingsField>
            <SettingsField label={t("timezone")} htmlFor="organization-timezone">
              <SettingsInput id="organization-timezone" value={organizationTimezone} maxLength={64} onChange={(event) => setOrganizationTimezone(event.target.value)} />
            </SettingsField>
            <SettingsField label={t("defaultLocale")} htmlFor="organization-locale">
              <Select value={defaultLocale} onValueChange={(value) => setDefaultLocale(value as "zh" | "en")}>
                <SettingsSelectTrigger id="organization-locale"><SelectValue /></SettingsSelectTrigger>
                <SelectContent><SelectItem value="zh">中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
              </Select>
            </SettingsField>
          </div>
          <SettingsActionRow><Button size="sm" disabled={pending} onClick={() => profileRun.run({ name: organizationName, timezone: organizationTimezone, defaultLocale })}>{profileRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("save")}</Button></SettingsActionRow>
        </SettingsSection>
      </TabsContent>

      <TabsContent value="locations" className="mt-0">
        <SettingsSection title={t("campusTitle")} description={t("campusIntro")} icon={<MapPin size={19} />}>
          <div className="space-y-0.5">
            <SettingsField label={t("selectCampus")} htmlFor="campus-select">
              <Select value={campusId} onValueChange={chooseCampus}>
                <SettingsSelectTrigger id="campus-select"><SelectValue /></SettingsSelectTrigger>
                <SelectContent>{initial.campuses.map((campus) => <SelectItem key={campus.id} value={campus.id}>{campus.name} · {campus.code}</SelectItem>)}</SelectContent>
              </Select>
            </SettingsField>
            {selectedCampus ? <>
              <SettingsField label={t("campusName")} htmlFor="campus-name">
                <SettingsInput id="campus-name" value={campusName} maxLength={100} onChange={(event) => setCampusName(event.target.value)} />
              </SettingsField>
              <SettingsField label={t("campusTimezone")} htmlFor="campus-timezone">
                <SettingsInput id="campus-timezone" value={campusTimezone} maxLength={64} placeholder={initial.organization.timezone} onChange={(event) => setCampusTimezone(event.target.value)} />
              </SettingsField>
              <SettingsField label={t("status")} htmlFor="campus-status">
                <Select value={campusStatus} onValueChange={(value) => setCampusStatus(value as "active" | "archived")}>
                  <SettingsSelectTrigger id="campus-status"><SelectValue /></SettingsSelectTrigger>
                  <SelectContent><SelectItem value="active">{t("active")}</SelectItem><SelectItem value="archived">{t("archived")}</SelectItem></SelectContent>
                </Select>
              </SettingsField>
              <SettingsField label={t("defaultCampus")} htmlFor="campus-default">
                <div className="flex min-h-10 items-center"><Checkbox id="campus-default" checked={campusDefault} onCheckedChange={(checked) => setCampusDefault(checked === true)} /></div>
              </SettingsField>
            </> : null}
          </div>
          {selectedCampus ? <SettingsActionRow><Button size="sm" disabled={pending || !campusName.trim()} onClick={() => updateCampusRun.run({ campusId: selectedCampus.id, name: campusName, timezone: campusTimezone.trim() || null, status: campusStatus, isDefault: campusDefault })}>{t("saveCampus")}</Button></SettingsActionRow> : null}

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="font-medium text-ink">{t("addCampus")}</h3>
            <div className="mt-2 space-y-0.5">
              <SettingsField label={t("campusCode")} htmlFor="new-campus-code">
                <SettingsInput
                  id="new-campus-code"
                  value={newCampusCode}
                  maxLength={40}
                  aria-invalid={!newCampusCodeValid || newCampusCodeExists}
                  aria-describedby="new-campus-code-help"
                  onChange={(event) => setNewCampusCode(event.target.value.toLowerCase().replaceAll(" ", "-"))}
                />
                <p id="new-campus-code-help" className={`mt-2 text-xs ${!newCampusCodeValid || newCampusCodeExists ? "text-rose" : "text-muted"}`}>
                  {!newCampusCodeValid ? t("campusCodeInvalid") : newCampusCodeExists ? t("campusCodeExists") : t("campusCodeHint")}
                </p>
              </SettingsField>
              <SettingsField label={t("campusName")} htmlFor="new-campus-name">
                <SettingsInput id="new-campus-name" value={newCampusName} maxLength={100} onChange={(event) => setNewCampusName(event.target.value)} />
              </SettingsField>
              <SettingsField label={t("campusTimezone")} htmlFor="new-campus-timezone">
                <SettingsInput id="new-campus-timezone" value={newCampusTimezone} maxLength={64} aria-invalid={!newCampusTimezoneValid} aria-describedby="new-campus-timezone-help" placeholder={initial.organization.timezone} onChange={(event) => setNewCampusTimezone(event.target.value)} />
                {!newCampusTimezoneValid ? <p id="new-campus-timezone-help" className="mt-2 text-xs text-rose">{t("campusTimezoneInvalid")}</p> : null}
              </SettingsField>
            </div>
            <SettingsActionRow><Button size="sm" variant="secondary" disabled={pending || !canCreateCampus} onClick={() => createCampusRun.run({ code: normalizedNewCampusCode, name: newCampusName, timezone: normalizedNewCampusTimezone || null })}>{t("createCampus")}</Button></SettingsActionRow>
          </div>
        </SettingsSection>

        <SettingsSection title={t("roomTitle")} description={t("roomIntro")} icon={<Building2 size={19} />}>
          {!selectedCampus ? <p className="text-sm text-muted">{t("noCampus")}</p> : <>
            <ul className="divide-y divide-line">{selectedCampus.rooms.map((room) => <li key={room.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1"><strong>{room.name}</strong> · {room.code} · {room.capacity ?? t("capacityUnset")}</span><Badge variant={room.isActive ? "secondary" : "outline"}>{room.isActive ? t("active") : t("inactive")}</Badge><Button size="sm" variant="secondary" disabled={pending} onClick={() => roomActiveRun.run(room.id, !room.isActive)}>{room.isActive ? t("disable") : t("enable")}</Button></li>)}</ul>
            <div className="mt-3 space-y-0.5">
              <SettingsField label={t("roomCode")} htmlFor="room-code">
                <SettingsInput id="room-code" value={roomCode} maxLength={40} onChange={(event) => setRoomCode(event.target.value)} />
              </SettingsField>
              <SettingsField label={t("roomName")} htmlFor="room-name">
                <SettingsInput id="room-name" value={roomName} maxLength={100} onChange={(event) => setRoomName(event.target.value)} />
              </SettingsField>
              <SettingsField label={t("capacity")} htmlFor="room-capacity">
                <SettingsInput id="room-capacity" type="number" min={1} max={500} value={roomCapacity} onChange={(event) => setRoomCapacity(event.target.value)} />
              </SettingsField>
            </div>
            <SettingsActionRow><Button size="sm" variant="secondary" disabled={pending || !roomCode.trim() || !roomName.trim()} onClick={() => roomRun.run({ campusId: selectedCampus.id, code: roomCode, name: roomName, capacity: roomCapacity ? Number(roomCapacity) : null })}>{t("createRoom")}</Button></SettingsActionRow>
          </>}
        </SettingsSection>

        <SettingsSection title={t("calendarTitle")} description={t("calendarIntro")} icon={<CalendarDays size={19} />}>
          <div>
            <div><h3 className="font-medium">{t("holidays")}</h3><ul className="mt-2 divide-y divide-line">{initial.holidays.map((holiday) => <li key={holiday.id} className="flex items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1">{holiday.name} · {holiday.startsOn} — {holiday.endsOn}</span><Badge variant="outline">{t(`holiday_${holiday.kind}`)}</Badge><Button size="sm" variant="secondary" disabled={pending} onClick={() => archiveHolidayRun.run(holiday.id)}>{t("archive")}</Button></li>)}</ul>
              <div className="mt-2 space-y-0.5">
                <SettingsField label={t("scope")} htmlFor="holiday-scope">
                  <ScopeSelect triggerId="holiday-scope" campuses={activeCampuses} value={holidayCampusId} onChange={setHolidayCampusId} globalLabel={t("allCampuses")} />
                </SettingsField>
                <SettingsField label={t("holidayKind")} htmlFor="holiday-kind">
                  <Select value={holidayKind} onValueChange={(value) => setHolidayKind(value as typeof holidayKind)}>
                    <SettingsSelectTrigger id="holiday-kind"><SelectValue /></SettingsSelectTrigger>
                    <SelectContent><SelectItem value="closed">{t("holiday_closed")}</SelectItem><SelectItem value="teaching">{t("holiday_teaching")}</SelectItem><SelectItem value="makeup">{t("holiday_makeup")}</SelectItem></SelectContent>
                  </Select>
                </SettingsField>
                <SettingsField label={t("holidayName")} htmlFor="holiday-name">
                  <SettingsInput id="holiday-name" value={holidayName} maxLength={100} onChange={(event) => setHolidayName(event.target.value)} />
                </SettingsField>
                <SettingsField label={t("startsOn")} htmlFor="holiday-start">
                  <DateTimePicker id="holiday-start" className={SETTINGS_CONTROL_CLASS} value={holidayStart} onValueChange={setHolidayStart} />
                </SettingsField>
                <SettingsField label={t("endsOn")} htmlFor="holiday-end">
                  <DateTimePicker id="holiday-end" className={SETTINGS_CONTROL_CLASS} value={holidayEnd} onValueChange={setHolidayEnd} />
                </SettingsField>
              </div>
              <SettingsActionRow><Button size="sm" variant="secondary" disabled={pending || !holidayName.trim() || !holidayStart || !holidayEnd} onClick={() => holidayRun.run({ campusId: holidayCampusId, name: holidayName, kind: holidayKind, startsOn: holidayStart, endsOn: holidayEnd })}>{t("createHoliday")}</Button></SettingsActionRow>
            </div>
          </div>
        </SettingsSection>
      </TabsContent>

      <TabsContent value="rules" className="mt-0">
        <SettingsSection title={t("rulesTitle")} description={t("rulesIntro")} icon={<Settings2 size={19} />}>
          <div className="space-y-0.5">
            <SettingsField label={t("ruleDomain")} htmlFor="rule-domain">
              <Select value={ruleDomain} onValueChange={(value) => chooseRule(value as OrganizationRuleDomain, ruleCampusId)}>
                <SettingsSelectTrigger id="rule-domain"><SelectValue /></SettingsSelectTrigger>
                <SelectContent>{ORGANIZATION_RULE_DOMAINS.map((domain) => <SelectItem key={domain} value={domain}>{t(`rule_${domain}`)}</SelectItem>)}</SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("scope")} htmlFor="rule-scope">
              <ScopeSelect triggerId="rule-scope" campuses={activeCampuses} value={ruleCampusId} onChange={(scope) => chooseRule(ruleDomain, scope)} globalLabel={t("allCampuses")} />
            </SettingsField>
            <SettingsField label={t("effectiveAt")} htmlFor="rule-effective-at">
              <DateTimePicker id="rule-effective-at" className={SETTINGS_CONTROL_CLASS} mode="datetime" value={ruleEffectiveAt} onValueChange={setRuleEffectiveAt} />
            </SettingsField>
            <SettingsField label={t("ruleValue")} htmlFor="rule-value">
              <Textarea id="rule-value" rows={10} value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="font-mono text-xs" />
            </SettingsField>
            <SettingsField label={t("changeReason")} htmlFor="rule-reason">
              <SettingsInput id="rule-reason" value={ruleReason} maxLength={200} onChange={(event) => setRuleReason(event.target.value)} />
            </SettingsField>
          </div>
          <SettingsActionRow><Button size="sm" disabled={pending || !ruleEffectiveAt || !ruleReason.trim()} onClick={() => ruleRun.run({ domain: ruleDomain, campusId: ruleCampusId, valueText: ruleValue, effectiveAt: toIso(ruleEffectiveAt), reason: ruleReason })}>{t("createVersion")}</Button></SettingsActionRow>
          <div className="mt-6 border-t border-line pt-4"><h3 className="font-medium">{t("versionHistory")}</h3><ul className="mt-2 divide-y divide-line">{ruleHistory.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="font-mono">v{row.version}</span><span className="min-w-0 flex-1 text-muted">{formatTime(row.effectiveFrom)} · {row.reason} · {row.createdBy || t("systemActor")}</span>{isEffective(row) && <Badge variant="secondary">{t("effective")}</Badge>}<Button size="sm" variant="secondary" disabled={pending || isEffective(row)} onClick={() => rollbackRuleRun.run(row.id, new Date().toISOString(), t("rollbackReason", { version: row.version }))}><RotateCcw className="size-3.5" />{t("rollback")}</Button></li>)}</ul></div>
        </SettingsSection>
      </TabsContent>

      <TabsContent value="features" className="mt-0">
        <SettingsSection title={t("featuresTitle")} description={t("featuresIntro")} icon={<Flag size={19} />}>
          <div className="border-l-2 border-crater/50 py-2 pl-3 text-sm text-muted">{t("failClosedNotice")}</div>
          <div className="mt-3 space-y-0.5">
            <SettingsField label={t("feature")} htmlFor="feature-key">
              <Select value={flagKey} onValueChange={(value) => chooseFlag(value as OrganizationFeatureKey, flagCampusId)}>
                <SettingsSelectTrigger id="feature-key"><SelectValue /></SettingsSelectTrigger>
                <SelectContent>{ORGANIZATION_FEATURE_KEYS.map((key) => <SelectItem key={key} value={key}>{t(`flag_${key.replaceAll(".", "_")}`)}</SelectItem>)}</SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("scope")} htmlFor="feature-scope">
              <ScopeSelect triggerId="feature-scope" campuses={activeCampuses} value={flagCampusId} onChange={(scope) => chooseFlag(flagKey, scope)} globalLabel={t("allCampuses")} />
            </SettingsField>
            <SettingsField label={t("effectiveAt")} htmlFor="feature-effective-at">
              <DateTimePicker id="feature-effective-at" className={SETTINGS_CONTROL_CLASS} mode="datetime" value={flagEffectiveAt} onValueChange={setFlagEffectiveAt} />
            </SettingsField>
            <SettingsField label={t("status")} htmlFor="feature-enabled">
              <div className="flex min-h-10 items-center gap-3">
                <Checkbox id="feature-enabled" checked={financeReleaseClosed ? false : flagEnabled} disabled={financeReleaseClosed} onCheckedChange={(checked) => setFlagEnabled(checked === true)} />
                <div className="min-w-0 flex-1"><p className="font-medium">{financeReleaseClosed ? t("financeReleaseClosed") : flagEnabled ? t("enabled") : t("disabled")}</p><p className="mt-1 text-xs text-muted">{financeReleaseClosed ? t("financeReleaseClosedHelp") : t(`flagHelp_${flagKey.replaceAll(".", "_")}`)}</p></div>
                <Badge variant={financeReleaseClosed || !flagEnabled ? "outline" : "default"}>{financeReleaseClosed || !flagEnabled ? t("off") : t("on")}</Badge>
              </div>
            </SettingsField>
            <SettingsField label={t("changeReason")} htmlFor="feature-reason">
              <SettingsInput id="feature-reason" value={flagReason} maxLength={200} onChange={(event) => setFlagReason(event.target.value)} />
            </SettingsField>
          </div>
          <SettingsActionRow><Button size="sm" disabled={financeReleaseClosed || pending || !flagEffectiveAt || !flagReason.trim()} onClick={() => flagRun.run({ flagKey, campusId: flagCampusId, enabled: flagEnabled, effectiveAt: toIso(flagEffectiveAt), reason: flagReason })}>{t("createVersion")}</Button></SettingsActionRow>
          <div className="mt-6 border-t border-line pt-4"><h3 className="font-medium">{t("versionHistory")}</h3><ul className="mt-2 divide-y divide-line">{flagHistory.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="font-mono">v{row.version}</span><Badge variant={row.enabled ? "default" : "outline"}>{row.enabled ? t("on") : t("off")}</Badge><span className="min-w-0 flex-1 text-muted">{formatTime(row.effectiveFrom)} · {row.reason} · {row.createdBy || t("systemActor")}</span>{isEffective(row) && <Badge variant="secondary">{t("effective")}</Badge>}<Button size="sm" variant="secondary" disabled={financeReleaseClosed || pending || isEffective(row)} onClick={() => rollbackFlagRun.run(row.id, new Date().toISOString(), t("rollbackReason", { version: row.version }))}><RotateCcw className="size-3.5" />{t("rollback")}</Button></li>)}</ul></div>
        </SettingsSection>
      </TabsContent>
    </Tabs>
  );
}
