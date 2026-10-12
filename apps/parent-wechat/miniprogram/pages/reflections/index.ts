import { get,session } from "../../lib/api";
import type { Report } from "../../lib/api-types";
import { pageData,syncPage,date,errorText,loginPage,currentLocale } from "../../lib/page";
import { reportSections } from "../../lib/report-template";
import { miniappText } from "../../lib/miniapp-settings";
type ReportRow = { id: string; kind: Report["kind"]; title: string; participantName: string; when: string; preview: string; sections: { source: string; type: string; label: string; text: string }[] };
Page({
  source:[] as Report[],requestVersion:0,
  data:{...pageData("reflections"),authenticated:false,reports:[] as ReportRow[],expanded:""},
  onShow(){syncPage(this,"reflections");this.setData({authenticated:Boolean(session()),reports:[]});if(session())void this.load();},
  onHide(){this.requestVersion++;this.source=[];this.setData({reports:[],expanded:"",loading:false});},
  onUnload(){this.requestVersion++;this.source=[];},
  async load(){if(this.data.loading)return;const version=++this.requestVersion;this.setData({loading:true,error:""});try{const rows=await get<Report[]>("reports");if(version!==this.requestVersion)return;this.source=rows;this.render();}catch(error){if(version===this.requestVersion)this.setData({error:errorText(error)});}finally{if(version===this.requestVersion)this.setData({loading:false});}},
  render(){const locale=currentLocale();this.setData({reports:this.source.map(row=>{const sections=(row.sections||reportSections(row)).map(s=>({...s,label:miniappText(s.label,locale)}));return{id:row.id,kind:row.kind,title:row.title,participantName:row.participantName,when:date(row.date),preview:(sections.find(s=>s.type==="text")?.text||"").slice(0,140),sections:this.data.expanded===row.id?sections:[]};})});},
  login(){loginPage("/pages/reflections/index");},
  toggle(event:WechatMiniprogram.TouchEvent){const id=String(event.currentTarget.dataset.id);this.setData({expanded:this.data.expanded===id?"":id});this.render();},
});
