import { messages,resolveLocale,sections,type Section,type Locale } from "./locale";
import { copy,type Copy } from "./copy";
import { ApiError } from "./api";
import type { LocalizedText } from "./api-types";
import { requestLogin } from "./navigation";
import { simulatorTabIcons } from "../assets/tabs/simulator-icons";
import { configuration, configurationBrand, configurationRevision, refreshConfiguration } from "./miniapp-configuration";
import { nativeScreenConfig } from "./miniapp-native";
import { localText } from "./miniapp-experience";
let tabsLocale="";
function syncTabs(locale: Locale) {
  const key = `${locale}:${configurationRevision()}`;
  if (tabsLocale === key) return;
  const simulator=typeof wx.getDeviceInfo==="function" && wx.getDeviceInfo().platform==="devtools";
  sections.forEach((section,index)=>wx.setTabBarItem({index,text:localText(nativeScreenConfig(configuration().experience?.screens, section).tabLabel, locale) || messages[locale].sections[section].tabLabel,
    ...(simulator?simulatorTabIcons[section]:{})}));
  tabsLocale=key;
}
export function currentLocale(){return resolveLocale(wx.getAppBaseInfo().language);}
export function pageData(section:Section){return {...configurationBrand("zh"),...messages.zh.sections[section],copy:copy.zh,locale:"" as string,error:"",loading:false};}
export function syncPage(page:{data:{locale:string;configurationRevision?:number};setData:(data:Record<string,unknown>)=>void;configurationChanged?:()=>void},section:Section,titleKey?:keyof Copy){
  const locale=currentLocale();
  if(page.data.locale!==locale){page.setData({...messages[locale].sections[section],copy:copy[locale],locale});wx.setNavigationBarTitle({title:titleKey?copy[locale][titleKey]:messages[locale].sections[section].title});}
  page.setData(configurationBrand(locale));
  void refreshConfiguration().then(() => {
    if (page.data.configurationRevision !== configurationRevision()) {
      page.setData(configurationBrand(locale)); page.configurationChanged?.();
    }
    syncTabs(locale);
  });
  syncTabs(locale);
  return locale;
}
export function text(value:LocalizedText){return value[currentLocale()]||value.zh;}
export function date(value:string|null){if(!value)return "";const d=new Date(value);return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
export function errorText(error:unknown){
  const c=copy[currentLocale()];const code=error instanceof ApiError?error.code:"UNAVAILABLE";
  const keys:Record<string,keyof typeof c>={VALIDATION:"invalid",UNAUTHENTICATED:"credentials",FORBIDDEN:"forbidden",ACCOUNT_SECURITY:"security",FORM_CHANGED:"changed",CONFLICT:"conflict",ACTIVITY_FULL:"full",BOOKING_CLOSED:"closed",TOO_LARGE:"tooLarge",FILE_TYPE:"fileType",RATE_LIMIT:"rateLimit",NOT_FOUND:"notFound"};
  return c[keys[code]||"network"];
}
export function loginPage(target?:unknown){requestLogin(target);wx.switchTab({url:"/pages/account/index"});}
export function localized(locale:Locale){return copy[locale];}
