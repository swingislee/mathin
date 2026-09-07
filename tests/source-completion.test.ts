import {describe,expect,it} from 'vitest';
import {sourceCompletionSummary,sourceCompletionMessages} from '@/features/school/source-completion-contract';
import {assessmentWorkbenchRowsForView,type AssessmentWorkbenchRow} from '@/features/school/assessment-workbench-contract';

const facts={version:1,confirmed:true,assessmentBand:'a_plus',registeredOn:'2026-09-02'};
describe('来源阶段确认与资料待补',()=>{
  it('报名确认前序阶段，未到的场次不承载等级',()=>{
    const result=sourceCompletionSummary([facts],false,[{status:'no_show',hasResult:false,date:null,band:null,score:null,teacher:null}]);
    expect(result).toMatchObject({enrolled:true,knownBand:'a_plus'});
    expect(result?.missing).toContain('first_contact');
    expect(result?.missing).toContain('assessment_occurrence');
    expect(result?.missing).not.toContain('assessment_band');
  });
  it('补齐当前事实后缺项消失',()=>{
    expect(sourceCompletionSummary([facts],true,[{status:'attended',hasResult:true,date:'2026-08-23',band:'a_plus',score:85,teacher:'已登记老师'}])?.missing).toEqual([]);
  });
  it('多个来源班型冲突时显示核对项',()=>{
    const result=sourceCompletionSummary([facts,{...facts,assessmentBand:'s'}],true,[]);
    expect(result?.knownBand).toBeNull();expect(result?.missing).toContain('band_conflict');
  });
  it('没有确认报名的来源维持现有流程',()=>{
    expect(sourceCompletionSummary([null,{confirmed:false}],false,[])).toBeNull();
  });
  it('已结束的预约退出工作队列，全部记录保留同一学生的每次预约',()=>{
    const base={name:'示例学生',phone:'',gradeText:'',location:'',assessorName:'',background:'',scheduledAt:'2026-08-20',updatedAt:'2026-08-20',
      recordState:'current',assessmentKind:'one_to_one',assessment:null,assessmentStartedAt:null,assessmentCompletedAt:null,route:null} as AssessmentWorkbenchRow;
    const rows=[{...base,id:'first',participationStatus:'no_show' as const},{...base,id:'second',participationStatus:'booked' as const}];
    expect(assessmentWorkbenchRowsForView(rows,{queue:'pending'},'zh').map(row=>row.id)).toEqual(['second']);
    expect(assessmentWorkbenchRowsForView(rows,{queue:'all',q:'示例学生'},'zh')).toHaveLength(2);
  });
  it('补充标签保持中英文对应',()=>{
    expect(Object.keys(sourceCompletionMessages('zh').missing)).toEqual(Object.keys(sourceCompletionMessages('en').missing));
    expect(sourceCompletionMessages('en').noShow).toBe('No show');
  });
});
