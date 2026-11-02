import { readFile } from 'node:fs/promises';
import { isRecord } from '../shared/validation-primitives.js';

type Transport = (pathname: string, init?: RequestInit) => Promise<unknown>;
function usage(message: string): never { process.exitCode = 2; throw new Error(message); }
export async function runPaperCommand(args: string[], flags: Map<string,string|boolean>, workspacePath: string, request: Transport): Promise<void> {
  const [command,id] = args;
  const query = `?${new URLSearchParams({ workspacePath })}`;
  const root = '/api/agent/papers';
  const get = (url: string) => request(`${url}${query}`);
  const post = (url: string, body: Record<string,unknown>) => request(url,{ method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ ...body,workspacePath }) });
  const file = async (): Promise<Record<string,unknown>> => {
    const name = flags.get('file');
    if (typeof name !== 'string') return usage('该命令需要 --file <清单.json>。');
    let value: unknown;
    try { value = JSON.parse(await readFile(name,'utf8')); } catch { return usage('无法读取 JSON 清单。'); }
    if (!isRecord(value)) return usage('清单必须是对象。');
    return value;
  };
  const dryRun = flags.has('dry-run');
  let result: unknown;
  if (command === 'catalog') result = await get(`${root}/catalog`);
  else if (command === 'list') result = await get(root);
  else if (command === 'classify' && id === 'list') result = await get(`${root}/classifications`);
  else if (command === 'classify' && id === 'propose') result = await post(`${root}/classifications/propose`,{ ...await file(), dryRun });
  else if (command === 'create') {
    const manifest = await file();
    const catalog = await get(`${root}/catalog`) as { bankRevision:string; topicsRevision:string };
    result = await post(`${root}/create`,{ ...catalog,...manifest,dryRun });
  } else if (['get','candidates','generate','replace','export'].includes(command) && id) {
    const url = `${root}/${encodeURIComponent(id)}`;
    if (command === 'get') result = await get(url);
    else if (command === 'candidates') {
      const slot = flags.get('slot');
      if (typeof slot !== 'string' || !/^[1-9]\d*$/.test(slot)) return usage('候选查询需要 --slot <从 1 开始的题号>。');
      result = await request(`${url}/candidates${query}&slot=${slot}`);
    } else {
      if (dryRun && command === 'export') return usage('导出不支持 --dry-run；请先 get 核对试卷。');
      const snapshot = await get(url) as { revision:string };
      const catalog = await get(`${root}/catalog`) as { bankRevision:string; topicsRevision:string };
      const manifest = command === 'replace' ? await file() : {};
      result = await post(`${url}/${command}`,{ ...catalog,revision:snapshot.revision,...manifest,dryRun });
    }
  } else return usage('未知 paper 命令，请运行 lqb --help。');
  if (isRecord(result) && isRecord(result.report) && Array.isArray(result.report.problems) && result.report.problems.some(Boolean)) process.exitCode = 3;
  if (isRecord(result) && result.ok === false) process.exitCode = 1;
  // JSON is also the readable default: it preserves revisions, candidate IDs and compile diagnostics.
  console.log(JSON.stringify(result,null,2));
}
