"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { FilterBar, FilterBarMore, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "@/features/school/FilterBar";
import type { AssetLibraryFilters } from "./data";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Props = { initial: AssetLibraryFilters };

/** 资源库筛选保留在客户端叶子，列表和聚合仍由 Server Component 查询。 */
export function AssetLibraryFilters({ initial }: Props) {
  const t = useTranslations("coursewareStudio");
  const commonT = useTranslations("common");
  const router = useRouter();
  const [query, setQuery] = useState(initial.query);
  const [kind, setKind] = useState(initial.kind ?? "all");
  const [role, setRole] = useState(initial.role ?? "");
  const [track, setTrack] = useState(initial.track);
  const [minUsage, setMinUsage] = useState(String(initial.minUsage));

  const activeCount = [query, kind !== "all", role, track !== "native-16x9", minUsage !== "0"].filter(Boolean).length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (kind !== "all") params.set("kind", kind);
    if (role.trim()) params.set("role", role.trim());
    if (track !== "native-16x9") params.set("track", track);
    if (minUsage !== "0") params.set("minUsage", minUsage);
    const suffix = params.toString();
    router.push(`/dashboard/courseware-assets${suffix ? `?${suffix}` : ""}`);
  };

  return (
    <FilterBar onSubmit={submit} aria-label={t("applyAssetFilters")}>
      <FilterSearchInput id="asset-search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t("assetSearchPlaceholder")} aria-label={t("assetSearch")} />
      <FilterBarMore label={commonT("moreFilters")} activeCount={activeCount}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("assetKind")}</Label>
            <Select value={kind} onValueChange={setKind}>
              <FilterSelectTrigger className="w-full" aria-label={t("assetKind")}><SelectValue /></FilterSelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("assetKindAll")}</SelectItem>
                <SelectItem value="image">{t("assetKindImage")}</SelectItem>
                <SelectItem value="video">{t("assetKindVideo")}</SelectItem>
                <SelectItem value="audio">{t("assetKindAudio")}</SelectItem>
                <SelectItem value="svg">{t("assetKindSvg")}</SelectItem>
                <SelectItem value="h5">{t("assetKindH5")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-role">{t("assetRole")}</Label>
            <Input id="asset-role" value={role} maxLength={100} onChange={(event) => setRole(event.target.value)} placeholder={t("assetRolePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("assetTrack")}</Label>
            <Select value={track} onValueChange={(value) => setTrack(value as "native-16x9" | "adapted-4x3")}>
              <FilterSelectTrigger className="w-full"><SelectValue /></FilterSelectTrigger>
              <SelectContent>
                <SelectItem value="native-16x9">{t("trackNative")}</SelectItem>
                <SelectItem value="adapted-4x3">{t("trackAdapted")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-min-usage">{t("assetMinUsage")}</Label>
            <Input id="asset-min-usage" type="number" min="0" value={minUsage} onChange={(event) => setMinUsage(event.target.value)} />
          </div>
        </div>
      </FilterBarMore>
      <FilterBarSubmit>{t("applyAssetFilters")}</FilterBarSubmit>
      {activeCount > 0 && <FilterBarReset href="/dashboard/courseware-assets" label={commonT("clearFilters")} />}
    </FilterBar>
  );
}
