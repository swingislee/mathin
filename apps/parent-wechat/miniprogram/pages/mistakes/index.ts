import { get,session } from "../../lib/api";
import type { Report } from "../../lib/api-types";
import { pageData,syncPage,date,errorText,loginPage } from "../../lib/page";
Page({
  data:{...pageData("mistakes"),authenticated:false,reports:[] as (Report&{when:string})[],expanded:""},
  onShow(){syncPage(this,"mistakes");this.setData({authenticated:Boolean(session()),reports:[]});if(session())void this.load();},
  async load(){if(this.data.loading)return;this.setData({loading:true,error:""});try{const rows=await get<Report[]>("reports");this.setData({reports:rows.map(row=>({...row,when:date(row.date)}))});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  login:loginPage,
  toggle(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);this.setData({expanded:this.data.expanded===id?"":id});},
});
