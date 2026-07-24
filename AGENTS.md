# AGENTS.md

本文件用于指导后续智能体在本仓库中工作。适用范围为仓库根目录及其所有子目录。

## 项目概览

LaTeX Question Bank 是一个本地优先的个人 LaTeX 题库桌面应用。技术栈为 React 19、Vite、TypeScript、Express 和 Electron。

核心数据流：

```text
React UI
  -> src/api/client.ts
  -> Express API in server/index.ts
  -> server/* domain/storage services
  -> workspace files: bank.json, assets/, exports/, .tmp/, .history/
```

题目内容始终保存在用户选择的 workspace 中；应用只在本地应用数据中保存最近工作区、TeX 路径等轻量设置。不要引入云同步或远端上传行为，除非用户明确要求并完成对应设计。

## 环境与常用命令

开发环境需要 Node.js 24，`package-lock.json` 已提交，依赖管理使用 npm。

- 安装依赖：`npm install`
- 本地 Web + API 开发：`npm run dev`
- 仅 API：`npm run dev:api`
- 仅 Vite Web：`npm run dev:web`
- Electron 开发版：`npm run desktop:dev`
- 类型检查：`npm run typecheck`
- Lint：`npm run lint`
- 单元测试：`npm run test:unit`
- API 测试：`npm run test:api`
- Electron 安全相关测试：`npm run test:electron`
- UI 测试：`npm run test:ui`
- 全部 Vitest：`npm run test`
- 覆盖率：`npm run test:coverage`
- 构建：`npm run build`
- 完整验证：`npm run verify`
- 桌面冒烟测试：`npm run test:desktop`

`npm run verify` 会执行 lint、测试、构建、覆盖率和导出验证。未检测到 `latexmk` 或 `xelatex` 时，`scripts/verify-export.ts` 会跳过真实 PDF 编译并以成功状态退出；只有输出 `Verification export passed` 时，才能声称真实 LaTeX 导出编译通过。导出、当前题编译以及部分发布核查依赖本机 TeX 环境，推荐安装可用的 `latexmk` 和 `xelatex`。

开发端口约定：

- Vite Web：`http://127.0.0.1:5173`
- Express API：`http://127.0.0.1:5174`
- Vite 通过代理转发 `/api`、`/assets`、`/exports`、`/tmp` 到 API 服务。

## 目录边界

- `src/App.tsx`：前端组合根和主要屏幕状态切换。
- `src/api/client.ts`：前端唯一的应用 API 请求入口。新增应用 API 调用时放在这里。
- `src/context/QuestionBankProvider.tsx`：题库上下文 Provider，向组件暴露拆分后的领域上下文。
- `src/context/questionBankContexts.ts`：前端组件使用的上下文 hooks。
- `src/hooks/useQuestionBankModel.ts`：组合 workspace、题目、选择、保存、排序、编译和导出行为。
- `src/hooks/useAutosave.ts`：自动保存队列、单飞保存和 `flush()` 边界。
- `src/components/`：聚焦的界面组件。保持组件职责窄，不要把业务协调逻辑塞回大组件。
- `src/styles/foundation.css`：全局 reset、语义 token、focus 和 reduced motion。
- `src/styles/controls.module.css`：共享按钮样式。
- `server/index.ts`：Express 应用装配、路由挂载、前端静态服务和启动入口。
- `server/routes/`：HTTP adapter，按 workspace、bank/recovery、document/export 分组。
- `server/http/`：共享 middleware 和 API 错误响应。
- `server/bank-schema.ts`：默认题库和示例题库创建。
- `server/*-storage.ts`、`server/json-file.ts`：workspace 生命周期、原子 JSON 写入、revision 检查、恢复与历史快照。
- `server/asset-service.ts`：图片扩展名、MIME 和文件签名校验。
- `server/export-service.ts`：导出 staging、PDF 编译和最终目录原子替换。
- `server/latex*.ts`：LaTeX 渲染、临时文件准备和 TeX 进程管理。
- `shared/types.ts`、`shared/validation.ts`：前后端共享数据契约和运行时校验。不要在前后端各自复制类型。
- `electron/`：主进程和 preload。只暴露窄能力，保持 IPC 输入校验。
- `tests/`：Vitest、Testing Library、Supertest 和 Playwright 测试。
- `docs/architecture.md`、`docs/design-system.md`、`docs/release-checklist.md`：架构、视觉和发布约定。改相关领域时同步更新。

避免手动编辑或提交生成目录：`node_modules/`、`build/`、`dist/`、`coverage/`、`release/`、`.tmp/`、`.app-data/`、`test-results/`、`public/vendor/`。`public/vendor/mathjax/` 由 `scripts/copy-mathjax.mjs` 在安装后复制生成。

## 数据模型与安全

当前 workspace schema 是 `version: 1`。每道题的 LaTeX 内容存在：

- `modules.question.tex`
- `modules.solution.tex`
- `modules.note.tex`

若改 schema，需要同时检查：

- `shared/types.ts`
- `shared/validation.ts`
- `server/bank-schema.ts`
- `examples/sample-bank/bank.json`
- `data/bank.json`
- `tests/unit/`
- `tests/api/`
- `tests/ui/`

