import { describe, expect, it } from 'vitest';
import { schoolSupportGroups, schoolSupportGroupFilter } from '@/features/school/school-collaboration-contract';
import { followupFieldPage } from '@/features/school/followup-table-page';
import { leadIntakeTableFields } from '@/features/school/lead-intake-table-fields';
import type { LeadPoolRow } from '@/features/school/lead-contract';
import { applyBaseLeadAcquisition } from '@/features/school/base-lead-acquisition';

describe('current support group filters',()=>{
  it('keeps empty groups selectable and applies group membership before pagination',()=>{
    const groups=[{id:'empty',name:'空组',memberIds:[]},{id:'active',name:'合成组',memberIds:['support']}];
    const query={version:2 as const,filters:{},sort:null};
    const rows: LeadPoolRow[]=Array.from({length:125},(_,i)=>({id:String(i),provisionalStudentName:`合成${i}`,ownerId:i<100?null:'support',interests:[],status:'uncontacted',
      phone:'',gradeHint:null,gradeText:'',ownerName:'',suggestedStudentId:null,suggestedStudentName:'',createdAt:'',acquiredAt:null,
      acquisitionLocation:'',acquisitionMethod:'',acquisitionPromoter:'',sourceCount:0,sourceMarkedDuplicate:false,contactCount:0,lastContactAt:null,
      lastContactOutcome:null,lastContactNote:'',wechatAdded:null,visitCommitted:null,interestLevel:null,nextContactAt:null,activeInvitation:null,
      supportGroups:schoolSupportGroups(i<100?null:'support',groups)}));
    const fields=leadIntakeTableFields(k=>k,k=>k,k=>k),context={locale:'zh',timeZone:'Asia/Shanghai',now:0};
    const sourceOwner=applyBaseLeadAcquisition(rows[0],[],'合成历史学服');
    expect(sourceOwner.ownerName).toBe('合成历史学服');
    expect(sourceOwner.ownerId).toBeNull();
    if(fields.owner.kind!=='enum') throw Error('OWNER_FILTER_TYPE');
    expect(fields.owner.values(sourceOwner)).toEqual([{value:'source:合成历史学服',label:'合成历史学服'}]);
    expect(applyBaseLeadAcquisition({...rows[0],ownerId:'manual',ownerName:'已指定学服'},[],'合成历史学服').ownerName).toBe('已指定学服');
    const page=followupFieldPage(rows,fields,schoolSupportGroupFilter(query,'active'),context,1,20);
    expect(page.count).toBe(25);expect(page.rows[0].id).toBe('100');
    expect(followupFieldPage(rows,fields,schoolSupportGroupFilter(query,'empty'),context,1,20).count).toBe(0);
    expect(schoolSupportGroupFilter(schoolSupportGroupFilter(query,'active'),'all')).toEqual(query);
  });
});
