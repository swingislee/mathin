import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardEmptyCard, DashboardTableShell } from "./dashboard-page";
import type { CampusV2 } from "./organization-locations";

export async function CampusList({ campuses }: { campuses: CampusV2[] }) {
  const t = await getTranslations("school.locations");
  if (campuses.length === 0) return <DashboardEmptyCard>{t("emptyCampuses")}</DashboardEmptyCard>;

  return (
    <DashboardTableShell>
      <Table className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead>{t("campusName")}</TableHead>
            <TableHead>{t("address")}</TableHead>
            <TableHead>{t("roomsTitle")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead className="text-right">{t("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campuses.map((campus) => {
            const activeRooms = campus.rooms.filter((room) => room.status === "active").length;
            return (
              <TableRow key={campus.id}>
                <TableCell className="font-medium text-ink">{campus.name}</TableCell>
                <TableCell className="max-w-sm truncate text-muted">{campus.address || t("addressUnset")}</TableCell>
                <TableCell className="text-muted">{t("roomSummary", { active: activeRooms, total: campus.rooms.length })}</TableCell>
                <TableCell><Badge variant={campus.status === "active" ? "secondary" : "outline"}>{t(campus.status)}</Badge></TableCell>
                <TableCell className="text-right">
                  <Link href={`/dashboard/campuses/${campus.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink hover:underline">
                    {t("manageCampus")}<ArrowRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
