import { get,session } from "../../lib/api";
import type { ActivityTask } from "../../lib/api-types";
import { pageData,syncPage,date,errorText,loginPage } from "../../lib/page";
Page({
  data:{...pageData("records"),authenticated:false,tasks:[] as (ActivityTask&{key:string;when:string})[]},
  onShow(){syncPage(this,"records");this.setData({authenticated:Boolean(session()),tasks:[]});if(session())void this.load();},
  async load(){if(this.data.loading)return;this.setData({loading:true,error:""});try{const rows=await get<ActivityTask[]>("tasks");this.setData({tasks:rows.map(row=>({...row,key:row.id+row.participantId,when:date(row.dueAt)}))});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  login(){loginPage("/pages/records/index");},
  open(event:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/pages/task/index?id=${event.currentTarget.dataset.id}&participant=${event.currentTarget.dataset.participant}`});},
});
