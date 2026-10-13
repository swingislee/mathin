import { configuredPage } from "../../lib/native-page";
import { get,session } from "../../lib/api";
import type { ActivityTask } from "../../lib/api-types";
import { pageData,syncPage,date,errorText,loginPage } from "../../lib/page";
configuredPage("records")({
  requestVersion: 0,
  data:{...pageData("records"),authenticated:false,tasks:[] as (ActivityTask&{key:string;when:string})[]},
  onShow(){syncPage(this,"records");this.setData({authenticated:Boolean(session()),tasks:[],loading:false});if(session())void this.load();},
  onHide(){this.requestVersion++;this.setData({tasks:[],loading:false});},
  onUnload(){this.requestVersion++;},
  async load(){if(this.data.loading)return;const version=++this.requestVersion;this.setData({loading:true,error:""});try{const rows=await get<ActivityTask[]>("tasks");if(version===this.requestVersion)this.setData({tasks:rows.map(row=>({...row,key:row.id+row.participantId,when:date(row.dueAt)}))});}catch(error){if(version===this.requestVersion)this.setData({error:errorText(error)});}finally{if(version===this.requestVersion)this.setData({loading:false});}},
  login(){loginPage("/pages/records/index");},
  open(event:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/pages/task/index?id=${event.currentTarget.dataset.id}&participant=${event.currentTarget.dataset.participant}`});},
});
