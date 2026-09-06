import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { validateHistoryTrialTarget } from './history-import-trial.mjs';

/** 本机历史导入工具共享的只读目标核对；返回的 SQL 连接只指向已核对的本机容器。 */
export function openHistoryLocalTarget({ attestationPath, refresh = false, errorFile }) {
  if (process.platform !== 'win32' || process.env.SSH_CONNECTION || process.env.DOCKER_HOST) throw new Error('HISTORY_LOCAL_HOST_REQUIRED');
  const run = (file, args, input) => execFileSync(file, args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }).trim();
  const docker = args => run('docker.exe', ['--context','desktop-linux',...args]);
  const sql = statement => {
    try { return run('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], statement); }
    catch (error) { fs.writeFileSync(errorFile, String(error.stderr ?? error.message), 'utf8'); throw new Error('HISTORY_DATABASE_ERROR: inspect private error file'); }
  };
  const envMatch = fs.readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\r\n"']+)/m);
  const origin = envMatch ? new URL(envMatch[1].trim()).origin : null;
  const endpoint = JSON.parse(docker(['context','inspect','desktop-linux','--format','{{json .Endpoints.docker.Host}}']));
  const netstat = run('netstat.exe', ['-ano']);
  const listeners = [['127.0.0.1',35421,'com.docker.backend'],['0.0.0.0',3130,'node']].map(([Address,Port,Process]) => {
    const line = netstat.split(/\r?\n/).find(line => line.includes(`${Address}:${Port}`) && line.includes('LISTENING'));
    const pid = line?.trim().split(/\s+/).at(-1);
    if (!pid || !/^\d+$/.test(pid) || !run('tasklist.exe', ['/FI',`PID eq ${pid}`,'/FO','CSV','/NH']).toLowerCase().includes(`"${Process}.exe"`)) throw new Error('HISTORY_LOCAL_LISTENER_CHANGED');
    return { Address, Port, Process, pid: Number(pid) };
  });
  const gateway = JSON.parse(docker(['inspect','supabase-envoy','--format','{{json .NetworkSettings}}']));
  const databaseNetworks = JSON.parse(docker(['inspect','supabase-db','--format','{{json .NetworkSettings.Networks}}']));
  if (!gateway.Ports?.['8000/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '35421')
    || !gateway.Networks?.['mathin-isolated-loopback']
    || gateway.Networks['mathin-isolated-loopback'].NetworkID !== databaseNetworks['mathin-isolated-loopback']?.NetworkID) throw new Error('HISTORY_LOCAL_NETWORK_CHANGED');
  const systemIdentifier = sql('begin read only; select system_identifier::text from pg_control_system(); commit;');
  if (systemIdentifier !== '7673999900474441767') throw new Error('HISTORY_LOCAL_DATABASE_CHANGED');
  const observed = { host: os.hostname(), supabaseOrigin: origin, systemIdentifier, listeners, checkedAt: new Date().toISOString() };
  const attestation = refresh ? observed : JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  validateHistoryTrialTarget(attestation, { host: observed.host, envOrigin: origin, dockerEndpoint: endpoint, systemIdentifier });
  if (refresh) fs.writeFileSync(attestationPath, `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
  return { sql, docker, observed };
}
