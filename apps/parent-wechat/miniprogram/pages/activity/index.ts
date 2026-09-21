import {get,post,session} from "../../lib/api";
import type {Account,Activity,Participant} from "../../lib/api-types";
import {pageData,syncPage,text,date,errorText,loginPage} from "../../lib/page";
Page({
  data:{...pageData("courses"),id:"",activity:null as (Activity&{label:string;body:string;when:string})|null,participants:[] as Participant[],selected:0,authenticated:false,busy:false,booked:false},
  onLoad(query:Record<string,string>){this.setData({id:query.id||""});},
  onShow(){syncPage(this,"courses","activityDetail");this.setData({authenticated:Boolean(session())});void this.load();},
  async load(){this.setData({loading:true,error:""});try{const rows=await get<Activity[]>("activities","",false);const item=rows.find(row=>row.id===this.data.id);if(!item){this.setData({error:this.data.copy.notFound});return;}this.setData({activity:{...item,label:text(item.title),body:text(item.description),when:date(item.startsAt)}});if(session()){const account=await get<Account>("account");this.setData({participants:account.participants});}}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  change(e:WechatMiniprogram.PickerChange){this.setData({selected:Number(e.detail.value),booked:false});},login:loginPage,
  async book(){const participant=this.data.participants[this.data.selected];if(this.data.busy||!participant)return;this.setData({busy:true,error:""});try{await post({action:"book",activityId:this.data.id,participantId:participant.id});this.setData({booked:true});wx.showToast({title:this.data.copy.confirmed,icon:"success"});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}},
});
