// Use the repository's TypeScript and actual application validators; no extra
// runtime dependency or hand-written copy of the courseware schema is needed.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.resolve('src',request.slice(2)):request,parent,...rest);};
Module._load=function(request,...rest){return request==='server-only'?{}:load.call(this,request,...rest);};
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file}).outputText,file);
const {buildNativeCourse}=require('./native-materials.ts');
(async()=>{
  const {LESSONS}=await import('./lessons.mjs');
  const bank=JSON.parse(fs.readFileSync('content/courses/sudoku-2026/bank.json','utf8'));
  console.time('Native audit and composition build');
  const prior=process.argv.includes('--reuse-audit')?JSON.parse(fs.readFileSync('content/courses/sudoku-2026/native-audit.json','utf8')):undefined;
  const result=buildNativeCourse(LESSONS,bank,prior);
  fs.mkdirSync('.tmp/sudoku-2026',{recursive:true});
  fs.writeFileSync('.tmp/sudoku-2026/course-package.json',JSON.stringify(result));
  fs.writeFileSync('content/courses/sudoku-2026/native-audit.json',JSON.stringify(result.nativeAudit,null,1)+'\n');
  console.log(JSON.stringify({lessons:result.lessons.length,pages:result.lessons.reduce((n,l)=>n+l.pages.length,0),puzzles:result.nativeAudit.length}));
  console.timeEnd('Native audit and composition build');
})().catch(error=>{console.error(error);process.exit(1);});
