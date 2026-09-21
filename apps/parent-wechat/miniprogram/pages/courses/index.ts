import { get } from "../../lib/api";
import type { Activity } from "../../lib/api-types";
import { pageData,syncPage,text,date,errorText } from "../../lib/page";
Page({
  data:{...pageData("courses"),activities:[] as (Activity&{label:string;when:string})[]},
  onShow(){syncPage(this,"courses");void this.load();},
  async load(){if(this.data.loading)return;this.setData({loading:true,error:""});try{const rows=await get<Activity[]>("activities","",false);this.setData({activities:rows.map(row=>({...row,label:text(row.title),when:date(row.startsAt)}))});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  register(){wx.navigateTo({url:"/pages/register/index"});},
  openActivity(event:WechatMiniprogram.TouchEvent){wx.navigateTo({url:"/pages/activity/index?id="+event.currentTarget.dataset.id});},
});
