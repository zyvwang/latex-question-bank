<p align="center">
  <img src="docs/brand/icon.png" width="112" height="112" alt="LaTeX Question Bank icon">
</p>

<h1 align="center">LaTeX Question Bank</h1>

<p align="center">
  Write, organize, check, and export LaTeX questions on your own computer.
</p>

<p align="center">
  <a href="README.md">中文</a>
  ·
  <a href="https://github.com/zyvwang/latex-question-bank/releases">Download preview</a>
</p>

<p align="center">
  <a href="https://github.com/zyvwang/latex-question-bank/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zyvwang/latex-question-bank/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/zyvwang/latex-question-bank/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/zyvwang/latex-question-bank?include_prereleases"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-187f79"></a>
</p>

![Main editor in LaTeX Question Bank](docs/screenshots/main.png)

LaTeX Question Bank is a local-first desktop app. Each item has separate question, solution, and note modules. You can preview formulas while writing, check the current item with a local XeLaTeX installation, and export selected questions as PDFs.

Questions, images, and exports stay in a normal folder that you choose. The app requires no account and does not upload your question bank to a remote service.

The application interface currently uses Simplified Chinese. This README provides the complete English documentation for installation and operation.

## Features

- Write LaTeX in separate question, solution, and note modules.
- Resize the source/preview split and the question sidebar; keyboard-adjust or collapse the side panes.
- Preview formulas with MathJax and insert PNG or JPEG images.
- Check the current item with a local XeLaTeX installation. The result stays bound to the exact item content that was compiled.
- Organize items with formal chapters, books, source labels, and multiple tags.
- Mark each item with a review priority (skip / review again / must review).
- Let an external agent import selected examples, exercises, screenshots, or variants through the local `lqb` CLI, or import a whole book into a new bank; imported items enter pending review automatically.
- Approve, edit, delete, or bulk-approve agent-imported items on a dedicated 待审阅 page.
- Undo an agent import batch; approved or manually edited items are kept.
- Variant questions link back to their original; screenshot attachments appear as expandable thumbnails in the details row.
- Combine keyword, chapter, book, tag, review-priority, and review-status filters. Multiple values within one field use OR, while different fields use AND.
- Switch between the filtered current list and a selected-items list that ignores filters. Filtering never changes export selection.
- Reorder items inside a chapter. Normal exports use chapter order followed by chapter-local order; seeded random order remains reproducible.
- Manage chapters, books, import history, and global LaTeX on the dedicated Bank Settings page.
- Export question-only and complete `.tex` and `.pdf` files, with a warning when selected items still need review.
- Manage multiple local workspaces with autosave, atomic writes, backups, and history snapshots.

## Requirements

The app does not bundle a TeX distribution. Live preview works without one, but compile checks and PDF export require these commands:

| Platform | Recommended distribution | Required commands |
| --- | --- | --- |
| macOS | MacTeX or BasicTeX | `latexmk`, `xelatex` |
| Windows | MiKTeX or TeX Live | `latexmk.exe`, `xelatex.exe` |
| Linux | TeX Live | `latexmk`, `xelatex` |

Confirm the installation from a terminal:

```bash
latexmk --version
xelatex --version
```

The app checks `PATH` and common install locations, then confirms that both `latexmk` and `xelatex` run in the compilation environment. Settings identify an unavailable command. If TeX is elsewhere, set the `latexmk` path under Bank Settings → LaTeX.

## Install

