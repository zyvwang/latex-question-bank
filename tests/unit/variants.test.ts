import {describe,it,expect} from 'vitest';
import {canConvert,examKinds,normalizeVariantImages,parseVariantContent,variantBasisSource} from '../../shared/variants.js';
import {createSampleBank} from '../../server/bank-schema.js';
import {fillPaper,makeSlots,slotProblems,originalCandidates,defaultPaperSettings,type Paper,type PaperCandidate} from '../../shared/papers.js';
const fixture=():Paper => ({version:3,useVariants:true,quota:{enabled:false,blueprintId:'math1-2021-2025-v1'},id:'paper',kind:'practice',title:'练习',seed:'1',filters:{priorities:[],topics:[],chapters:[],books:[]},rules:defaultPaperSettings(),latex:createSampleBank().settings,slots:[],createdAt:'today',updatedAt:'today'});
describe('expression versions',() => {
  it('allows ABC within ABC and D only to D, validating complete representations',() => {
    for (const from of examKinds) for (const to of examKinds) expect(canConvert(from,to)).toBe(from==='D'?to==='D':to!=='D');
    const c={targetKind:'A',question:'求值 \\choices{1}{2}{3}{4}',answer:'1',solution:'计算',choiceKey:'A'};
    expect(parseVariantContent(c,'C').choiceKey).toBe('A');
    for (const patch of [{choiceKey:'E'},{question:'选项缺失'},{question:'\\choices{1}{1}{3}{4}'},{solution:''},{targetKind:'D'}]) expect(() => parseVariantContent({...c,...patch},'C')).toThrow();
    expect(() => parseVariantContent({...c,targetKind:'B'},'C')).toThrow('blank');
    expect(parseVariantContent({...c,targetKind:'B',question:'值为 \\blank'},'C').targetKind).toBe('B');
  });
  it('normalizes only known image references and rejects unknown material',() => {
    const assets=[{fileName:'root.png',relativePath:'assets/root.png'}] as Parameters<typeof normalizeVariantImages>[1];
    expect(normalizeVariantImages('\\qimg[m]{root.png}',assets)).toBe('\\qimg[m]{assets/root.png}');
    expect(() => normalizeVariantImages('\\includegraphics{../outside.png}',assets)).toThrow('已有');
  });
  it('ignores metadata but detects math and attachment changes',() => {
    const a=createSampleBank().items[0];const b=structuredClone(a);b.reviewPriority='must';b.topics=['其他'];b.modules.note.tex='笔记';
    expect(variantBasisSource(a)).toBe(variantBasisSource(b));b.modules.solution.tex+='步骤';expect(variantBasisSource(a)).not.toBe(variantBasisSource(b));
  });
  it('maximum matches competing cross-type families and reserves manual and locked choices',() => {
    const bank=createSampleBank();const p=fixture();p.kind='practice';p.useVariants=true;p.slots=makeSlots('practice',[1,1,1]);
    const root=bank.items[0];
    const candidate=(id:string,family:string,type:string):PaperCandidate => ({item:{...structuredClone(root),id,questionTypes:[type]},origin:{ref:{kind:'original',id},rootId:family},topic:null,sourceText:''});
    // Choice X/Y, blank X/Z, answer X/Z. A naive sequential choice can strand answer.
    const pool=[candidate('xA','x','选择'),candidate('yA','y','选择'),candidate('xB','x','填空'),candidate('zB','z','填空'),candidate('xC','x','解答'),candidate('zC','z','解答')];
    for (let i=0;i<30;i++) {
      p.seed=String(i);const filled=fillPaper(bank,p,undefined,undefined,{},undefined,pool);
      expect(slotProblems(filled)).toEqual(['','','']);expect(new Set(filled.slots.map(s => s.origin?.rootId)).size).toBe(3);
      expect(fillPaper(bank,p,undefined,undefined,{},undefined,pool)).toEqual(filled);
      const more=[...pool,candidate('xA2','x','选择'),candidate('xA3','x','选择')];
      expect(fillPaper(bank,p,undefined,undefined,{},undefined,more).slots.map(s => s.origin?.rootId)).toEqual(filled.slots.map(s => s.origin?.rootId));
    }
    expect(() => fillPaper(bank,p,[0,1],undefined,{}, {0:'xA',1:'xB'},pool)).toThrow('同族');
    const filled=fillPaper(bank,p,undefined,undefined,{},undefined,pool);filled.slots[0].locked=true;
    expect(fillPaper(bank,filled,undefined,undefined,{},undefined,pool).slots[0]).toEqual(filled.slots[0]);
    filled.slots[1].origin={...filled.slots[1].origin!,rootId:filled.slots[0].origin!.rootId};expect(slotProblems(filled)[1]).toContain('同族');
    expect(originalCandidates(bank).every(c => c.origin.rootId === c.item.id)).toBe(true);
  });
});
