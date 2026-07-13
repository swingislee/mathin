function messageOf(error:unknown){return error instanceof Error?error.message:String(error)}
export async function register(){/* 保留 Next.js instrumentation 入口，生产日志采集器从 stdout 接入。 */}
export function onRequestError(error:unknown,request:{path?:string;method?:string},context:{routerKind?:string;routePath?:string;routeType?:string}){
 console.error(JSON.stringify({level:"error",event:"request.error",at:new Date().toISOString(),message:messageOf(error),path:request.path,method:request.method,routerKind:context.routerKind,routePath:context.routePath,routeType:context.routeType}));
}
