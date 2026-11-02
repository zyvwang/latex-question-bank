import { spawnSync } from 'node:child_process';

const runs = (command: string) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

/**
 * Desktop smoke jobs run without TeX; real compilation is covered by the latex-export job.
 * LQB_REQUIRE_TEX=1 turns a missing install into a failure so that coverage cannot silently vanish.
 */
export function hasTex(): boolean {
  const available = runs('latexmk') && runs('xelatex');
  if (!available && process.env.LQB_REQUIRE_TEX === '1') throw new Error('LQB_REQUIRE_TEX=1 但未检测到 latexmk 和 xelatex。');
  return available;
}
