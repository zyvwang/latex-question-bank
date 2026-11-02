import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {VariantReviewQueue} from '../../src/components/VariantReviewQueue.js';
import {ApiRequestError,fetchBank,variantRequest} from '../../src/api/client.js';
import {flushPaperChanges} from '../../src/utils/pendingPaperChanges.js';
import type {FamilyView,VariantQueue,VariantRow} from '../../shared/variants.js';
import {bank} from '../fixtures/app-ui.js';

const mocks=vi.hoisted(() => ({
  flushPendingChanges:vi.fn().mockResolvedValue(undefined),updateItem:vi.fn(),setReviewTab:vi.fn(),focusVariantFamily:vi.fn(),status:{value:'approved'}
}));
vi.mock('../../src/api/client.js',async original => ({...await original<typeof import('../../src/api/client.js')>(),variantRequest:vi.fn(),fetchBank:vi.fn(),waitForPaperWrites:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../src/context/questionBankContexts.js',() => ({
  useQuestions:() => ({bank:{...bank,items:bank.items.map(q => ({...q,reviewStatus:mocks.status.value}))},updateItem:mocks.updateItem}),
  useLifecycle:() => ({flushPendingChanges:mocks.flushPendingChanges}),
  useAppView:() => ({setReviewTab:mocks.setReviewTab,focusVariantFamily:mocks.focusVariantFamily})
}));
vi.mock('../../src/components/LatexPreview.js',() => ({LatexPreview:({tex}:{tex:string}) => <div>{tex}</div>}));

const uuid=(n:number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function row(n:number,state='待审阅'):VariantRow {
  const item={...bank.items[0],id:uuid(n)};
  return {entry:{id:uuid(n),currentRevision:uuid(n+100),history:[uuid(n+100)],revisionHashes:{},status:'pending',approvedFingerprint:null,approvedEpoch:null,reviewedAt:null},
    revision:{schemaVersion:1,id:uuid(n+100),variantId:uuid(n),familyId:uuid(1),content:{targetKind:'B',question:`版本题面${n}`,answer:`答案${n}`,solution:`解析${n}`},item,base:bank.items[0],baseFingerprint:'a'.repeat(64),typeEpoch:1,createdAt:'now',generator:'agent'},history:[],state,eligible:false};
}
function family(id:number,rootIndex:number,rows:VariantRow[]):FamilyView {
  return {family:{schemaVersion:1,id:uuid(id),rootId:bank.items[rootIndex].id,originalKind:'C',typeEpoch:1,createdAt:'now',corrections:[],versions:rows.map(r => r.entry),refusals:[]},revision:`rev-${id}`,root:bank.items[rootIndex],rows,rootFingerprint:'b'.repeat(64),blocked:false};
}
const queueOf=(families:FamilyView[]):VariantQueue => ({enabled:true,families,total:families.reduce((s,f) => s+f.rows.length,0),warnings:[]});
const mount=(queue:VariantQueue,reload=vi.fn().mockResolvedValue(queueOf([]))) => {
  const pause=vi.fn();
  return {...render(<VariantReviewQueue workspace="/bank" queue={queue} reload={reload} pause={pause} />),reload,pause};
};

describe('version review queue',() => {
  beforeEach(() => {
    vi.clearAllMocks();mocks.status.value='approved';
    vi.mocked(fetchBank).mockResolvedValue({bank,revision:'bank',workspacePath:'/bank'});
    vi.mocked(variantRequest).mockResolvedValue({});
  });
  it('shows the original once with every answer visible and approves the whole family in one action',async () => {
    const queue=queueOf([family(1,0,[row(2),row(3)]),family(4,0,[row(5)])]);
    const reload=vi.fn().mockResolvedValue(queueOf([queue.families[1]]));
    mount(queue,reload);
    expect(screen.getByText('答案2')).toBeTruthy();expect(screen.getByText('答案3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'批准全部 2 个并下一题'}));
    await waitFor(() => expect(variantRequest).toHaveBeenCalled());
    expect(mocks.flushPendingChanges).toHaveBeenCalled();
    const [action,,body]=vi.mocked(variantRequest).mock.calls[0];
    expect(action).toBe('review');
    expect(body).toMatchObject({familyId:uuid(1),revision:'rev-1',bankRevision:'bank',rootFingerprint:'b'.repeat(64)});
    expect((body as {entries:{variantId:string;action:string}[]}).entries.map(e => [e.variantId,e.action])).toEqual([[uuid(2),'approve'],[uuid(3),'approve']]);
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
  it('is not blocked by its own close boundary while flushing before a decision',async () => {
    mocks.flushPendingChanges.mockImplementationOnce(() => flushPaperChanges());
    mount(queueOf([family(1,0,[row(2)])]));
    fireEvent.click(screen.getByRole('button',{name:'批准并下一题'}));
    await waitFor(() => expect(variantRequest).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('moves to the next family after the current one leaves the queue',async () => {
    const first=family(1,0,[row(2)]);const second=family(4,0,[row(5)]);
    const remaining=queueOf([second]);const reload=vi.fn().mockResolvedValue(remaining);
    const view=mount(queueOf([first,second]),reload);
    fireEvent.click(screen.getByRole('button',{name:'批准并下一题'}));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    view.rerender(<VariantReviewQueue workspace="/bank" queue={remaining} reload={reload} pause={view.pause} />);
    expect(screen.getByText('版本题面5')).toBeTruthy();expect(screen.queryByText('版本题面2')).toBeNull();
  });
  it('blocks every decision until the original is approved',() => {
    mocks.status.value='pending';
    mount(queueOf([family(1,0,[row(2)])]));
    expect((screen.getByRole('button',{name:'批准并下一题'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'拒绝'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'批准原题'}));
    expect(mocks.updateItem).toHaveBeenCalledWith(bank.items[0].id,{reviewStatus:'approved'});
  });
  it('requires explicit confirmation when the basis changed',async () => {
    mount(queueOf([family(1,0,[row(2,'待复核')])]));
    const approve=screen.getByRole('button',{name:'批准并下一题'}) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(variantRequest).toHaveBeenCalled());
    expect((vi.mocked(variantRequest).mock.calls[0][2] as {entries:{confirmCurrentBasis:boolean}[]}).entries[0].confirmCurrentBasis).toBe(true);
  });
  it('holds close and further decisions on an unknown write until it is verified',async () => {
    vi.mocked(variantRequest).mockRejectedValue(new ApiRequestError('结果未知',500,'WRITE_RESULT_UNKNOWN'));
    const {reload}=mount(queueOf([family(1,0,[row(2)])]),vi.fn().mockResolvedValue(queueOf([family(1,0,[row(2)])])));
    fireEvent.click(screen.getByRole('button',{name:'批准并下一题'}));
    await screen.findByRole('alert');
    await expect(flushPaperChanges()).rejects.toThrow('版本审阅尚未完成');
    expect((screen.getByRole('button',{name:'批准并下一题'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'读取磁盘并核对结果'}));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await expect(flushPaperChanges()).resolves.toBeUndefined();
  });
  it('sends revision requests to the family manager',() => {
    mount(queueOf([family(1,0,[row(2)])]));
    fireEvent.click(screen.getByRole('button',{name:'修订'}));
    expect(mocks.focusVariantFamily).toHaveBeenCalledWith(uuid(1));
  });
  it('offers a way back when nothing is left',() => {
    mount(queueOf([]));
    fireEvent.click(screen.getByRole('button',{name:'回到原题'}));
    expect(mocks.setReviewTab).toHaveBeenCalledWith('originals');
  });
});
