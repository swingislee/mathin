import { getTranslations } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ZeroReferenceAsset } from "./testdata";

function formatBytes(byteCount: number): string {
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KB`;
  return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

/** 只读报告：本期不接 Storage 物理删除，人工判断后再决定是否手动清理。 */
export async function CoursewareZeroReferenceReport({ assets }: { assets: ZeroReferenceAsset[] }) {
  const t = await getTranslations("school.testdata");
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-medium text-ink">{t("zeroRefTitle", { count: assets.length })}</h2>
      <p className="mt-1 text-sm text-muted">{t("zeroRefHint")}</p>
      {assets.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("zeroRefEmpty")}</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          <Table className="w-full text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("zeroRefColName")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("zeroRefColKind")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("zeroRefColSize")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("zeroRefColPath")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {assets.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell className="px-4 py-3 font-medium">{asset.name || t("zeroRefUnnamed")}</TableCell>
                  <TableCell className="px-4 py-3 text-muted">{asset.kind}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums text-muted">{formatBytes(asset.byteCount)}</TableCell>
                  <TableCell className="max-w-xs truncate px-4 py-3 text-xs text-muted">{asset.storagePath}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
