import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"../apps/parent-wechat/miniprogram");
const target=path.join(root,"config.local.ts");
if(!fs.existsSync(target))fs.copyFileSync(path.join(root,"config.example.ts"),target);