Download the preview installer for your platform from [GitHub Releases](https://github.com/zyvwang/latex-question-bank/releases):

- macOS: `.dmg`
- Windows: `.exe`

The preview builds are not yet notarized by Apple or signed for Windows. Your operating system may show a security warning.

If macOS reports that the app is damaged, move it to `/Applications` and run:

```bash
xattr -dr com.apple.quarantine "/Applications/LaTeX Question Bank.app"
```

## Quick start

1. Launch the app and choose “新建空白题库” (New blank bank).
2. Pick a normal folder for the workspace.
3. Click `+` in the upper-left corner to create an item.
4. Choose a book, source label, chapter, and tags, then set the review priority as needed.
5. Write LaTeX in the Question, Solution, and Note tabs; the solution header can record the answer source and reference page.
6. Click “检查当前题” (Check current item) to run a real compile.
7. Filter and select the items you need, review them in the selected-items list, choose an order, and export.
8. Use Bank Settings to manage chapters, books, PDF/answer-book paths, and global LaTeX.

Choose “体验示例题库” (Try sample bank) on first launch if you want to explore a filled workspace.

![First launch in LaTeX Question Bank](docs/screenshots/setup.png)

## Agent import

An external agent (Claude Code, Codex, Qoder, and similar tools) can read PDFs, answer booklets, or screenshots locally and import structured questions through `lqb`. The desktop app must stay running, and the agent never edits `bank.json` directly.

Install the CLI from the repository root:

```bash
npm run link:cli
```

Initialize instructions and link a bank in the agent working directory:

```bash
lqb agent-init
lqb link
lqb status --json
```

Dry-run the manifest, then import:

```bash
lqb import --file manifest.json --dry-run --json
lqb import --file manifest.json --json
```

Whole-book imports create a new bank named after the book by default. Chunks can share a `--batch-id`; add `--switch` to open the new bank immediately:

```bash
lqb import --file book-1.json --create-bank --switch --batch-id whole-book --json
lqb import --file book-2.json --batch-id whole-book --json
lqb import undo whole-book --json
```

Imported items are pending review. The app shows the pending count in the navigation; the 待审阅 page lets you approve, edit, delete, or bulk-approve items. An idle app reloads imports and undos automatically; while you are editing it shows a “题库已在外部更新” banner instead of discarding local work.

Use `lqb tag` to organize tags (add, remove, rename, merge). Preview with `--dry-run` first; a write changes only tags, leaves review status alone, and saves an undo file so it can be reverted:

```bash
lqb tag list
lqb tag rename 数列极限 "考点·数列极限" --dry-run
lqb tag apply --file tags.json --json
lqb tag undo .lqb/tag-undo/<file>.json
```

![Review page with a variant link and screenshot attachment](docs/screenshots/review.png)

![Books and import history in Bank Settings](docs/screenshots/settings.png)

This version supports selected examples/exercises, screenshot attachments, variant questions, whole-book imports, new-bank creation, batch undo, and tag organization. See [docs/agent-workflow.md](docs/agent-workflow.md) for commands, manifest fields, and security boundaries.

## Write LaTeX

Enter body fragments rather than a complete document:

```tex
Given $f(x)=x^2$, find $f'(x)$.
```

Display math works as expected:

```tex
\[
\int_0^1 x^2\,dx=\frac{1}{3}.
\]
```

Put shared packages and commands under Bank Settings → LaTeX:

```tex
\usepackage{amssymb}
\newcommand{\R}{\mathbb{R}}
```

Live preview is designed for quick editing. The XeLaTeX checks used by Check current item and Export are authoritative.

## Export

Each successful export creates a folder inside the current workspace:

```text
exports/
└── questions-2026-07-24-1/
    ├── questions.tex
    ├── questions.pdf
    ├── full.tex
    └── full.pdf
```

- `questions.*` contains question statements only.
- `full.*` contains questions, solutions, and notes.
- Default names use `questions-YYYY-MM-DD-N`.
- Normal order follows chapter order and then chapter-local order, with uncategorized items last. A random order can be reproduced with the same seed.
- A same-name export is built in a temporary directory and replaces the previous result only after both PDFs succeed.

## Workspace and data

A workspace is a normal folder that you control:

```text
workspace/
├── bank.json
├── bank.json.bak
├── assets/
├── exports/
├── .tmp/
└── .history/
```

- `bank.json` uses schema `version: 3` for formal chapters, books, chapter-local order, item sources, review priorities, review status, answer sources, import history, item content, and LaTeX settings. Agent import records include batch counts and a `.history/` snapshot reference.
- `assets/` stores inserted images.
- `exports/` stores completed exports.
- `.tmp/` stores temporary files from current-item checks and export work. The app limits how many it keeps during a session and removes entries older than seven days at startup.
- `bank.json.bak` and `.history/` provide disk disaster-recovery points. Mastery history and the heatmap are no longer part of the product.

Save requests carry a content revision. If another program changes the file, the app rejects the overwrite and reports a conflict. You can load the disk version, refresh its revision and overwrite it with your local version, or save the local content as an independent workspace. Writes use a temporary file and atomic replacement. The first change in an app session also creates a history snapshot.

A complete bank save request is supported up to 64 MiB. Oversized banks remain pending and prompt you to split the workspace or reduce its content. File content is flushed to storage, and parent directory entries are synced on a best-effort basis on POSIX platforms.

Existing `version: 1` and `version: 2` banks open directly. Legacy chapter text is converted to formal chapters in memory, `sourceNumber` is split into a book and source label, and an existing “待审阅” tag becomes the pending-review status. Legacy mastery, error reasons, and mastery history are discarded; every migrated item starts with no review priority. Read-only use does not rewrite the file. Before the first real edit is saved as v3, the original content is retained in `bank.json.bak` and the session recovery snapshot.

Layout save failures show a separate retry action in the navigation bar. Retry saves the latest layout; quitting with an unresolved write failure opens the existing unsaved-changes dialog. Bank save status remains independent.

The app keeps only recent workspace paths, a custom TeX path, and UI layout preferences in local application data. Workspaces remain ordinary folders under your control: “Remove from list” only clears the recent entry, and the app never deletes the folder or its `bank.json`. It does not provide cloud sync. If another tool syncs your workspace, avoid editing the same bank on multiple computers at once.

## Local development

Development requires Node.js 24 and npm.

```bash
npm install
npm run dev
```

Common verification commands:

```bash
npm run typecheck
npm run lint
npm run test
npm run verify
```

Start the Electron development build:

```bash
npm run desktop:dev
```

Regenerate the real README interface screenshots with the deterministic synthetic bank:

```bash
npm run screenshots:readme
```

Build installers:

```bash
npm run dist:mac
npm run dist:win
```

Follow the [release checklist](docs/release-checklist.md) before publishing.

`npm run verify` runs lint, build, the full test suite with coverage once, and export verification. See [the performance baseline](docs/performance-baseline.md) for the repeatable large-bank benchmark.

## Stack

React 19, Vite, TypeScript, Express, Electron, CodeMirror, MathJax, and XeLaTeX.

## License

[MIT](LICENSE)
