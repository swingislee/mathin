"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RoomOptionV2 } from "./organization-locations";

const TBD_VALUE = "__room_tbd__";

export function RoomPicker({
  rooms,
  value,
  onValueChange,
  capacity,
  id,
  disabled = false,
}: {
  rooms: RoomOptionV2[];
  value: string | null;
  onValueChange: (roomId: string | null) => void;
  capacity?: number | null;
  id?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("school.locationPicker");
  const groups = new Map<string, { name: string; rooms: RoomOptionV2[] }>();
  for (const room of rooms) {
    const group = groups.get(room.campusId) ?? { name: room.campusName, rooms: [] };
    group.rooms.push(room);
    groups.set(room.campusId, group);
  }
  const selected = value ? rooms.find((room) => room.id === value) ?? null : null;
  const capacityWarning = Boolean(capacity && selected?.capacity && capacity > selected.capacity);

  return (
    <div className="grid gap-1.5">
      <Select value={value ?? TBD_VALUE} disabled={disabled} onValueChange={(next) => onValueChange(next === TBD_VALUE ? null : next)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TBD_VALUE}>{t("tbd")}</SelectItem>
          {Array.from(groups.entries()).map(([campusId, group]) => (
            <SelectGroup key={campusId}>
              <SelectLabel>{group.name}</SelectLabel>
              {group.rooms.map((room) => (
                <SelectItem key={room.id} value={room.id}>
                  {room.name}{room.capacity ? ` · ${t("capacity", { capacity: room.capacity })}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {rooms.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : null}
      {capacityWarning ? (
        <p role="status" className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("capacityWarning", { classCapacity: capacity!, roomCapacity: selected!.capacity! })}
        </p>
      ) : null}
    </div>
  );
}
