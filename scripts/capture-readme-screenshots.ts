import { questionFingerprint } from "../server/paper-topic-service.js";
import { quotaRequirements, groupName } from "../shared/paper-topics.js";
import { defaultPaperSettings, makeSlots } from "../shared/papers.js";
import { _electron as electron, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createSampleBank } from "../server/bank-schema.js";
import type {
  Bank,
  QuestionAsset,
  QuestionItem
} from "../shared/types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.join(projectRoot, ".tmp", "readme-screenshots");
const screenshotDirectory = path.join(projectRoot, "docs", "screenshots");
const viewport = { width: 1470, height: 891 } as const;
const timestamp = "2026-09-02T08:30:00.000Z";

const editorChapterDefinitions = [
  ["limits", "函数、极限与连续"],
  ["derivatives", "一元函数微分学"],
  ["integrals", "一元函数积分学"],
  ["series", "无穷级数"],
  ["multivariable", "多元函数微积分"],
  ["equations", "微分方程"]
] as const;

const methodTags = [
  ["洛必达", "求极限", "泰勒展开", "等价无穷小", "夹逼准则", "单调有界", "中值定理", "连续性"],
  ["导数定义", "微分中值", "隐函数", "参数方程", "单调性", "极值", "曲率", "渐近线"],
  ["换元积分", "分部积分", "反常积分", "定积分", "面积", "弧长", "旋转体", "积分估计"],
  ["审敛法", "幂级数", "泰勒级数", "绝对收敛", "条件收敛", "收敛半径", "傅里叶", "余项"],
  ["偏导数", "全微分", "方向导数", "重积分", "曲线积分", "曲面积分", "极值", "梯度"],
  ["一阶方程", "二阶方程", "特征根", "常数变易", "齐次方程", "初值问题", "方程组", "稳定性"]
] as const;

