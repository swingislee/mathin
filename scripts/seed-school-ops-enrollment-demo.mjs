/** 本机报名分班验收数据。需先完成 operations.md 的本机写入目标核对。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { loadFixedAccount } from "../e2e/support/fixed-accounts.ts";

const apply = process.argv.includes("--apply");
const expectedDatabaseId = process.env.MATHIN_SEED_EXPECTED_DATABASE_ID;
if (process.env.R1_DEV_TEST_FIXTURES !== "1" || !/^\d+$/.test(expectedDatabaseId ?? "")) {
  throw new Error("Set R1_DEV_TEST_FIXTURES=1 and MATHIN_SEED_EXPECTED_DATABASE_ID from the read-only preflight.");
}
const root = process.cwd();
const localEnv = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at+1).trim().replace(/^(["'])(.*)\1$/, "$2")];
  }));
if (localEnv.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:35421") {
  throw new Error("Only the fixed local Supabase origin is supported.");
}
function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", shell: false, maxBuffer: 8*1024*1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Docker command failed");
  return result.stdout;
}
const context = JSON.parse(docker(["context", "inspect"]));
if (context[0]?.Endpoints?.docker?.Host !== "npipe:////./pipe/dockerDesktopLinuxEngine") {
  throw new Error("Only the local Docker Desktop engine is supported.");
}
const containers = JSON.parse(docker(["inspect", "supabase-db", "supabase-envoy"]));
for (const container of containers) {
  const labels = container.Config.Labels;
  if (labels["com.docker.compose.project"] !== "mathin-isolated"
    || path.resolve(labels["com.docker.compose.project.working_dir"]) !== path.join(root,".tmp","mathin-supabase-selfhosted")) {
    throw new Error("Unexpected Docker Compose target.");
  }
}
const bindings = containers[1].NetworkSettings.Ports["8000/tcp"];
if (!bindings?.some((binding) => binding.HostIp === "127.0.0.1" && binding.HostPort === "35421")) {
  throw new Error("Unexpected local gateway binding.");
}
const account = loadFixedAccount("principal");
if (!account) throw new Error("Fixed principal account unavailable.");
const cookies = new Map();
const client = createServerClient(localEnv.NEXT_PUBLIC_SUPABASE_URL,localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
  cookies: {
    getAll: () => [...cookies].map(([name,value]) => ({name,value})),
    setAll: (items) => items.forEach(({name,value}) => cookies.set(name,value)),
  },
});
const {data:auth,error:authError} = await client.auth.signInWithPassword(account);
if (authError || !auth.user) throw new Error(`Fixed principal sign-in failed: ${authError?.code ?? "missing_user"}`);
try {
  if (apply) {
    const sql = fs.readFileSync("scripts/fixtures/school-ops-enrollment-demo.sql","utf8");
    docker(["exec","-i","supabase-db","psql","-X","-q","-U","postgres","-d","postgres",
      "-v","ON_ERROR_STOP=1","-v",`actor_id=${auth.user.id}`,"-v",`expected_database_id=${expectedDatabaseId}`],sql);
  }
  const [workbench,options] = await Promise.all([
    client.rpc("get_course_enrollment_workbench"), client.rpc("get_phase3_enrollment_options"),
  ]);
  if (workbench.error || options.error) throw new Error(workbench.error?.message || options.error.message);
  const rows = workbench.data.filter((row) => row.studentName.startsWith("报名验收 · "));
  const classrooms = options.data.classrooms.filter((row) => row.name.startsWith("报名验收 · "));
  const summary = {
    total: rows.length,
    pending: rows.filter((row) => row.status === "active" && !row.assignmentId).length,
    assigned: rows.filter((row) => row.status === "active" && row.assignmentId).length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    classrooms: classrooms.map(({id,name,activeCount,capacity}) => ({id,name,activeCount,capacity})),
    rows: rows.map(({id,studentName,status,classroomName}) => ({id,studentName,status,classroomName})),
  };
  if (rows.length !== 12 || classrooms.length !== 3) throw new Error("Demo rows or assignable classes are missing from the authenticated workbench.");
  const response = await fetch("http://192.168.5.213:3130/zh/dashboard/enrollments", {
    headers:{cookie:[...cookies].map(([name,value]) => `${name}=${value}`).join("; ")},
    redirect:"manual",signal:AbortSignal.timeout(45000),
  });
  const html = await response.text();
  if (response.status !== 200 || !html.includes("报名验收") || /Could not find|schema cache|NEXT_REDIRECT/.test(html)) {
    throw new Error(`Authenticated enrollment page did not render the demo: HTTP ${response.status}`);
  }
  console.log(JSON.stringify({...summary,pageStatus:response.status},null,2));
} finally {
  await client.auth.signOut({scope:"local"});
}
