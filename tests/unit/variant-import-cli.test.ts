import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {runVariantCommand} from '../../cli/variant-commands.js';
import {parseVariantImportGroups} from '../../shared/variant-import.js';
const dir=path.resolve('.tmp/variant-import-cli');
afterEach(async () => {vi.restoreAllMocks();process.exitCode=0;await rm(dir,{recursive:true,force:true});});
async function manifest(groups:unknown[]) {await mkdir(dir,{recursive:true});const file=path.join(dir,'groups.json');await writeFile(file,JSON.stringify({schemaVersion:1,groups}));return new Map<string,string|boolean>([['file',file]]);}
const group=() => ({operationId:crypto.randomUUID(),original:{kind:'existing',id:'q',fingerprint:'hash',familyId:null},variants:[],refusals:[{targetKind:'A',reason:'多目标不适合'}]});
describe('joint import CLI coordination',() => {
  it('continues independent groups after a conflict and reports aggregate results',async () => {
    const groups=[group(),group()];const flags=await manifest(groups);const output=vi.spyOn(console,'log').mockImplementation(() => undefined);
    const request=vi.fn().mockRejectedValueOnce(new Error('source conflict')).mockResolvedValueOnce({status:'completed',pendingCount:1});
    await runVariantCommand(['import'],flags,'/bank',request);
    expect(request).toHaveBeenCalledTimes(2);expect(process.exitCode).toBe(3);expect(JSON.parse(String(output.mock.calls[0][0])).counts).toEqual({succeeded:1,failed:1,unconfirmed:0});
  });
  it('queries an uncertain request with the content digest and never replays the write',async () => {
    const g=group();const flags=await manifest([g]);const output=vi.spyOn(console,'log').mockImplementation(() => undefined);
    const request=vi.fn().mockRejectedValueOnce(Object.assign(new Error('timeout'),{exitCode:5})).mockResolvedValueOnce({status:'completed',result:{operationId:g.operationId}});
    await runVariantCommand(['import'],flags,'/bank',request);
    expect(request.mock.calls[1][0]).toContain(`/import-result?`);expect(request.mock.calls[1][0]).toContain('digest=');expect(request.mock.calls.filter(([,init]) => init?.method==='POST')).toHaveLength(1);expect(JSON.parse(String(output.mock.calls[0][0])).counts.unconfirmed).toBe(0);
  });
  it('reports unresolved requests while continuing later groups',async () => {
    const flags=await manifest([group(),group()]);const output=vi.spyOn(console,'log').mockImplementation(() => undefined);
    const request=vi.fn().mockRejectedValueOnce(Object.assign(new Error('timeout'),{exitCode:5})).mockResolvedValueOnce({status:'not-found'}).mockResolvedValueOnce({status:'completed'});
    await runVariantCommand(['import'],flags,'/bank',request);expect(process.exitCode).toBe(5);expect(JSON.parse(String(output.mock.calls[0][0])).counts).toEqual({succeeded:1,failed:0,unconfirmed:1});
  });
  it('rejects duplicate operation IDs before any request',() => {
    const g=group();expect(() => parseVariantImportGroups({schemaVersion:1,groups:[g,g]})).toThrow('operationId');
  });
});
