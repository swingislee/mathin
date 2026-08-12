import { verifySpatialPageLayoutSet } from "./page-schema";
import {
  SPATIAL_PAGE_DELIVERY_VERSION,
  parseSpatialPageDeliveryPlan,
  parseSpatialPageDeliveryRequest,
  type SpatialPageDeliveryPlan,
} from "./page-delivery-schema";

/**
 * 把空间文档自己的 layout 与 P6 历史 track 兼容键解耦。
 *
 * 该纯计划不写数据库；SML-0 后续 RPC 必须在同一事务复核 revision 归属、
 * capability 与状态后，原子推进这里给出的两条 head，禁止逐轨半发布。
 */
export async function buildSpatialPageDeliveryPlan(input: unknown): Promise<SpatialPageDeliveryPlan> {
  const request = parseSpatialPageDeliveryRequest(input);
  const verified = await verifySpatialPageLayoutSet(request.standard.page, request.wide?.page);
  const nativeRevision = request.wide ?? request.standard;

  return parseSpatialPageDeliveryPlan({
    deliveryVersion: SPATIAL_PAGE_DELIVERY_VERSION,
    pageDocId: request.pageDocId,
    docVersion: verified.standard.docVersion,
    sceneHash: verified.standard.sceneHash,
    mode: request.wide ? "wide-16x9-exception" : "shared-standard-4x3",
    atomic: true,
    heads: [
      {
        track: "native-16x9",
        revisionId: nativeRevision.revisionId,
        revisionNo: nativeRevision.revisionNo,
        layoutProfile: nativeRevision.page.layout.profile,
      },
      {
        track: "adapted-4x3",
        revisionId: request.standard.revisionId,
        revisionNo: request.standard.revisionNo,
        layoutProfile: "standard-4x3",
      },
    ],
  });
}
