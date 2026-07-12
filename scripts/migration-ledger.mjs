import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "supabase", "migrations");
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
  const version = name.replace(/\.sql$/, "").replaceAll("'", "''");
  console.log(`do $$ begin if exists(select 1 from public.schema_migrations where version='${version}' and checksum<>'${checksum}') then raise exception 'MIGRATION_CHECKSUM_MISMATCH: ${version}'; end if; insert into public.schema_migrations(version,checksum) values('${version}','${checksum}') on conflict(version) do nothing; end $$;`);
}
