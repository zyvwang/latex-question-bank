import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paperSections, sectionNames, type Paper } from '../shared/papers.js';
import type { ExportResponse } from '../shared/types.js';
import { buildQuestionOnlyLatex, formatQuestionTex, stripDocumentCommands } from './latex-renderer.js';
import { compileLatex } from './latex-runtime.js';
import { withLatexExecutionSlot } from './latex-execution.js';
import { assertRealWorkspaceSubdir, resolveRealWorkspaceFile } from './workspace-paths.js';
import { assertExportRecoveryComplete, commitExportDirectory, recoverExportTransactions } from './export-transaction.js';
import { listExportFiles } from './latex-files.js';
import { papersDir } from './paper-storage.js';

function escapeTex(input: string) { return input.replace(/[\\{}%$&#_^~]/g, c => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c] ?? `\\${c}`)); }
export function buildPaperLatex(paper: Paper, solutions: boolean): string {
  const total = paper.slots.reduce((sum,s) => sum + s.points, 0);
  const standard = total === 150 && paperSections.every((section,i) => paper.slots.filter(s => s.section === section).length === [10,6,6][i]);
  const body = [`\\begin{center}{\\Large\\bfseries ${escapeTex(paper.title)}${solutions ? ' · 解析卷' : ''}}\\par ${total} 分${standard ? ' · 180 分钟' : ''}\\end{center}`];
  let n = 0;
  for (const section of paperSections) {
    const slots = paper.slots.filter(s => s.section === section);
    if (!slots.length) continue;
    body.push(`\\Needspace{${!solutions && slots[0].space !== 'compact' ? '0.6\\textheight' : '5\\baselineskip'}}\\section*{${sectionNames[section]}（共 ${slots.reduce((v,s) => v+s.points,0)} 分）}`);
    for (const slot of slots) {
      n++;
      if (!solutions && slot.space !== 'compact') body.push(`\\Needspace{${slot.space === 'half' ? '0.5' : '0.97'}\\textheight}`);
      body.push(`\\par\\noindent\\textbf{${n}.（${slot.points} 分）} ${slot.snapshot ? formatQuestionTex(slot.snapshot) : ''}`);
      if (solutions) body.push(`\\par\\smallskip\\textbf{解析}\\par\\nopagebreak[4] ${stripDocumentCommands(slot.snapshot?.modules.solution.tex.trim() || '本题暂无解析。')}`);
      else if (slot.space !== 'compact') body.push(`\\par\\noindent\\rule{0pt}{${slot.space === 'half' ? '0.42' : '0.85'}\\textheight}\\par`);
      body.push('\\par\\medskip');
    }
  }
  const shell = buildQuestionOnlyLatex([], paper.latex);
  return `${shell.slice(0,shell.indexOf('\\begin{document}'))}\\usepackage{needspace}\n\\pagestyle{plain}\n\\raggedbottom\n\n\\begin{document}\n${body.join('\n')}\n\\end{document}\n`;
}
export async function exportPaper(workspace: string, paper: Paper): Promise<ExportResponse> {
  return withLatexExecutionSlot(async session => {
    const temp = await assertRealWorkspaceSubdir(path.join(workspace,'.tmp'));
    const exports = await assertRealWorkspaceSubdir(path.join(workspace,'exports'));
    assertExportRecoveryComplete(await recoverExportTransactions(exports,temp));
    const staging = path.join(temp, `export-${crypto.randomUUID()}`);
    await mkdir(path.join(staging,'assets'), { recursive: true });
    const dir = await papersDir(workspace);
    for (const slot of paper.slots) for (const asset of slot.snapshot?.assets ?? []) {
      await copyFile(await resolveRealWorkspaceFile(dir,asset.fileName), path.join(staging,'assets',asset.fileName));
    }
    await writeFile(path.join(staging,'questions.tex'), buildPaperLatex(paper,false));
    await writeFile(path.join(staging,'full.tex'), buildPaperLatex(paper,true));
    const cell = (s: string) => s.replaceAll('|','\\|').replace(/[\r\n]/g,' ');
    await writeFile(path.join(staging,'sources.md'), `# 来源对照\n\n| 题号 | 原题 ID | 版本 / 修订 | 原题族 | 来源 |\n| --- | --- | --- | --- | --- |\n${paper.slots.map((s,i) => `| ${i+1} | ${cell(s.origin?.rootId ?? s.snapshot?.id ?? '')} | ${cell(s.origin?.ref.kind === 'variant' ? `${s.origin.ref.id} / ${s.origin.ref.revision}` : '原题')} | ${cell(s.origin?.familyId ?? '')} | ${cell(s.sourceText)} |`).join('\n')}\n`);
    const questions = await compileLatex(path.join(staging,'questions.tex'), staging,60_000,session);
    const full = await compileLatex(path.join(staging,'full.tex'), staging,60_000,session);
    const ok = questions.ok && full.ok;
    const name = `paper-${paper.id}`;
    const target = path.join(exports,name);
    const files = await listExportFiles(staging);
    if (ok) await commitExportDirectory(staging,target,temp);
    const url = (file: string) => `/tmp/${path.basename(staging)}/${file}`;
    return { ok, exportName: name, exportPath: ok ? target : staging, files, results: { questions: { ...questions, texUrl: ok ? undefined : url('questions.tex') }, full: { ...full, texUrl: ok ? undefined : url('full.tex') } } };
  });
}