async function main() {
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(screenshotDirectory, { recursive: true });
  try {
    await captureSetup();
    await captureEditor();
    await captureReview();
    await captureDistribution();
    await captureSettings();
    await capturePapers();
    await capturePaperTopics();
    await captureVariants();
    await captureVariantQueue();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  console.log("README screenshots regenerated in docs/screenshots/.");
}

async function captureVariants() {
  const workspacePath=path.join(temporaryRoot,'variants-workspace');const appDataPath=path.join(temporaryRoot,'variants-app-data');
  const bank=createEditorBank();bank.items=[{...bank.items[0],id:'expression-original',source:{bookId:null,label:'表达演示 1'},questionTypes:['解答'],modules:{question:{tex:"设 $f(x)=x^2$，求 $f'(1)$。"},solution:{tex:"$f'(x)=2x$，故 $f'(1)=2$。"},note:{tex:''}}}];
  await prepareRun(workspacePath,appDataPath,bank);const app=await launchApp(workspacePath,appDataPath);
  try {
    const page=await app.firstWindow();await setViewport(app,page);
    await page.getByRole('navigation',{name:'题库页面'}).getByRole('button',{name:'组卷',exact:true}).click();
    await page.locator('#variant-manager > summary').click();await page.getByLabel('开启本工作区版本管理').click();await expect(page.getByLabel('开启本工作区版本管理')).toBeChecked();
    await page.getByLabel('原题',{exact:true}).selectOption('expression-original');await page.getByText('确认原始题型并纳入').click();
    await expect(page.getByRole('heading',{name:/当前原题/})).toBeVisible();
    const op=async (action:string,body:Record<string,unknown>={}) => {const response=await page.request.post(new URL(`/api/variants/${action}`,page.url()).href,{data:{workspacePath,...body}});if (!response.ok()) throw new Error(await response.text());return response.json();};
    const o=await op('list');const v=await op('read',{familyId:o.families[0].family.id});
    await op('propose',{familyId:v.family.id,revision:v.revision,bankRevision:o.bankRevision,rootFingerprint:v.rootFingerprint,variantId:'60000000-0000-4000-8000-000000000001',content:{targetKind:'B',question:"设 $f(x)=x^2$，则 $f'(1)=$\\blank。",answer:'2',solution:"$f'(x)=2x$，故 $f'(1)=2$。"}});
    await page.getByText('读取磁盘并核对结果').click();await expect(page.locator('#variant-manager').getByText('待审阅',{exact:true})).toBeVisible();
    await page.locator('#variant-manager > summary').scrollIntoViewIfNeeded();
    await settlePage(page);await capture(page,'variants.png');
  } finally {await closeApp(app);}
}

async function captureVariantQueue() {
  const workspacePath=path.join(temporaryRoot,'variant-queue-workspace');const appDataPath=path.join(temporaryRoot,'variant-queue-app-data');
  const rows:[string,string,string,string,string,string[],string][]=[
    ['求 $\\displaystyle\\lim_{x\\to 0}\\dfrac{1-\\cos x}{x^2}$。','$\\displaystyle\\lim_{x\\to 0}\\dfrac{1-\\cos x}{x^2}=$','$\\dfrac{1}{2}$','由 $1-\\cos x\\sim\\dfrac{x^2}{2}$，极限为 $\\dfrac{1}{2}$。','1.2',['$0$','$\\dfrac{1}{4}$','$\\dfrac{1}{2}$','$1$'],'C'],
    ['计算 $\\displaystyle\\int_0^1 x\\mathrm{e}^x\\,\\mathrm{d}x$。','$\\displaystyle\\int_0^1 x\\mathrm{e}^x\\,\\mathrm{d}x=$','$1$','分部积分得 $(x-1)\\mathrm{e}^x\\big|_0^1=1$。','3.5',['$\\mathrm{e}-1$','$1$','$\\mathrm{e}$','$2$'],'B'],
    ['设 $y=x\\ln x$，求 $y^{\\prime\\prime}(1)$。','设 $y=x\\ln x$，则 $y^{\\prime\\prime}(1)=$','$1$','$y^{\\prime}=\\ln x+1$，$y^{\\prime\\prime}=\\dfrac{1}{x}$，故 $y^{\\prime\\prime}(1)=1$。','2.8',['$1$','$0$','$\\mathrm{e}$','$2$'],'A'],
    ['求 $f(x)=x^3-3x$ 的极小值。','$f(x)=x^3-3x$ 的极小值为','$-2$','$f^{\\prime}(x)=3(x^2-1)$，在 $x=1$ 处取极小值 $-2$。','2.14',['$2$','$0$','$-1$','$-2$'],'D'],
    ['求 $\\displaystyle\\lim_{n\\to\\infty}\\left(1+\\dfrac{2}{n}\\right)^n$。','$\\displaystyle\\lim_{n\\to\\infty}\\left(1+\\dfrac{2}{n}\\right)^n=$','$\\mathrm{e}^2$','由重要极限，极限为 $\\mathrm{e}^2$。','1.9',['$1$','$\\mathrm{e}$','$\\mathrm{e}^2$','$2\\mathrm{e}$'],'C'],
    ['计算 $\\displaystyle\\int_0^\\pi \\sin^2 x\\,\\mathrm{d}x$。','$\\displaystyle\\int_0^\\pi \\sin^2 x\\,\\mathrm{d}x=$','$\\dfrac{\\pi}{2}$','由二倍角公式，积分为 $\\dfrac{\\pi}{2}$。','3.12',['$\\pi$','$\\dfrac{\\pi}{2}$','$\\dfrac{\\pi}{4}$','$2$'],'B']
  ];
  const bank=createEditorBank();
  bank.items=rows.map(([question,,,solution,label],i) => ({...bank.items[0],id:`queue-original-${i}`,source:{bookId:null,label:`演示 ${label}`},questionTypes:['解答'],reviewStatus:i === 4 ? 'pending' as const : 'approved' as const,modules:{question:{tex:question},solution:{tex:solution},note:{tex:''}}}));
  await prepareRun(workspacePath,appDataPath,bank);const app=await launchApp(workspacePath,appDataPath);
  try {
    const page=await app.firstWindow();await setViewport(app,page);
    await expect(page.getByRole('navigation',{name:'题库页面'})).toBeVisible();
    const op=async (action:string,body:Record<string,unknown>={}) => {const response=await page.request.post(new URL(`/api/variants/${action}`,page.url()).href,{data:{workspacePath,...body}});if (!response.ok()) throw new Error(await response.text());return response.json();};
    const start=await op('list');await op('set-enabled',{enabled:true,configRevision:start.configRevision});
    for (const [i,[,stem,answer,solution,,choices,key]] of rows.entries()) {
      const family=await op('create-family',{rootId:`queue-original-${i}`,originalKind:'C',bankRevision:start.bankRevision});
      let view=await op('read',{familyId:family.family.id});
      const base=(id:number) => ({familyId:view.family.id,revision:view.revision,bankRevision:start.bankRevision,rootFingerprint:view.rootFingerprint,variantId:`70000000-0000-4000-8000-0000000${String(i).padStart(2,'0')}00${id}`});
      await op('propose',{...base(1),content:{targetKind:'B',question:`${stem}\\blank。`,answer,solution}});
      view=await op('read',{familyId:family.family.id});
      await op('propose',{...base(2),content:{targetKind:'A',question:`${stem}\\paren\n\n\\choices${choices.map(c => `{${c}}`).join('')}`,answer:key,choiceKey:key,solution:`${solution}\n\n故选 ${key}。`}});
    }
    await page.getByRole('navigation',{name:'题库页面'}).getByRole('button',{name:/待审阅/}).click();
    await page.getByRole('button',{name:/^版本 /}).click();
    await expect(page.getByRole('region',{name:'版本审阅'}).getByText('12 个版本')).toBeVisible();
    await settlePage(page);await capture(page,'variant-queue.png');
  } finally {await closeApp(app);}
}

async function captureSetup() {
  const appDataPath = path.join(temporaryRoot, "setup-app-data");
  await mkdir(appDataPath, { recursive: true });
  const electronApp = await launchApp(null, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await expect(
      page.getByRole("heading", { name: "建立你的第一个题库" })
    ).toBeVisible();
    await settlePage(page);
    await capture(page, "setup.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureEditor() {
  const workspacePath = path.join(
    temporaryRoot,
    "editor-workspace",
    "高等数学演示库"
  );
  const appDataPath = path.join(temporaryRoot, "editor-app-data");
  await prepareRun(workspacePath, appDataPath, createEditorBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await expect(
      page.getByLabel("题库导航").getByRole("heading", { name: "题目" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /自编 1\.1/ })
    ).toContainText("洛必达");
    await expect(
      page.getByLabel("题目列表", { exact: true }).getByRole("heading", {
        name: "函数、极限与连续", exact: true
      })
    ).toBeVisible();
    await page.getByText("自编 1.2", { exact: true }).click();
    await expect(page.locator("#main-workspace").getByLabel("来源题号")).toHaveValue("自编 1.2");
    await settlePage(page);
    await capture(page, "main.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureReview() {
  const workspacePath = path.join(
    temporaryRoot,
    "review-workspace",
    "高等数学审阅演示库"
  );
  const appDataPath = path.join(temporaryRoot, "review-app-data");
  const figure = await createDemoFigure();
  await prepareRun(
    workspacePath,
    appDataPath,
    createReviewBank(figure.asset),
    [{ fileName: figure.asset.fileName, buffer: figure.buffer }]
  );
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page
      .getByRole("navigation", { name: "题库页面" })
      .getByRole("button", { name: /待审阅/ })
      .click();
    await expect(page.getByText(`待审阅 ${reviewQuestions.length} 道`)).toBeVisible();
    await expect(
      page.getByLabel("题目附件").getByRole("button", {
        name: "查看附件 区域 D 的图形.png"
      })
    ).toBeVisible();
    await settlePage(page);
    await capture(page, "review.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureDistribution() {
  const workspacePath = path.join(
    temporaryRoot,
    "distribution-workspace",
    "高等数学分布演示库"
  );
  const appDataPath = path.join(temporaryRoot, "distribution-app-data");
  await prepareRun(workspacePath, appDataPath, createDistributionBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page
      .getByRole("navigation", { name: "题库页面" })
      .getByRole("button", { name: "复习分布" })
      .click();
    await expect(page.getByRole("heading", { name: "复习分布" })).toBeVisible();
    await expect(page.getByLabel("必须看清单")).toContainText("自编 1.1");
    await settlePage(page);
    await capture(page, "distribution.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function captureSettings() {
  const workspacePath = path.join(
    temporaryRoot,
    "settings-workspace",
    "高等数学设置演示库"
  );
  const appDataPath = path.join(temporaryRoot, "settings-app-data");
  await prepareRun(workspacePath, appDataPath, createSettingsBank());
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp, page);
    await page.getByRole("button", { name: "题库设置" }).click();
    await expect(
      page.getByRole("heading", { name: "题库设置" })
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "书目" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByLabel("书目名称 高等数学讲义")
    ).toBeVisible();
    await expect(page.getByText("demo-book-batch")).toBeVisible();
    await settlePage(page);
    await capture(page, "settings.png");
  } finally {
    await closeApp(electronApp);
  }
}

async function capturePapers() {
  const workspacePath = path.join(temporaryRoot, "papers-workspace", "复习组卷演示库");
  const appDataPath = path.join(temporaryRoot, "papers-app-data");
  const paperBank = createEditorBank();
  paperBank.items = paperBank.items.map((item,i) => {
    const n = i + 2;
    const tex = item.questionTypes.includes("选择")
      ? `设 $f(x)=x^{${n}}$，则 $f'(1)=$\\choices{0}{1}{${n}}{${n+1}}`
      : item.questionTypes.includes("填空")
        ? `$\\displaystyle\\int_0^1 x^{${n}}\\,dx=\\blank$。`
        : item.modules.question.tex;
    return { ...item, modules: { ...item.modules, question: { tex } } };
  });
  await prepareRun(workspacePath, appDataPath, paperBank);
  const electronApp = await launchApp(workspacePath, appDataPath);
  try {
    const page = await electronApp.firstWindow();
    await setViewport(electronApp,page);
    await page.getByRole("navigation", { name: "题库页面" }).getByRole("button", { name: "组卷", exact: true }).click();
    await page.getByRole("button", { name: "新建练习卷" }).click();
    await expect(page.getByLabel("标题", { exact: true })).toBeVisible();
    await page.getByLabel("标题", { exact: true }).fill("高等数学 · 阶段练习");
    await page.getByRole("button", { name: "重抽未锁定题目" }).click();
    await expect(page.getByText("题位齐全，可正式导出")).toBeVisible();
    await page.getByLabel("随机种子").fill("review-2026-10");
    await page.getByRole("button", { name: "重抽未锁定题目" }).click();
    await expect(page.getByText("题位齐全，可正式导出")).toBeVisible();
    await page.getByRole("checkbox", { name: "锁题" }).first().check();
    await page.getByRole("region", { name: "组卷", exact: true }).evaluate(el => { el.scrollTop = 0; });
    await settlePage(page);
    await capture(page,"papers.png");
    // Exercise the minimum desktop width and the narrow web layout as well.
    for (const size of [{ width: 1000, height: 650 }, { width: 600, height: 700 }]) {
      const win = await electronApp.browserWindow(page);
      await win.evaluate((window, size) => { window.setMinimumSize(400,400); window.setContentSize(size.width,size.height); },size);
      await expect(page.getByRole("heading", { name: "组卷", exact: true })).toBeVisible();
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("Papers layout overflows viewport");
    }
  } finally { await closeApp(electronApp); }
}

async function capturePaperTopics() {
  const workspacePath = path.join(temporaryRoot,"quota-workspace","综合考点演示库");
  const appDataPath = path.join(temporaryRoot,"quota-app-data");
  const seed = "blueprint-demo";
  const required = quotaRequirements(seed);
  const template = makeSlots("mock");
  const bank = createSampleBank();
  const base = bank.items[0];
  bank.chapters = ["calculus","linear","probability"].map((id,i) => ({ id,name:["高等数学","线性代数","概率统计"][i],order:i+1 }));
  const stems: Record<string,string> = {
    C01: "求极限 $\\displaystyle\\lim_{x\\to0}\\frac{\\sin x}{x}$。",
    C02: "设 $f(x)=x^2$，求 $f'(1)$。",
    C03: "求 $f(x)=xe^{-x}$ 在 $[0,+\\infty)$ 上的最大值。",
    C04: "计算 $\\displaystyle\\int_0^1 x^2\\,dx$。",
    C05: "求曲线 $y=x^2$ 与 $y=x$ 所围成区域的面积。",
    C06: "求微分方程 $y'+y=0$ 满足 $y(0)=1$ 的解。",
    C07: "求 $f(x,y)=x^2+y^2-2x-4y$ 的极小值。",
    C08: "计算 $\\displaystyle\\iint_{[0,1]^2}(x+y)\\,dxdy$。",
    C09: "计算单位圆正向边界上的积分 $\\displaystyle\\oint_L x\\,dy-y\\,dx$。",
    C10: "求幂级数 $\\displaystyle\\sum_{n=1}^{\\infty}\\frac{x^n}{n}$ 的收敛半径。",
    C11: "求点 $(1,2,3)$ 到平面 $x+y+z=0$ 的距离。",
    L01: "计算行列式 $\\begin{vmatrix}1&2\\\\0&3\\end{vmatrix}$。",
    L02: "求矩阵 $\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}$ 的秩。",
    L03: "讨论向量 $(1,0,1)^T$、$(0,1,1)^T$、$(1,1,2)^T$ 的线性相关性。",
    L04: "求矩阵 $\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}$ 的特征值。",
    L05: "求二次型 $x_1^2+2x_1x_2+x_2^2$ 的正惯性指数。",
    P01: "已知 $P(A)=P(B)=1/2$ 且 $A,B$ 独立，求 $P(A\\cup B)$。",
    P02: "设 $X\\sim U(0,1)$，求 $Y=X^2$ 的分布函数。",
    P03: "设 $X,Y$ 独立且都服从 $U(0,1)$，求 $P(X+Y<1)$。",
    P04: "设 $X\\sim B(10,1/2)$，求 $D(X)$。",
    P05: "用中心极限定理近似估计独立重复试验的成功次数。",
    P06: "来自正态总体的样本方差满足怎样的卡方分布关系？",
    P07: "设样本来自 $U(0,\\theta)$，求 $\\theta$ 的最大似然估计。",
    P08: "总体服从 $N(\\mu,1)$，写出关于 $H_0:\\mu=0$ 的双侧检验统计量。"
  };
  const answers: Record<string,string> = { C01:"1",C02:"2",C03:"\\dfrac1e",C04:"\\dfrac13",C05:"\\dfrac16",C06:"e^{-x}",C07:"-5",C08:"1",C09:"2\\pi",C10:"1",C11:"2\\sqrt3",L01:"3",L02:"1",L03:"\\text{线性相关}",L04:"1,3",L05:"1",P01:"\\dfrac34",P02:"\\sqrt y\\ (0<y<1)",P03:"\\dfrac12",P04:"\\dfrac52",P05:"\\Phi(1)",P06:"(n-1)S^2/\\sigma^2\\sim\\chi^2(n-1)",P07:"\\max_i X_i",P08:"\\sqrt n\\,\\bar X" };
  stems.P05 = "设 $X_i$ 独立同分布，均值为 1、方差为 4。用中心极限定理近似估计 $P\\{\\sum_{i=1}^n X_i\\le n+2\\sqrt n\\}$（$n$ 很大）。";
  const choicesFor = (id:string) => `\\choices{$${answers[id]}$}${["0","1","-1","2","3"].filter(answer => answer !== answers[id]).slice(0,3).map(answer => `{$${answer}$}`).join("")}`;
  stems.P02 = "设 $X\\sim U(0,1)$，$Y=X^2$，求 $0<y<1$ 时的分布函数 $F_Y(y)$。";
  bank.items = template.map((slot,i) => ({ ...structuredClone(base),id:`quota-demo-${i}`,source:{ bookId:null,label:`综合演示 ${i+1}` },chapterId:slot.subject,chapterOrder:i+1,topics:[groupName(required[i])],questionTypes:[{ choice:"选择",blank:"填空",answer:"解答" }[slot.section]],modules:{ question:{tex:stems[required[i]]+(slot.section === "choice" ? choicesFor(required[i]) : slot.section === "blank" ? " 填入结果：\\blank。" : "")},solution:{tex:`结果为 $${answers[required[i]]}$。`},note:{tex:""} } }));
  await prepareRun(workspacePath,appDataPath,bank);
  await mkdir(path.join(workspacePath,"papers"),{recursive:true});
  await writeFile(path.join(workspacePath,"papers","settings.json"),JSON.stringify({...defaultPaperSettings(),chapters:{calculus:"calculus",linear:"linear",probability:"probability"}}));
  const items = Object.fromEntries(bank.items.map((q,i) => [q.id,{approved:{groupId:required[i],fingerprint:questionFingerprint(q)},proposal:i < 3 ? {groupId:required[i],fingerprint:questionFingerprint(q),reason:"根据主要解题任务归组，请确认主考点。"} : null}]));
  await writeFile(path.join(workspacePath,"papers","topics.json"),JSON.stringify({version:1,items}));
  const app = await launchApp(workspacePath,appDataPath);
  try {
    const page = await app.firstWindow(); await setViewport(app,page);
    await page.getByRole("navigation",{name:"题库页面"}).getByRole("button",{name:"组卷",exact:true}).click();
    await page.getByRole("button",{name:"新建模拟卷"}).click();
    await page.getByLabel("标题",{exact:true}).fill("数学一 · 综合考点模拟卷");
    await page.getByLabel("随机种子").fill(seed);
    await page.getByLabel("启用综合考点配额").check();
    await page.getByRole("button",{name:"重抽未锁定题目"}).click();
    await expect(page.getByText("题位齐全，可正式导出")).toBeVisible();
    await page.getByRole("region",{name:"组卷",exact:true}).evaluate(el => {el.scrollTop=180;});
    await settlePage(page); await capture(page,"paper-quota.png");
    await page.getByRole("region",{name:"组卷",exact:true}).evaluate(el => {el.scrollTop=0;});
    await page.getByText("主考点分类 · 3 条建议待确认").click();
    await page.getByText("查看完整题面").first().click();
    await page.getByRole("region",{name:"组卷",exact:true}).evaluate(el => {el.scrollTop=120;});
    await settlePage(page); await capture(page,"paper-topics.png");
  } finally {await closeApp(app);}
}

async function prepareRun(
  workspacePath: string,
  appDataPath: string,
  bank: Bank,
  assets: Array<{ fileName: string; buffer: Buffer }> = []
) {
  await mkdir(workspacePath, { recursive: true });
  await mkdir(appDataPath, { recursive: true });
  if (assets.length > 0) {
    await mkdir(path.join(workspacePath, "assets"), { recursive: true });
  }
  for (const asset of assets) {
    await writeFile(
      path.join(workspacePath, "assets", asset.fileName),
      asset.buffer
    );
  }
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(bank, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appDataPath, "app-state.json"),
    `${JSON.stringify({
      version: 1,
      recentWorkspacePaths: [],
      uiLayout: {
        questionSidebarWidth: 320,
        questionSidebarCollapsed: false,
        moduleEditorPercent: 55
      }
    }, null, 2)}\n`,
    "utf8"
  );
}

async function launchApp(workspacePath: string | null, appDataPath: string) {
  // Null means first launch: an inherited workspace would skip the setup screen.
  const { LQB_WORKSPACE_DIR: _inherited, ...environment } = process.env;
  return electron.launch({
    args: [projectRoot],
    env: {
      ...environment,
      ...(workspacePath ? { LQB_WORKSPACE_DIR: workspacePath } : {}),
      LQB_AGENT_DISCOVERY_FILE: path.join(appDataPath,"agent.json"),
      LQB_APP_DATA_DIR: appDataPath
    }
  });
}

async function closeApp(
  electronApp: Awaited<ReturnType<typeof electron.launch>>
) {
  const childProcess = electronApp.process();
  if (childProcess.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    childProcess.once("exit", () => resolve());
  });
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await exited;
}

async function setViewport(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
  page: Page
) {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window, size) => {
    window.setContentSize(size.width, size.height);
  }, viewport);
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual(viewport);
}

async function settlePage(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

async function capture(page: Page, fileName: string) {
  const image = await page.screenshot({
    path: path.join(screenshotDirectory, fileName),
    animations: "disabled",
    caret: "hide",
    scale: "css"
  });
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(
      `${fileName} was ${width}x${height}; expected ${viewport.width}x${viewport.height}.`
    );
  }
}

function createEditorBank(): Bank {
  const base = createSampleBank();
  const chapters = editorChapterDefinitions.map(([id, name], index) => ({
    id: `chapter-${id}`,
    name,
    order: index + 1
  }));
  const items = chapters.flatMap((chapter, chapterIndex) =>
    Array.from({ length: 8 }, (_, itemIndex) =>
      createQuestion({
        chapterId: chapter.id,
        chapterIndex,
        itemIndex,
        tag: methodTags[chapterIndex][itemIndex]
      })
    )
  );
  return {
    ...base,
    chapters,
    books: [],
    imports: [],
    items
  };
}

// 审阅页演示一次真实导入：讲义积分章的 6 道题刚进入待审阅，首题带函数图形。
const reviewBookId = "book-demo";
const reviewQuestions = [
  {
    topic: "旋转体",
    type: "解答",
    question:
      "设 $D$ 是由曲线 $y=x^2$ 与 $y=\\sqrt{x}$ 所围成的平面区域（如图）。\n\n求 $D$ 的面积 $S$，以及 $D$ 绕 $x$ 轴旋转一周所得旋转体的体积 $V$。\n\n\\qimg[l]{assets/revolution-region.png}",
    solution:
      "两曲线交于 $(0,0)$ 与 $(1,1)$，在 $[0,1]$ 上 $\\sqrt{x}\\ge x^2$。\n\\[\nS=\\int_0^1\\left(\\sqrt{x}-x^2\\right)dx=\\frac{1}{3},\\qquad\nV=\\pi\\int_0^1\\left(x-x^4\\right)dx=\\frac{3\\pi}{10}.\n\\]"
  },
  {
    topic: "分部积分",
    type: "解答",
    question: "计算 $\\displaystyle\\int_0^{\\pi/2} x\\cos x\\,dx$。",
    solution: "分部积分得 $\\left[x\\sin x+\\cos x\\right]_0^{\\pi/2}=\\dfrac{\\pi}{2}-1$。"
  },
  {
    topic: "反常积分",
    type: "填空",
    question: "$\\displaystyle\\int_1^{+\\infty}\\frac{dx}{x(1+x)}=\\blank$。",
    solution: "拆项后积分得 $\\ln\\dfrac{x}{1+x}\\Big|_1^{+\\infty}=\\ln 2$。"
  },
  {
    topic: "换元积分",
    type: "解答",
    question: "计算 $\\displaystyle\\int_0^1\\sqrt{1-x^2}\\,dx$。",
    solution: "令 $x=\\sin t$，得 $\\displaystyle\\int_0^{\\pi/2}\\cos^2 t\\,dt=\\frac{\\pi}{4}$。"
  },
  {
    topic: "弧长",
    type: "解答",
    question: "求曲线 $y=\\dfrac{2}{3}x^{3/2}$ 在 $0\\le x\\le 3$ 上的弧长。",
    solution: "$\\displaystyle s=\\int_0^3\\sqrt{1+x}\\,dx=\\frac{14}{3}$。"
  },
  {
    topic: "积分估计",
    type: "证明",
    question: "证明 $\\displaystyle\\frac{1}{2}\\le\\int_0^1\\frac{dx}{1+x^2}\\le 1$。",
    solution: "在 $[0,1]$ 上 $\\dfrac{1}{2}\\le\\dfrac{1}{1+x^2}\\le 1$，积分即得。"
  }
] as const;

function createReviewBank(figure: QuestionAsset): Bank {
  const base = createEditorBank();
  const items = base.items.map((item): QuestionItem => {
    const match = item.id.match(/^demo-3-(\d)$/);
    const demo = match ? reviewQuestions[Number(match[1]) - 1] : undefined;
    if (!demo) return { ...item, reviewStatus: "approved" };
    const number = Number(match?.[1]);
    return {
      ...item,
      source: { bookId: reviewBookId, label: `3.${number}` },
      topics: [demo.topic],
      questionTypes: [demo.type],
      reviewPriority: number === 1 ? "must" : null,
      reviewStatus: "pending",
      modules: {
        ...item.modules,
        question: { tex: demo.question },
        solution: { tex: demo.solution }
      },
      assets: number === 1 ? [figure] : []
    };
  });
  return {
    ...base,
    books: [{
      id: reviewBookId,
      title: "高等数学讲义",
      filePath: "/Users/demo/Documents/高等数学讲义.pdf",
      fileHash: "a".repeat(64),
      answerBookPath: null,
      answerBookHash: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    items
  };
}

function createSettingsBank(): Bank {
  const base = createEditorBank();
  const book = {
    id: "book-demo",
    title: "高等数学讲义",
    filePath: "/Users/demo/Documents/高等数学讲义.pdf",
    fileHash: "a".repeat(64),
    answerBookPath: "/Users/demo/Documents/高等数学讲义答案.pdf",
    answerBookHash: "c".repeat(64),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return {
    ...base,
    books: [book],
    items: base.items.map((item, index) => ({
      ...item,
      source: {
        bookId: book.id,
        label: `${Math.floor(index / 8) + 1}.${(index % 8) + 1}`
      }
    })),
    imports: [
      {
        id: "demo-book-batch",
        createdAt: timestamp,
        note: "高等数学讲义整书导入",
        bookTitles: [book.title],
        newCount: base.items.length,
        updatedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        itemIds: base.items.map((item) => item.id),
        updatedItemIds: [],
        historySnapshot: null,
        status: "completed",
        undoneAt: null
      }
    ]
  };
}

async function createDemoFigure(): Promise<{
  asset: QuestionAsset;
  buffer: Buffer;
}> {
  const ink = "#14264F";
  const originX = 150;
  const originY = 780;
  const unit = 480;
  const toPoint = (x: number, y: number) =>
    `${(originX + x * unit).toFixed(1)} ${(originY - y * unit).toFixed(1)}`;
  const samples = (from: number, to: number, curve: (x: number) => number) =>
    Array.from({ length: 121 }, (_, step) => {
      const x = from + ((to - from) * step) / 120;
      return toPoint(x, curve(x));
    });
  const square = (x: number) => x * x;
  const region = [
    ...samples(0, 1, Math.sqrt),
    ...samples(0, 1, square).reverse()
  ].join("L");
  const label = (x: number, y: number, text: string, style = "italic", anchor = "start") =>
    `<text x="${x}" y="${y}" font-style="${style}" text-anchor="${anchor}">${text}</text>`;
  const svg = `<svg width="1000" height="900" xmlns="http://www.w3.org/2000/svg" font-family="Times New Roman, Times, serif" font-size="58" fill="${ink}">
  <path d="M${region}Z" fill="${ink}" fill-opacity=".1"/>
  <path d="M${toPoint(1, 0)}L${toPoint(1, 1)}L${toPoint(0, 1)}" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="3" stroke-dasharray="14 12"/>
  <path d="M${originX - 60} ${originY}H930M${originX} ${originY + 60}V70" fill="none" stroke="${ink}" stroke-width="4"/>
  <path d="M930 ${originY - 15}L962 ${originY}L930 ${originY + 15}ZM${originX - 15} 70L${originX} 38L${originX + 15} 70Z"/>
  <path d="M${samples(0, 1.45, Math.sqrt).join("L")}" fill="none" stroke="${ink}" stroke-width="6"/>
  <path d="M${samples(0, 1.12, square).join("L")}" fill="none" stroke="${ink}" stroke-width="6"/>
  ${label(92, 846, "O")}
  ${label(936, 850, "x")}
  ${label(84, 92, "y")}
  ${label(630, 850, "1", "normal", "middle")}
  ${label(104, 320, "1", "normal")}
  ${label(376, 556, "D")}
  ${label(640, 176, "y = x²", "italic", "end")}
  ${label(716, 352, "y = √x")}
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    buffer,
    asset: {
      id: "asset-revolution-region",
      fileName: "revolution-region.png",
      originalName: "区域 D 的图形.png",
      relativePath: "assets/revolution-region.png",
      mimeType: "image/png",
      size: buffer.byteLength,
      uploadedAt: timestamp,
      sha256: createHash("sha256").update(buffer).digest("hex")
    }
  };
}

function createQuestion({
  chapterId,
  chapterIndex,
  itemIndex,
  tag
}: {
  chapterId: string;
  chapterIndex: number;
  itemIndex: number;
  tag: string;
}): QuestionItem {
  const cycle = (chapterIndex * 8 + itemIndex) % 4;
  return {
    id: `demo-${chapterIndex + 1}-${itemIndex + 1}`,
    source: { bookId: null, label: `自编 ${chapterIndex + 1}.${itemIndex + 1}` },
    chapterId,
    chapterOrder: itemIndex + 1,
    topics: [tag],
    questionTypes: [(["解答", "选择", "填空", "证明"] as const)[cycle] ?? "解答"],
    reviewPriority: (["must", "recheck", "skip", null] as const)[cycle] ?? null,
    reviewStatus:
      chapterIndex === 0 && itemIndex === 1 ? "pending" : "approved",
    solutionSource: "user",
    solutionRef: null,
    importBatchId: null,
    importedAt: null,
    modules: {
      question: { tex: questionText(chapterIndex, itemIndex) },
      solution: {
        tex: `先整理已知条件，再使用相应方法计算。\n\\[\n\\text{演示解答：结果随参数 }${itemIndex + 1}\\text{ 确定。}\n\\]`
      },
      note: {
        tex: itemIndex % 2 === 0 ? "复习时注意定义域、端点和等号成立条件。" : ""
      }
    },
    assets: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

// 编辑页演示数据四态均匀循环，分布页要展示真实题库常见的偏态：大量未标记、少量必须看。
function createDistributionBank(): Bank {
  const pattern = ["must", null, "recheck", null, "skip", null, "skip", "recheck", null, null] as const;
  const bank = createEditorBank();
  return {
    ...bank,
    items: bank.items.map((item, index) => ({
      ...item,
      reviewPriority: pattern[(index * 7) % pattern.length] ?? null
    }))
  };
}

function questionText(chapterIndex: number, itemIndex: number): string {
  const parameter = itemIndex + 1;
  const templates = [
    `求极限 $\\displaystyle\\lim_{x\\to 0}\\frac{\\sin(${parameter}x)-${parameter}x}{x^3}$。`,
    `设 $f(x)=x^{${parameter + 1}}e^{-x}$，求其在区间 $[0,+\\infty)$ 上的最大值。`,
    `计算 $\\displaystyle\\int_0^1 x^{${parameter}}\\ln(1+x)\\,dx$。`,
    `判断级数 $\\displaystyle\\sum_{k=1}^{\\infty}\\frac{(-1)^{k-1}}{k^{1+1/${parameter + 1}}}$ 的敛散性。`,
    `求曲面 $z=x^2+${parameter}y^2$ 在点 $(1,1,${parameter + 1})$ 处的切平面。`,
    `求微分方程 $y'+${parameter}y=e^{-x}$ 满足 $y(0)=1$ 的特解。`
  ];
  if (chapterIndex === 0 && itemIndex === 0) {
    return "设 $a_n=\\dfrac{3}{2}\\int_0^{\\frac{2n}{n+1}}x^{n-1}\\sqrt{1+x^n}\\,dx$，求 $\\displaystyle\\lim_{n\\to\\infty}na_n$。";
  }
  return templates[chapterIndex];
}

await main();
