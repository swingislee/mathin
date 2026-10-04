import fs from "node:fs";
import path from "node:path";
import { openHistoryLocalTarget } from "./lib/history-local-target.mjs";
import { textFileSha256 } from "./lib/text-hash.mjs";

const mode=process.argv[2];
if(!["--preflight","--check","--apply","--configure"].includes(mode))throw new Error("Use --preflight, --check, --apply or --configure");
const output=path.resolve(".tmp/parent-portal");fs.mkdirSync(output,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(output,"preflight.json"),refresh:mode==="--preflight",errorFile:path.join(output,"database-error.txt")});
if(mode==="--preflight"){console.log(JSON.stringify(observed));process.exit(0);}
const migrations=["20260922010000_parent_miniapp_portal","20260922010100_parent_miniapp_storage_read"].map(version=>{
  const file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file);
  const recorded=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
  if(recorded&&recorded!==checksum)throw new Error("MIGRATION_CHECKSUM_MISMATCH");
  return {version,checksum,recorded,sql:fs.readFileSync(file,"utf8")};
});
const checksum=migrations.map(item=>item.checksum).join(":"),pending=migrations.filter(item=>!item.recorded);
const migration=pending.map(item=>item.sql).join("\n");
if(mode==="--check"){
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='45s';${migration}\n${fs.readFileSync("supabase/fixtures/parent-miniapp-identities.sql","utf8")}\n${fs.readFileSync("supabase/fixtures/parent-miniapp-local.sql","utf8")}\n${fs.readFileSync("supabase/tests/parent_miniapp_portal.sql","utf8")}\nrollback;`);
  if(!migrations[0].recorded&&sql("begin read only;select to_regclass('public.miniapp_forms') is null;commit;")!=="t")throw new Error("ROLLBACK_FAILED");
  fs.writeFileSync(path.join(output,"check.json"),JSON.stringify({checksum,host:observed.host}),"utf8");
  console.log("PASS: dynamic forms, booking capacity/idempotency, family scope, private media, submission retries and transaction rollback.");
}else if(mode==="--apply"){
  if(!pending.length)throw new Error("ALREADY_APPLIED");
  const check=JSON.parse(fs.readFileSync(path.join(output,"check.json"),"utf8"));
  if(check.checksum!==checksum||check.host!==observed.host)throw new Error("MATCHING_CHECK_REQUIRED");
  const ledger=pending.map(item=>`insert into public.schema_migrations(version,checksum) values('${item.version}','${item.checksum}');`).join("\n");
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='45s';${migration}\n${ledger}\nnotify pgrst,'reload schema';commit;`);
  console.log("Applied to the verified Windows loopback development database.");
}else{
  if(pending.length)throw new Error("APPLY_REQUIRED");
  sql(`begin;${fs.readFileSync("supabase/fixtures/parent-miniapp-identities.sql","utf8")}\n${fs.readFileSync("supabase/fixtures/parent-miniapp-local.sql","utf8")}\ncommit;`);
  console.log("Default form and clearly labelled local acceptance activity/report/practice configured using existing fixed identities.");
}
