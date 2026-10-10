import {get,post,requestId,getRegistrationHistory,session} from "../../lib/api";
import type {IntakeForm,RegistrationRecord} from "../../lib/api-types";
import {pageData,syncPage,text,errorText,date,loginPage} from "../../lib/page";
import {participantWording} from "../../lib/participant-wording";
const formText=(value:Parameters<typeof text>[0])=>participantWording(text(value));
type FieldView={id:string;type:string;label:string;required:boolean;value:string;index:number;options:{id:string;label:string;checked:boolean}[]};
function recordView(record:RegistrationRecord){return {id:record.id,title:formText(record.title),submittedAt:date(record.submittedAt),expanded:false,
  sections:record.sections.map(section=>({title:formText(section.title),fields:section.fields.map(field=>({label:formText(field.label),value:formText(field.value)}))}))};}
Page({
  data:{...pageData("calendar"),hub:true,loggedIn:false,records:[] as ReturnType<typeof recordView>[],historyPage:1,hasMore:false,registrationRequired:true,saved:false,
    slug:"",source:"",requestId:"",form:null as IntakeForm|null,formTitle:"",formDescription:"",privacy:"",fields:[] as FieldView[],answers:{} as Record<string,string|string[]>,consent:false,busy:false,submitted:false,optionField:-1},
  onLoad(query:Record<string,string>){this.setData({hub:!query.form,slug:query.form||"",saved:query.saved==="1",source:(query.source||query.scene||"").slice(0,120),requestId:requestId()});syncPage(this,"calendar","source");if(query.form)void this.load();},
  onShow(){syncPage(this,"calendar","source");if(this.data.hub)void this.loadHistory();},
  async loadHistory(more=false){
    if(this.data.loading)return;
    const page=more===true?this.data.historyPage+1:1;
    this.setData({loggedIn:Boolean(session()),error:"",...(page===1?{records:[],hasMore:false}:{})});
    if(!session())return;
    this.setData({loading:true});
    try{const result=await getRegistrationHistory(page);const rows=result.records.map(recordView);
      this.setData({records:page===1?rows:[...this.data.records,...rows.filter(row=>!this.data.records.some(saved=>saved.id===row.id))],
        historyPage:page,hasMore:result.hasMore,registrationRequired:result.registrationRequired});
    }catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}
  },
  moreHistory(){void this.loadHistory(true);},
  toggleRecord(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);if(this.data.records[index])this.setData({[`records[${index}].expanded`]:!this.data.records[index].expanded});},
  fillRegistration(){wx.navigateTo({url:"/pages/onboarding/index"+(this.data.loggedIn&&!this.data.registrationRequired?"?registration=1":"")});},
  login(){loginPage("/pages/register/index");},
  showOptions(e:WechatMiniprogram.TouchEvent){if(!this.data.busy)this.setData({optionField:Number(e.currentTarget.dataset.index)});},
  closeOptions(){this.setData({optionField:-1});},
  noop(){},
  chooseOption(e:WechatMiniprogram.TouchEvent){const index=this.data.optionField,field=this.data.fields[index],selected=Number(e.currentTarget.dataset.value),option=field?.options[selected];if(option){this.setData({[`answers.${field.id}`]:option.id,[`fields[${index}].value`]:option.label,[`fields[${index}].index`]:selected,optionField:-1});}},
  async load(){this.setData({loading:true,error:""});try{const form=await get<IntakeForm>("form","&form="+encodeURIComponent(this.data.slug),false);this.setData({form,formTitle:formText(form.title),formDescription:formText(form.description),privacy:formText(form.privacyNotice),fields:form.fields.map(field=>({id:field.id,type:field.type,label:formText(field.label),required:field.required,value:"",index:0,options:(field.options||[]).map(option=>({id:option.id,label:formText(option.label),checked:false}))})),answers:{},consent:false});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  input(e:WechatMiniprogram.Input){const index=Number(e.currentTarget.dataset.index),field=this.data.fields[index];this.setData({[`answers.${field.id}`]:e.detail.value,[`fields[${index}].value`]:e.detail.value});},
  select(e:WechatMiniprogram.PickerChange){const index=Number(e.currentTarget.dataset.index),field=this.data.fields[index],selected=Number(e.detail.value),option=field.options[selected];if(option)this.setData({[`answers.${field.id}`]:option.id,[`fields[${index}].value`]:option.label,[`fields[${index}].index`]:selected});},
  check(e:WechatMiniprogram.CheckboxGroupChange){const index=Number(e.currentTarget.dataset.index),field=this.data.fields[index];this.setData({[`answers.${field.id}`]:e.detail.value,[`fields[${index}].options`]:field.options.map(option=>({...option,checked:e.detail.value.includes(option.id)}))});},
  consent(e:WechatMiniprogram.CheckboxGroupChange){this.setData({consent:e.detail.value.includes("agree")});},
  async submit(){if(this.data.busy||!this.data.form)return;const missing=this.data.fields.some(field=>{const value=this.data.answers[field.id];return field.required&&(!value||(typeof value==="string"?!value.trim():!value.length));});if(missing||!this.data.consent){this.setData({error:this.data.copy.missing});return;}this.setData({busy:true,error:""});try{await post({action:"intake",form:this.data.slug,version:this.data.form.version,requestId:this.data.requestId,source:this.data.source,answers:this.data.answers,consent:true},false);this.setData({submitted:true,answers:{},fields:[]});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}},
  explore(){wx.switchTab({url:"/pages/discover/index"});},
});
