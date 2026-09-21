import { get,session } from "../../lib/api";
import type { Practice } from "../../lib/api-types";
import { pageData,syncPage,date,errorText,loginPage } from "../../lib/page";
Page({
  data:{...pageData("homework"),authenticated:false,practices:[] as (Practice&{key:string;when:string})[]},
  onShow(){syncPage(this,"homework");this.setData({authenticated:Boolean(session()),practices:[]});if(session())void this.load();},
  async load(){if(this.data.loading)return;this.setData({loading:true,error:""});try{const rows=await get<Practice[]>("practices");this.setData({practices:rows.map(row=>({...row,key:row.id+row.participantId,when:date(row.dueAt)}))});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  login:loginPage,
  open(event:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/pages/practice/index?id=${event.currentTarget.dataset.id}&participant=${event.currentTarget.dataset.participant}`});},
});
