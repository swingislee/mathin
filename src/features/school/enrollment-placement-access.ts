import 'server-only';
import { staffRpcClient } from './actions/guards';
import { enrollmentWorkflowRpc } from './enrollment-workflow-data';

/** 调班按实际任课关系授权；完整报名管理继续由各自 Action 校验。 */
export async function authorizedEnrollmentPlacementClient() {
  await staffRpcClient();
  if (await enrollmentWorkflowRpc('can_access_enrollment_placement') !== true) {
    throw new Error('FORBIDDEN');
  }
}
