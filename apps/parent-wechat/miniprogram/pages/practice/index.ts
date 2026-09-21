import {get,post,upload,mediaUrl,requestId} from "../../lib/api";
import type {Practice,PracticeSubmission,Media} from "../../lib/api-types";
import {pageData,syncPage,errorText,date} from "../../lib/page";
type LocalMedia={key:string;path:string;thumb:string;kind:"image"|"video";bytes:number;progress:number;uploaded:Media|null};
Page({
  data:{...pageData("homework"),id:"",participant:"",practice:null as Practice|null,when:"",saved:null as PracticeSubmission|null,files:[] as LocalMedia[],note:"",busy:false,progress:0,submissionId:"",editing:true},
  onLoad(query:Record<string,string>){this.setData({id:query.id||"",participant:query.participant||"",submissionId:requestId()});syncPage(this,"homework","practiceDetail");void this.load();},
  async load(){this.setData({loading:true,error:""});try{const [rows,saved]=await Promise.all([get<Practice[]>("practices"),get<PracticeSubmission|null>("submission",`&id=${encodeURIComponent(this.data.id)}&participant=${encodeURIComponent(this.data.participant)}`)]);const practice=rows.find(row=>row.id===this.data.id&&row.participantId===this.data.participant);this.setData({practice:practice||null,when:date(practice?.dueAt||null),saved,editing:!saved,error:practice?"":this.data.copy.notFound});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({loading:false});}},
  choose(){if(this.data.busy||this.data.files.length>=9)return;wx.chooseMedia({count:9-this.data.files.length,mediaType:["image","video"],sourceType:["album","camera"],maxDuration:60,sizeType:["compressed"],success:result=>{const picked=result.tempFiles.map(file=>({key:requestId(),path:file.tempFilePath,thumb:file.thumbTempFilePath||file.tempFilePath,kind:file.fileType as "image"|"video",bytes:file.size,progress:0,uploaded:null}));if(picked.some(file=>file.bytes>(file.kind==="image"?12:64)*1024*1024)||this.data.files.length+picked.length>9){this.setData({error:this.data.copy.mediaTooLarge});return;}this.setData({files:[...this.data.files,...picked],error:""});},fail:error=>{if(!error.errMsg.includes("cancel"))this.setData({error:this.data.copy.chooseError});}});},
  remove(e:WechatMiniprogram.TouchEvent){if(!this.data.busy)this.setData({files:this.data.files.filter(file=>file.key!==e.currentTarget.dataset.key)});},
  preview(e:WechatMiniprogram.TouchEvent){const file=this.data.files.find(item=>item.key===e.currentTarget.dataset.key);if(file)wx.previewMedia({sources:[{url:file.path,type:file.kind}],current:0});},
  noteInput(e:WechatMiniprogram.Input){this.setData({note:e.detail.value});},
  async submit(){if(this.data.busy)return;if(!this.data.files.length){this.setData({error:this.data.copy.needMedia});return;}this.setData({busy:true,error:"",progress:0});try{
    for(let i=0;i<this.data.files.length;i++){const file=this.data.files[i];if(!file.uploaded){const uploaded=await upload(file.path,this.data.id,this.data.participant,progress=>this.setData({[`files[${i}].progress`]:progress,progress:Math.round((i+progress/100)/this.data.files.length*100)}));this.setData({[`files[${i}].uploaded`]:uploaded});}}
    await post({action:"submit",id:this.data.submissionId,assignmentId:this.data.id,participantId:this.data.participant,note:this.data.note,uploadIds:this.data.files.map(file=>file.uploaded!.id)});
    this.setData({files:[],note:"",editing:false});await this.load();
  }catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}},
  again(){this.setData({editing:true,submissionId:requestId(),files:[],note:"",error:""});},
  async openSaved(e:WechatMiniprogram.TouchEvent){try{const id=String(e.currentTarget.dataset.id),file=this.data.saved?.media.find(item=>item.id===id);if(!file)return;const url=await mediaUrl(id);wx.previewMedia({sources:[{url,type:file.kind}],current:0});}catch(error){this.setData({error:errorText(error)});}},
});
