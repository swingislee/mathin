import {get,post,login,logout,session} from "../../lib/api";
import type {Account,Booking} from "../../lib/api-types";
import {pageData,syncPage,date,text,errorText} from "../../lib/page";
Page({
  data:{...pageData("account"),authenticated:false,identifier:"",password:"",busy:false,account:null as Account|null,bookings:[] as (Booking&{label:string;when:string;statusText:string})[]},
  onShow(){syncPage(this,"account");this.setData({authenticated:Boolean(session()),account:null,bookings:[]});if(session())void this.load();},
  identifierInput(e:WechatMiniprogram.Input){this.setData({identifier:e.detail.value});},
  passwordInput(e:WechatMiniprogram.Input){this.setData({password:e.detail.value});},
  async signIn(){if(this.data.busy)return;this.setData({busy:true,error:""});try{await login(this.data.identifier,this.data.password);this.setData({authenticated:true,password:""});await this.load();}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}},
  async signOut(){if(this.data.busy)return;this.setData({busy:true});try{await logout();}catch{}finally{this.setData({busy:false,authenticated:false,account:null,bookings:[],error:"",password:""});}},
  async load(){this.setData({loading:true,error:""});try{const [account,bookings]=await Promise.all([get<Account>("account"),get<Booking[]>("bookings")]);const c=this.data.copy;const labels={booked:c.booked,attended:c.attended,no_show:c.noShow,cancelled:c.cancelled};this.setData({account,bookings:bookings.map(row=>({...row,label:text(row.title),when:date(row.startsAt),statusText:labels[row.status]}))});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  cancel(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const id=String(e.currentTarget.dataset.id);wx.showModal({title:this.data.copy.cancelBooking,content:this.data.copy.cancelConfirm,confirmText:this.data.locale==="en"?"Confirm":"确认取消",cancelText:this.data.locale==="en"?"Keep":"保留预约",success:result=>{if(result.confirm)void this.doCancel(id);}});},
  async doCancel(id:string){this.setData({busy:true,error:""});try{await post({action:"cancel",id});await this.load();}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}},
});
