"use client";

import { Building2, CalendarDays, Flag, LoaderCircle, MapPin, RotateCcw, Save, Settings2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
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
const errorMessage = (fallback: string) => ({ default: fallback });

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

function ScopeSelect({ campuses, value, onChange, globalLabel }: { campuses: CampusSettings[]; value: string | null; onChange: (value: string | null) => void; globalLabel: string }) {
  return (
    <Select value={value ?? GLOBAL_SCOPE} onValueChange={(next) => onChange(next === GLOBAL_SCOPE ? null : next)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL_SCOPE}>{globalLabel}</SelectItem>
        {campuses.map((campus) => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function SectionCard({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-moon/45 text-crater">{icon}</span>
        <div><h2 className="font-display text-lg text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-muted">{description}</p></div>
      </div>
      <div className="mt-5">{children}</div>
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
  const [newCampusCode, setNewCampusCode] = useState("");
  const [newCampusName, setNewCampusName] = useState("");
  const [newCampusTimezone, setNewCampusTimezone] = useState("");
  const createCampusRun = useAction(createCampusAction, { successMessage: t("campusCreated"), errorMessage: errors, onSuccess: refresh });

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

  const pending = profileRun.pending || createCampusRun.pending || updateCampusRun.pending || roomRun.pending || roomActiveRun.pending
    || holidayRun.pending || archiveHolidayRun.pending || ruleRun.pending
    || rollbackRuleRun.pending || flagRun.pending || rollbackFlagRun.pending;
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return (
    <Tabs defaultValue="profile" className="space-y-5">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-line/30 p-1.5">
        <TabsTrigger value="profile">{t("tabProfile")}</TabsTrigger>
        <TabsTrigger value="locations">{t("tabLocations")}</TabsTrigger>
        <TabsTrigger value="rules">{t("tabRules")}</TabsTrigger>
        <TabsTrigger value="features">{t("tabFeatures")}</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <SectionCard title={t("profileTitle")} description={t("profileIntro")} icon={<Building2 size={19} />}>
          <div className="grid gap-4 @2xl/page:grid-cols-2 @5xl/page:grid-cols-3">
            <Label className="grid gap-2">{t("organizationName")}<Input value={organizationName} maxLength={100} onChange={(event) => setOrganizationName(event.target.value)} /></Label>
            <Label className="grid gap-2">{t("timezone")}<Input value={organizationTimezone} maxLength={64} onChange={(event) => setOrganizationTimezone(event.target.value)} /></Label>
            <Label className="grid gap-2">{t("defaultLocale")}<Select value={defaultLocale} onValueChange={(value) => setDefaultLocale(value as "zh" | "en")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zh">中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></Label>
          </div>
          <div className="mt-5 flex justify-end"><Button disabled={pending} onClick={() => profileRun.run({ name: organizationName, timezone: organizationTimezone, defaultLocale })}>{profileRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("save")}</Button></div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="locations" className="space-y-5">
        <SectionCard title={t("campusTitle")} description={t("campusIntro")} icon={<MapPin size={19} />}>
          <div className="grid gap-4 @3xl/page:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <Label className="grid gap-2">{t("selectCampus")}<Select value={campusId} onValueChange={chooseCampus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{initial.campuses.map((campus) => <SelectItem key={campus.id} value={campus.id}>{campus.name} · {campus.code}</SelectItem>)}</SelectContent></Select></Label>
              {selectedCampus && <div className="mt-4 grid gap-3">
                <Label className="grid gap-2">{t("campusName")}<Input value={campusName} maxLength={100} onChange={(event) => setCampusName(event.target.value)} /></Label>
                <Label className="grid gap-2">{t("campusTimezone")}<Input value={campusTimezone} maxLength={64} placeholder={initial.organization.timezone} onChange={(event) => setCampusTimezone(event.target.value)} /></Label>
                <Label className="grid gap-2">{t("status")}<Select value={campusStatus} onValueChange={(value) => setCampusStatus(value as "active" | "archived")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">{t("active")}</SelectItem><SelectItem value="archived">{t("archived")}</SelectItem></SelectContent></Select></Label>
                <Label className="flex items-center gap-3 font-normal"><Checkbox checked={campusDefault} onCheckedChange={(checked) => setCampusDefault(checked === true)} />{t("defaultCampus")}</Label>
                <Button disabled={pending || !campusName.trim()} onClick={() => updateCampusRun.run({ campusId: selectedCampus.id, name: campusName, timezone: campusTimezone.trim() || null, status: campusStatus, isDefault: campusDefault })}>{t("saveCampus")}</Button>
              </div>}
            </div>
            <div className="rounded-xl border border-line p-4">
              <h3 className="font-medium">{t("addCampus")}</h3>
              <div className="mt-3 grid gap-3">
                <Label className="grid gap-2">{t("campusCode")}<Input value={newCampusCode} maxLength={40} onChange={(event) => setNewCampusCode(event.target.value.toLowerCase())} /></Label>
                <Label className="grid gap-2">{t("campusName")}<Input value={newCampusName} maxLength={100} onChange={(event) => setNewCampusName(event.target.value)} /></Label>
                <Label className="grid gap-2">{t("campusTimezone")}<Input value={newCampusTimezone} maxLength={64} placeholder={initial.organization.timezone} onChange={(event) => setNewCampusTimezone(event.target.value)} /></Label>
                <Button variant="secondary" disabled={pending || !newCampusCode.trim() || !newCampusName.trim()} onClick={() => createCampusRun.run({ code: newCampusCode, name: newCampusName, timezone: newCampusTimezone.trim() || null })}>{t("createCampus")}</Button>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title={t("roomTitle")} description={t("roomIntro")} icon={<Building2 size={19} />}>
          {!selectedCampus ? <p className="text-sm text-muted">{t("noCampus")}</p> : <>
            <ul className="divide-y divide-line">{selectedCampus.rooms.map((room) => <li key={room.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1"><strong>{room.name}</strong> · {room.code} · {room.capacity ?? t("capacityUnset")}</span><Badge variant={room.isActive ? "secondary" : "outline"}>{room.isActive ? t("active") : t("inactive")}</Badge><Button size="sm" variant="secondary" disabled={pending} onClick={() => roomActiveRun.run(room.id, !room.isActive)}>{room.isActive ? t("disable") : t("enable")}</Button></li>)}</ul>
            <div className="mt-4 grid gap-3 @2xl/page:grid-cols-2 @5xl/page:grid-cols-4">
              <Label className="grid gap-2">{t("roomCode")}<Input value={roomCode} maxLength={40} onChange={(event) => setRoomCode(event.target.value)} /></Label>
              <Label className="grid gap-2 @5xl/page:col-span-2">{t("roomName")}<Input value={roomName} maxLength={100} onChange={(event) => setRoomName(event.target.value)} /></Label>
              <Label className="grid gap-2">{t("capacity")}<Input type="number" min={1} max={500} value={roomCapacity} onChange={(event) => setRoomCapacity(event.target.value)} /></Label>
            </div>
            <div className="mt-3 flex justify-end"><Button variant="secondary" disabled={pending || !roomCode.trim() || !roomName.trim()} onClick={() => roomRun.run({ campusId: selectedCampus.id, code: roomCode, name: roomName, capacity: roomCapacity ? Number(roomCapacity) : null })}>{t("createRoom")}</Button></div>
          </>}
        </SectionCard>

        <SectionCard title={t("calendarTitle")} description={t("calendarIntro")} icon={<CalendarDays size={19} />}>
          <div>
            <div><h3 className="font-medium">{t("holidays")}</h3><ul className="mt-2 divide-y divide-line">{initial.holidays.map((holiday) => <li key={holiday.id} className="flex items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1">{holiday.name} · {holiday.startsOn} — {holiday.endsOn}</span><Badge variant="outline">{t(`holiday_${holiday.kind}`)}</Badge><Button size="sm" variant="secondary" disabled={pending} onClick={() => archiveHolidayRun.run(holiday.id)}>{t("archive")}</Button></li>)}</ul>
              <div className="mt-3 grid gap-3 @xl/page:grid-cols-2"><ScopeSelect campuses={activeCampuses} value={holidayCampusId} onChange={setHolidayCampusId} globalLabel={t("allCampuses")} /><Select value={holidayKind} onValueChange={(value) => setHolidayKind(value as typeof holidayKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="closed">{t("holiday_closed")}</SelectItem><SelectItem value="teaching">{t("holiday_teaching")}</SelectItem><SelectItem value="makeup">{t("holiday_makeup")}</SelectItem></SelectContent></Select><Input value={holidayName} maxLength={100} placeholder={t("holidayName")} onChange={(event) => setHolidayName(event.target.value)} /><span className="grid grid-cols-2 gap-2"><Input type="date" value={holidayStart} onChange={(event) => setHolidayStart(event.target.value)} /><Input type="date" value={holidayEnd} onChange={(event) => setHolidayEnd(event.target.value)} /></span></div>
              <Button className="mt-3" size="sm" variant="secondary" disabled={pending || !holidayName.trim() || !holidayStart || !holidayEnd} onClick={() => holidayRun.run({ campusId: holidayCampusId, name: holidayName, kind: holidayKind, startsOn: holidayStart, endsOn: holidayEnd })}>{t("createHoliday")}</Button>
            </div>
          </div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="rules">
        <SectionCard title={t("rulesTitle")} description={t("rulesIntro")} icon={<Settings2 size={19} />}>
          <div className="grid gap-4 @2xl/page:grid-cols-2 @5xl/page:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <Label className="grid gap-2">{t("ruleDomain")}<Select value={ruleDomain} onValueChange={(value) => chooseRule(value as OrganizationRuleDomain, ruleCampusId)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ORGANIZATION_RULE_DOMAINS.map((domain) => <SelectItem key={domain} value={domain}>{t(`rule_${domain}`)}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-2">{t("scope")}<ScopeSelect campuses={activeCampuses} value={ruleCampusId} onChange={(scope) => chooseRule(ruleDomain, scope)} globalLabel={t("allCampuses")} /></Label>
            <Label className="grid gap-2">{t("effectiveAt")}<Input type="datetime-local" value={ruleEffectiveAt} onChange={(event) => setRuleEffectiveAt(event.target.value)} /></Label>
          </div>
          <Label className="mt-4 grid gap-2">{t("ruleValue")}<Textarea rows={10} value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="font-mono text-xs" /></Label>
          <Label className="mt-4 grid gap-2">{t("changeReason")}<Input value={ruleReason} maxLength={200} onChange={(event) => setRuleReason(event.target.value)} /></Label>
          <div className="mt-4 flex justify-end"><Button disabled={pending || !ruleEffectiveAt || !ruleReason.trim()} onClick={() => ruleRun.run({ domain: ruleDomain, campusId: ruleCampusId, valueText: ruleValue, effectiveAt: toIso(ruleEffectiveAt), reason: ruleReason })}>{t("createVersion")}</Button></div>
          <div className="mt-6 border-t border-line pt-4"><h3 className="font-medium">{t("versionHistory")}</h3><ul className="mt-2 divide-y divide-line">{ruleHistory.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="font-mono">v{row.version}</span><span className="min-w-0 flex-1 text-muted">{formatTime(row.effectiveFrom)} · {row.reason} · {row.createdBy || t("systemActor")}</span>{isEffective(row) && <Badge variant="secondary">{t("effective")}</Badge>}<Button size="sm" variant="secondary" disabled={pending || isEffective(row)} onClick={() => rollbackRuleRun.run(row.id, new Date().toISOString(), t("rollbackReason", { version: row.version }))}><RotateCcw className="size-3.5" />{t("rollback")}</Button></li>)}</ul></div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="features">
        <SectionCard title={t("featuresTitle")} description={t("featuresIntro")} icon={<Flag size={19} />}>
          <div className="rounded-xl border border-line bg-paper/45 p-4 text-sm text-muted">{t("failClosedNotice")}</div>
          <div className="mt-4 grid gap-4 @2xl/page:grid-cols-2 @5xl/page:grid-cols-3">
            <Label className="grid gap-2">{t("feature")}<Select value={flagKey} onValueChange={(value) => chooseFlag(value as OrganizationFeatureKey, flagCampusId)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ORGANIZATION_FEATURE_KEYS.map((key) => <SelectItem key={key} value={key}>{t(`flag_${key.replaceAll(".", "_")}`)}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-2">{t("scope")}<ScopeSelect campuses={activeCampuses} value={flagCampusId} onChange={(scope) => chooseFlag(flagKey, scope)} globalLabel={t("allCampuses")} /></Label>
            <Label className="grid gap-2">{t("effectiveAt")}<Input type="datetime-local" value={flagEffectiveAt} onChange={(event) => setFlagEffectiveAt(event.target.value)} /></Label>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-line p-4"><Checkbox checked={financeReleaseClosed ? false : flagEnabled} disabled={financeReleaseClosed} onCheckedChange={(checked) => setFlagEnabled(checked === true)} /><div className="min-w-0 flex-1"><p className="font-medium">{financeReleaseClosed ? t("financeReleaseClosed") : flagEnabled ? t("enabled") : t("disabled")}</p><p className="mt-1 text-xs text-muted">{financeReleaseClosed ? t("financeReleaseClosedHelp") : t(`flagHelp_${flagKey.replaceAll(".", "_")}`)}</p></div><Badge variant={financeReleaseClosed || !flagEnabled ? "outline" : "default"}>{financeReleaseClosed || !flagEnabled ? t("off") : t("on")}</Badge></div>
          <Label className="mt-4 grid gap-2">{t("changeReason")}<Input value={flagReason} maxLength={200} onChange={(event) => setFlagReason(event.target.value)} /></Label>
          <div className="mt-4 flex justify-end"><Button disabled={financeReleaseClosed || pending || !flagEffectiveAt || !flagReason.trim()} onClick={() => flagRun.run({ flagKey, campusId: flagCampusId, enabled: flagEnabled, effectiveAt: toIso(flagEffectiveAt), reason: flagReason })}>{t("createVersion")}</Button></div>
          <div className="mt-6 border-t border-line pt-4"><h3 className="font-medium">{t("versionHistory")}</h3><ul className="mt-2 divide-y divide-line">{flagHistory.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="font-mono">v{row.version}</span><Badge variant={row.enabled ? "default" : "outline"}>{row.enabled ? t("on") : t("off")}</Badge><span className="min-w-0 flex-1 text-muted">{formatTime(row.effectiveFrom)} · {row.reason} · {row.createdBy || t("systemActor")}</span>{isEffective(row) && <Badge variant="secondary">{t("effective")}</Badge>}<Button size="sm" variant="secondary" disabled={financeReleaseClosed || pending || isEffective(row)} onClick={() => rollbackFlagRun.run(row.id, new Date().toISOString(), t("rollbackReason", { version: row.version }))}><RotateCcw className="size-3.5" />{t("rollback")}</Button></li>)}</ul></div>
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}