保存安全是产品核心：

- `bank.json` 和 `app-state.json` 通过临时文件 rename 原子写入。
- 替换已有文件时保留 `<file>.bak`。
- bank response 带 SHA-256 content revision。
- 保存请求携带 `baseRevision`，磁盘内容变化时返回 `BANK_CONFLICT`。
- 每个 workspace 的保存会串行化。
- 渲染端自动保存保持最多一个请求在途，并合并后续编辑。
- 每次应用会话中的首次 bank 修改会在 `.history/` 记录快照，最多保留 10 个。
- 恢复接口只接受服务端枚举出的候选 ID，不接受任意路径。

涉及保存、恢复、导入导出、路径处理、图片上传、Electron IPC 或 TeX 命令执行的改动，要优先补充安全和错误路径测试。

## 前端约定

- React 组件和 hooks 使用 TypeScript strict 模式。
- 组件应消费最小必要的 context：lifecycle、workspace、questions、selection、compile/export、workspace UI。
- 新增应用 API 请求只通过 `src/api/client.ts`。
- CodeMirror 封装在 `src/components/LatexEditor.tsx`，不要在其他组件散落编辑器配置。
- 样式优先使用 CSS Modules；全局 token 只放 `src/styles/foundation.css`。
- 共用按钮样式放 `src/styles/controls.module.css`。
- CodeMirror 的全局选择器应限制在 module editor 容器内使用 `:global(...)`。
- 保持可访问性：键盘 focus ring 可见，交互目标至少 40px 或提供扩展 hit area，支持 reduced motion。

设计系统基调见 `docs/design-system.md`：桌面优先的纸面编辑台、暖纸色表面、克制青绿色行动色、数学内容偏宋体。避免装饰性渐变、玻璃拟态、混乱圆角体系，以及给每个区域套泛用卡片。

## 后端与 Electron 约定

- `server/index.ts` 只做装配；业务逻辑放到 route、service 或 storage 模块。
- HTTP route 负责请求/响应适配和调用共享 validation，不应承载复杂领域逻辑。
- 读写 workspace 路径时使用现有 storage/path helper，避免手写路径拼接绕过校验。
- 文件写入优先使用现有原子写入工具和 revision 机制。
- 图片上传必须保持扩展名、MIME、文件签名三重校验。
- 导出应先写入临时 staging，只有两个 PDF 都成功后再替换最终目录。
- Electron preload 不暴露 `ipcRenderer`。新增 IPC 能力必须窄、可验证，并检查 sender。
- 主窗口导航锁定到应用 origin；外部 HTTPS 或本地 PDF 链接交给系统浏览器。
- 关闭和退出应用前必须尊重 renderer 的保存 flush 边界。

## TypeScript 与代码风格

- 项目使用 ES modules，Node 侧为 `NodeNext`，前端为 Vite bundler resolution。
- 源码保持 strict TypeScript。
- ESLint 禁止未使用变量和 `any`；故意未使用的参数或变量使用 `_` 前缀。
- 优先复用现有 helper、service、hook 和类型，不要在临近模块复制逻辑。
- 保持前后端共享契约在 `shared/` 中单一来源。
- 新增注释要解释不直观的约束或安全原因，不要描述显而易见的赋值。

## 测试选择

根据改动范围选择最小但足够的验证：

- 纯领域逻辑、排序、校验、storage helper：`npm run test:unit`
- API route、workspace、保存、恢复、上传、导出接口：`npm run test:api`
- Electron 主进程、preload、CSP、导航或 IPC：`npm run test:electron`
- React 组件、hooks、自动保存、交互状态：`npm run test:ui`
- 端到端桌面行为：先 `npm run build`，再 `npm run test:desktop`
- 发布或跨层改动：`npm run verify`

覆盖率阈值为 statements/lines/functions 75%，branches 65%。新增高风险逻辑时不要只依赖快照或 happy path；至少覆盖失败、冲突或恢复路径。

## 发布与打包

- macOS 安装包：`npm run dist:mac`
- Windows 安装包：`npm run dist:win`
- 通用打包：`npm run dist`

公开发布前遵循 `docs/release-checklist.md`。当前项目仍未进行 Apple notarization 或 Windows code signing；不要移除 `package.json` 中 packaged macOS 使用 mock keychain 的构建元数据，除非已经完成签名能力并做过对应验证。

## 改动前后检查清单

开始前：

- 阅读与改动相关的 `docs/architecture.md` 或 `docs/design-system.md` 片段。
- 确认是否涉及 workspace 持久化、schema、Electron IPC、TeX 执行或文件路径安全。
- 检查工作区是否已有用户改动，不要回退无关变更。

完成后：

- 运行与改动范围匹配的测试或说明未运行原因。
- 如果改了用户可见行为，同步 README 或 docs。
- 如果改了 schema 或示例数据，同步迁移脚本、样例和测试。
- 如果改了导出或编译，确认失败时不会破坏上一次成功输出。
- 不要提交用户 workspace 内容、生成产物、覆盖率结果或本地应用数据。
