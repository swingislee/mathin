"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssetLibraryFilters } from "./data";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Props = { initial: AssetLibraryFilters };

/** 资源库筛选保留在客户端叶子，列表和聚合仍由 Server Component 查询。 */
export function AssetLibraryFilters({ initial }: Props) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [query, setQuery] = useState(initial.query);
  const [kind, setKind] = useState(initial.kind ?? "all");
  const [role, setRole] = useState(initial.role ?? "");
  const [track, setTrack] = useState(initial.track);
  const [minUsage, setMinUsage] = useState(String(initial.minUsage));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (kind !== "all") params.set("kind", kind);
    if (role.trim()) params.set("role", role.trim());
    if (track !== "native-16x9") params.set("track", track);
    if (minUsage !== "0") params.set("minUsage", minUsage);
    const suffix = params.toString();
    router.push(`/dashboard/shared-assets${suffix ? `?${suffix}` : ""}`);
  };

  return (
    <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-[minmax(12rem,1fr)_10rem_10rem_10rem_8rem_auto] md:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="asset-search">{t("assetSearch")}</Label>
        <Input className="h-10 min-h-10" id="asset-search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t("assetSearchPlaceholder")} />
      </div>
      <div className="space-y-1.5">
        <Label>{t("assetKind")}</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-10 min-h-10"><SelectValue /></SelectTrigger>
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
        <Input className="h-10 min-h-10" id="asset-role" value={role} maxLength={100} onChange={(event) => setRole(event.target.value)} placeholder={t("assetRolePlaceholder")} />
      </div>
      <div className="space-y-1.5">
        <Label>{t("assetTrack")}</Label>
        <Select value={track} onValueChange={(value) => setTrack(value as "native-16x9" | "adapted-4x3")}>
          <SelectTrigger className="h-10 min-h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="native-16x9">{t("trackNative")}</SelectItem>
            <SelectItem value="adapted-4x3">{t("trackAdapted")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="asset-min-usage">{t("assetMinUsage")}</Label>
        <Input className="h-10 min-h-10" id="asset-min-usage" type="number" min="0" value={minUsage} onChange={(event) => setMinUsage(event.target.value)} />
      </div>
      <Button type="submit" size="sm"><Search className="size-4" />{t("applyAssetFilters")}</Button>
    </form>
  );
}
