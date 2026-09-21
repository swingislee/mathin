import {describe,it,expect} from "vitest";
import {intakeFormSchema,intakeSchema,validateAnswers,mediaType} from "@/features/parent-portal/validation";
const text={zh:"方向",en:"Direction"};
const fields=[{id:"name",type:"text" as const,label:text,required:true},{id:"interest",type:"multiselect" as const,label:text,required:false,options:[{id:"reasoning",label:text}]}];
describe("小程序登记与媒体边界",()=>{
  it("按后台字段和稳定选项 ID 校验，不接收越过配置的字段或选项",()=>{
    expect(validateAnswers(fields,{name:"联调",interest:["reasoning"]})).toBe(true);
    expect(validateAnswers(fields,{name:" ",interest:[]})).toBe(false);
    expect(validateAnswers(fields,{name:"联调",interest:["方向"]})).toBe(false);
    expect(validateAnswers(fields,{name:"联调",interest:["reasoning","reasoning"]})).toBe(false);
    expect(validateAnswers(fields,{name:"联调",role:"admin"})).toBe(false);
    expect(validateAnswers(fields,{name:["联调"]})).toBe(false);
  });
  it("后台字段不能重复，选项、双语名称与同意记录必需",()=>{
    const base={slug:"welcome",version:1,title:text,description:text,privacyNotice:text,fields};
    expect(intakeFormSchema.safeParse(base).success).toBe(true);
    expect(intakeFormSchema.safeParse({...base,fields:[...fields,fields[0]]}).success).toBe(false);
    expect(intakeFormSchema.safeParse({...base,fields:[{...fields[1],options:undefined}]}).success).toBe(false);
    expect(intakeSchema.safeParse({form:"welcome",version:1,requestId:"90fdc4f8-2187-4147-a74d-ac48896fce35",answers:{name:"测试"},consent:false}).success).toBe(false);
  });
  it("拒绝 HTML 等伪装附件，按字节签名辨识照片和视频",()=>{
    expect(mediaType(new TextEncoder().encode("<html>not a photo</html>"))).toBeNull();
    expect(mediaType(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]))?.mime).toBe("image/png");
    expect(mediaType(new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109]))?.mime).toBe("video/mp4");
    expect(mediaType(new Uint8Array([0,0,0,20,102,116,121,112,104,101,105,99]))?.kind).toBe("image");
  });
});
