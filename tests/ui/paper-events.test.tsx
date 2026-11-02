import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PapersScreen } from '../../src/components/PapersScreen.js';
import { paperRequest } from '../../src/api/client.js';
import { defaultPaperSettings, makeSlots, type Paper } from '../../shared/papers.js';
import { bank } from '../fixtures/app-ui.js';

vi.mock('../../src/api/client.js',async original => ({...await original<typeof import('../../src/api/client.js')>(),paperRequest:vi.fn()}));
vi.mock('../../src/context/questionBankContexts.js',() => ({useQuestions:() => ({bank}),useLifecycle:() => ({flushPendingChanges:async () => undefined})}));
vi.mock('../../src/components/LatexPreview.js',() => ({LatexPreview:() => <div>公式预览</div>}));
class Source {
  static instances: Source[] = [];
  handlers = new Map<string,(event:MessageEvent<string>) => void>();
  constructor() {Source.instances.push(this);}
  addEventListener(name:string, handler:(event:MessageEvent<string>) => void) {this.handlers.set(name,handler);}
  close() {}
  emit(name:string,body:unknown) {this.handlers.get(name)?.(new MessageEvent('message',{data:JSON.stringify(body)}));}
}
afterEach(() => {vi.unstubAllGlobals();vi.clearAllMocks();Source.instances=[];});
it('refreshes idle Agent changes and retains a local paper draft during external updates',async () => {
  vi.stubGlobal('EventSource',Source);
  let title = 'Agent 卷'; let revision = 'one';
  const p = (): Paper => ({version: 3, useVariants: false,quota:{enabled:false,blueprintId:'math1-2021-2025-v1'},id:'p',kind:'practice',title,seed:'42',filters:{priorities:[],chapters:[],topics:[],books:[]},rules:defaultPaperSettings(),latex:bank.settings,slots:makeSlots('practice',[1,0,0]),createdAt:'now',updatedAt:'now'});
  vi.mocked(paperRequest).mockImplementation(async action => {
    if (action === 'list') return {papers:[{id:'p',title,kind:'practice',updatedAt:'now',missing:1}],warnings:[]};
    if (action === 'settings') return {settings:defaultPaperSettings(),revision:''};
    if (action === 'topics-read') return {revision:'topics',bankRevision:'bank',rows:[]};
    if (action === 'read') return {paper:p(),revision};
    if (action === 'save') return new Promise(() => undefined);
    throw new Error(action);
  });
  render(<PapersScreen workspace="/bank" visible />);
  const button = await screen.findByRole('button',{name:/Agent 卷/}); fireEvent.click(button);
  await screen.findByLabelText('标题');
  await waitFor(() => expect(Source.instances).toHaveLength(1));
  title = '外部更新卷'; revision = 'two';
  await act(async () => {Source.instances[0].emit('paper-changed',{workspacePath:'/bank',id:'p',revision,source:'agent'});});
  await waitFor(() => expect(screen.getByLabelText('标题')).toHaveValue(title));
  fireEvent.change(screen.getByLabelText('标题'),{target:{value:'本地草稿'}});
  await act(async () => {Source.instances[0].emit('paper-changed',{workspacePath:'/bank',id:'p',revision:'three',source:'agent'});});
  expect(screen.getByText('试卷或分类已在外部更新，当前草稿已保留。')).toBeInTheDocument();
  expect(screen.getByLabelText('标题')).toHaveValue('本地草稿');
});
