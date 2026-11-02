import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {VariantManager} from '../../src/components/VariantManager.js';
import {variantRequest,fetchBank,ApiRequestError} from '../../src/api/client.js';
import {flushPaperChanges} from '../../src/utils/pendingPaperChanges.js';
import type {FamilyView,VariantOverview} from '../../shared/variants.js';
import {bank} from '../fixtures/app-ui.js';
const lifecycle=vi.hoisted(() => ({flushPendingChanges:vi.fn().mockResolvedValue(undefined),reloadExternalBank:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../src/api/client.js',async original => ({...await original<typeof import('../../src/api/client.js')>(),variantRequest:vi.fn(),fetchBank:vi.fn(),waitForPaperWrites:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../src/context/questionBankContexts.js',() => ({useQuestions:() => ({bank,activeItem:bank.items[0]}),useLifecycle:() => lifecycle}));
vi.mock('../../src/components/LatexPreview.js',() => ({LatexPreview:({tex}:{tex:string}) => <div>{tex}</div>}));
vi.mock('../../src/components/LatexEditor.js',() => ({default:({value,onChange}:{value:string;onChange:(v:string)=>void}) => <textarea value={value} onChange={e => onChange(e.target.value)} />}));
const familyId='10000000-0000-4000-8000-000000000001';const variantId='10000000-0000-4000-8000-000000000002';const revision='10000000-0000-4000-8000-000000000003';
function view():FamilyView {const item={...bank.items[0],id:variantId};return {family:{schemaVersion:1,id:familyId,rootId:bank.items[0].id,originalKind:'C',typeEpoch:1,createdAt:'now',corrections:[],refusals:[],versions:[]},revision:'family',root:bank.items[0],rootFingerprint:'root',blocked:false,rows:[{entry:{id:variantId,currentRevision:revision,history:[revision],revisionHashes:{[revision]:'a'.repeat(64)},status:'pending',approvedFingerprint:null,approvedEpoch:null,reviewedAt:null},revision:{schemaVersion:1,id:revision,variantId,familyId,content:{targetKind:'B',question:'计算 \\blank',answer:'1',solution:'步骤'},item,base:bank.items[0],baseFingerprint:'root',typeEpoch:1,createdAt:'now',generator:'agent'},history:[],state:'待审阅',eligible:false}]};}
function overview(enabled=true):VariantOverview {return {config:{version:1,enabled},configRevision:'config',families:[{family:view().family,revision:'family'}],warnings:[],bankRevision:'bank'};}
beforeEach(() => {vi.clearAllMocks();vi.mocked(fetchBank).mockResolvedValue({bank,revision:'bank',workspacePath:'/bank'});vi.mocked(variantRequest).mockImplementation(async action => action === 'list'?overview():action === 'read'?view():{family:view().family,revision:'new'});});
async function open() {render(<VariantManager workspace="/bank" visible />);await screen.findByLabelText('原题族');fireEvent.change(screen.getByLabelText('原题族'),{target:{value:familyId}});await screen.findByText('计算 \\blank');}
describe('version workbench',() => {
  it('requires explicit workspace enablement and does not propose or approve on read',async () => {
    vi.mocked(variantRequest).mockImplementation(async action => action==='list'?overview(false):{});
    render(<VariantManager workspace="/bank" visible />);await screen.findByLabelText('原题族');expect(screen.getByLabelText('开启本工作区版本管理')).not.toBeChecked();expect(screen.queryByText('确认原始题型并纳入')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('开启本工作区版本管理'));await waitFor(() => expect(variantRequest).toHaveBeenCalledWith('set-enabled','/bank',expect.objectContaining({enabled:true,configRevision:'config'})));
    expect(vi.mocked(variantRequest).mock.calls.some(([a]) => a==='propose' || a==='review')).toBe(false);
  });
  it('keeps automatic enrollment opt-in and submits the current config revision',async () => {
    await open();const permission=screen.getByLabelText('允许 Agent 自动纳管新题和指定旧题');expect(permission).not.toBeChecked();fireEvent.click(permission);
    await waitFor(() => expect(variantRequest).toHaveBeenCalledWith('set-agent-auto-enroll','/bank',expect.objectContaining({allowed:true,configRevision:'config'})));
  });
  it('submits an explicit same-family batch with exact version revisions',async () => {
    await open();fireEvent.click(screen.getByLabelText(`勾选版本 ${variantId}`));fireEvent.click(screen.getByText('批准勾选版本'));
    await waitFor(() => expect(variantRequest).toHaveBeenCalledWith('review','/bank',expect.objectContaining({familyId,revision:'family',rootFingerprint:'root',entries:[{variantId,versionRevision:revision,action:'approve',confirmCurrentBasis:false}]})));
  });
  it('retains drafts on failure, flushes a pending revision at the close boundary and guards unknown results',async () => {
    await open();fireEvent.click(screen.getByText('修订'));const editor=await within(screen.getByRole('group',{name:/^答案$/})).findByRole('textbox');fireEvent.change(editor,{target:{value:'修订答案'}});
    const original=vi.mocked(variantRequest).getMockImplementation()!;let fail=true;
    vi.mocked(variantRequest).mockImplementation(async (...args) => {if (args[0]==='revise' && fail) throw new ApiRequestError('结果未知',0,'WRITE_RESULT_UNKNOWN');return original(...args);});
    await act(async () => {await expect(flushPaperChanges()).rejects.toThrow();});expect(editor).toHaveValue('修订答案');await expect(flushPaperChanges()).rejects.toThrow('尚未完成');
    fail=false;fireEvent.click(screen.getByText('读取磁盘并核对结果'));await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await act(async () => {await flushPaperChanges();});
    expect(variantRequest).toHaveBeenCalledWith('revise','/bank',expect.objectContaining({variantId,versionRevision:revision,content:expect.objectContaining({answer:'修订答案'})}));
    expect(screen.queryByRole('group',{name:/^答案$/})).not.toBeInTheDocument();
  });
  it('requires a correction reason and applies the refreshed bank after the dedicated confirmation',async () => {
    vi.spyOn(window,'confirm').mockReturnValue(true);await open();expect(screen.getByText('确认纠错并标记待复核')).toBeDisabled();fireEvent.change(screen.getByLabelText('纠错理由'),{target:{value:'原题应是证明题'}});fireEvent.change(screen.getByLabelText('正确题型'),{target:{value:'D'}});fireEvent.click(screen.getByText('确认纠错并标记待复核'));
    await waitFor(() => expect(lifecycle.reloadExternalBank).toHaveBeenCalledWith({confirmed:true}));expect(variantRequest).toHaveBeenCalledWith('correct-type','/bank',expect.objectContaining({originalKind:'D',reason:'原题应是证明题'}));
  });
});
