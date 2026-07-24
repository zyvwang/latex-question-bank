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
- Preview formulas with MathJax and insert PNG or JPEG images.
- Check the current item with a local XeLaTeX installation.
- Organize items by source ID, chapter, tags, rating, and search.
- Select and drag items into order, or use a saved seed for reproducible random order.
- Export question-only and complete `.tex` and `.pdf` files.
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

The app checks `PATH` and common install locations. If TeX is elsewhere, set the `latexmk` path under Global LaTeX.

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
4. Add a source ID, chapter, tags, and rating.
5. Write LaTeX in the Question, Solution, and Note tabs.
6. Click “检查当前题” (Check current item) to run a real compile.
7. Select the items you need, choose an order, and export.

Choose “体验示例题库” (Try sample bank) on first launch if you want to explore a filled workspace.

![First launch in LaTeX Question Bank](docs/screenshots/setup.png)

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

Put shared packages and commands under Global LaTeX:

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
- Normal order follows the list. A random order can be reproduced with the same seed.
- A same-name export is built in a temporary directory and replaces the previous result only after both PDFs succeed.

## Workspace and data

A workspace is a normal folder that you control:

```text
workspace/
├── bank.json
├── bank.json.bak
├── assets/
├── exports/
└── .history/
```

- `bank.json` stores questions, settings, and order.
- `assets/` stores inserted images.
- `exports/` stores completed exports.
- `bank.json.bak` and `.history/` provide recovery points.

Save requests carry a content revision. If another program changes the file, the app rejects the overwrite and reports a conflict. Writes use a temporary file and atomic replacement. The first change in an app session also creates a history snapshot.

The app keeps only recent workspace paths and a custom TeX path in local application data. It does not provide cloud sync. If another tool syncs your workspace, avoid editing the same bank on multiple computers at once.

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

Build installers:

```bash
npm run dist:mac
npm run dist:win
```

Follow the [release checklist](docs/release-checklist.md) before publishing.

## Stack

React 19, Vite, TypeScript, Express, Electron, CodeMirror, MathJax, and XeLaTeX.

## License

[MIT](LICENSE)
