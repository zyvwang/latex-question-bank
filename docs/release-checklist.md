# Release Checklist

Use this checklist before producing a public macOS DMG or Windows NSIS installer.

## Local Verification

1. Run `npm run audit:security`; treat registry or audit-service errors as failures rather than bypassing the gate.
2. Run `npm ci` on a clean checkout when possible.
3. Run `npm run verify`.
4. Run `npm run test:desktop` after `npm run build`.
5. Confirm coverage remains at or above statements/lines/functions 75% and branches 65%.
6. Confirm the Vite output keeps the main chunk separate from `LatexEditor`.
7. If TeX is installed locally, confirm `scripts/verify-export.ts` compiles both `questions.pdf` and `full.pdf`.
8. Validate schema migration with a disposable v1 workspace:
   - opening returns an in-memory v2 bank while `bank.json` remains byte-for-byte v1
   - the returned revision hashes the original v1 content
   - the first real save writes v2 and preserves v1 in both `bank.json.bak` and the session recovery snapshot
   - duplicate legacy source numbers remain loadable, while new same-chapter conflicts are rejected
9. Launch the desktop app with `npm run desktop:dev` and smoke-test:
   - first workspace setup
   - editing followed immediately by app quit and restart
   - editing the latexmk override followed immediately by app quit and restart, without manually blurring the field
   - launching a second desktop instance exits the newcomer, restores/focuses the existing window, keeps one BrowserWindow/API server, and preserves pending edits through the normal close flush
   - generic save failure pauses automatic requests and retries only once on demand
   - save conflict remains stable while editing, refreshes its disk summary, and supports disk reload, revision-checked local overwrite, and independent save-as
   - conflict save-as blocks dismissal, background editing, and duplicate requests until completion; cancel/failure preserves local edits, pending uploads prevent save-as, and closing waits for the operation
   - initial AppInfo failure and repeated retry failure show an error; a successful retry enters Setup or Workspace
   - closing during delayed/concurrent image uploads offers return-to-edit; after completion, retrying close persists image references; workspace changes reject pending uploads and uploads cannot begin during a transition
   - uploads across A → B and A → B → A never insert stale assets or notices, and accepted uploads write only to their captured directory
   - conflict save-as copies referenced images only and rejects non-empty or symlinked targets without changing the current workspace
   - opening, switching, or relocating to malformed `bank.json` leaves the prior workspace active and still saveable; successful transitions make no follow-up bank request
   - a missing current workspace offers retry, relocation, explicit switching to an available recent workspace, and removal without silently changing workspaces
   - `desktop:dev`, Vitest, and packaged desktop runs use separate application-data roots
   - missing recent workspace relocation/removal
   - damaged `bank.json` recovery from `.bak` or `.history/`
   - PNG/JPEG upload and disguised-file rejection
   - the per-workspace TeX trust prompt cancels without spawning a compile, and accepting it covers later compile/export actions in that application session
   - current-item compile, including a concurrent request receiving `LATEX_BUSY` without interrupting the active compile
   - successful same-name export replacement, failed replacement preservation, and startup recovery from an interrupted two-rename transaction
   - chapter creation/rename/reorder/delete and chapter-local question reorder
   - book creation/rename/path edit/protected delete and multi-tag comma input
   - review-priority and pending-review metadata badges, including approval from the metadata panel
   - multi-value chapter/tag/book/review-priority/review-status filtering with OR within fields and AND across fields
   - current/selected list switching, preserved filters, filter-independent export selection, and default select-all after workspace switch
   - complete sidebar source labels, priority/pending/variant badges, separate wrapping chapter/tag tokens, and matching editor metadata tokens
   - normal export order follows chapter order and chapter-local order; the export dock warns about selected pending-review items
   - rapid repeated edits to numbered or labelled equations, confirming one MathJax typeset at a time, stable final numbering, and no duplicate preview nodes
   - horizontal trackpad/wheel and Shift-wheel scrolling for wide MathJax in the editor preview
   - a production build with the 1000-item fixture, typing continuously in the active question and checking sidebar/preview response without noticeable input blocking
   - v1/v2 migration creates books/source labels, converts an existing “待审阅” tag to pending, drops legacy mastery/error/history, and keeps `.history/` recovery snapshots readable
   - restoration keeps bodies, chapters, order, assets, books, and newer questions
   - source uniqueness is enforced for book-linked items across the whole bank; bookless labels may repeat
   - Agent discovery file is created with 0600 permissions; missing/wrong bearer tokens return `AGENT_UNAUTHORIZED`
   - `lqb status`, `lqb link`, `lqb agent-init`, `lqb list/search/get`, `lqb book list`, and `lqb batch list` work with the app running
   - agent dry-run writes nothing; commit creates pending items, import-log records, and a `.history/` snapshot
   - approved duplicates are skipped with a partial result; `--overwrite` updates and returns them to pending
   - `lqb bank create` creates an empty v3 bank with copied settings; `--switch` switches and omitting it leaves the app on the prior workspace
   - `lqb import --create-bank` creates the requested/default path, copies settings and top-level chapters, imports pending items, and refuses an existing `bank.json`
   - chunked imports with one `--batch-id` merge into a single import record; `lqb import undo <batchId>` removes only pending, unedited items, restores overwritten items, keeps approved/edited items, and reports missing snapshots with exit code 6
   - book path edits clear the matching hash with a visible notice; referenced books cannot be deleted; the import log shows batch IDs and undone status
   - screenshot assets are validated, written under `assets/`, substituted from `{{asset:key}}`, and content-hashed
   - image uploads preserve UTF-8 original filenames in the attachment row and preview dialog
   - an attachment with no `{{asset:key}}` reference is still stored and shown in the details thumbnail row; the preview dialog traps focus and closes with Escape
   - variant imports require an existing `variantOf`; the sidebar shows a 变式 badge, the details row links to the original, and a deleted original shows 原题已删除
   - `npm run screenshots:readme` regenerates `main.png`, `review.png`, and `settings.png` at 1470×891 from synthetic data, and all three are inspected
   - agent import rejects a stale `baseRevision`, a mismatched workspace, and an invalid manifest without partial writes
   - the Review page approves, advances, bulk-approves, deletes with undo, shows the pending count, and handles empty/filtered-empty states
   - idle external imports and undos auto-refresh; focused drafts, uploads, saves, or workspace transitions show the external-update banner instead of overwriting
   - `/api/events` sends `bank-changed` after a successful import, undo, or tag change and cleans up clients when the server closes
   - `lqb tag --dry-run` writes nothing; a real `lqb tag apply/rename/delete` changes only tags and `updatedAt` (approved questions stay approved, no `.history/` snapshot), writes `.lqb/tag-undo/*.json`, and an idle app reloads with a notice while a focused draft shows the banner
   - with prefixed tags (`考点·`/`考法·`/`题型·`): the sidebar shows separate 考点/考法/题型 filters that combine with AND, rows list topics plus a type badge, and the details panel edits each dimension in its own field with the prefix added automatically; banks without such tags look unchanged
   - `lqb tag undo` restores only questions whose tags are unchanged since, lists the rest, exits 3 when any were skipped, and can be re-run safely
   - workspace create/open/switch/reorder/relocate/reveal/remove-from-list actions on Bank Settings, including staying on that page after a switch
   - removing the final workspace returns to Setup while its directory and `bank.json` remain on disk
   - a bank save beyond 64 MiB shows the persistent size error and leaves disk/revision unchanged; reducing content retries successfully

## CI Release Build

1. Push the release branch or tag.
2. Run the **Build LaTeX Question Bank Installers** workflow.
3. Confirm the release-version check and dependency security audit pass before any install or build job starts. `node scripts/verify-release-version.mjs` requires matching `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version`. Tag builds (including manual runs on a tag) additionally require `GITHUB_REF` to equal `refs/tags/v<version>`; manual branch builds only check the files.
4. Confirm Linux verification and TeX Live export compilation pass.
5. Confirm both Windows and macOS jobs pass `npm run verify`, `npm run test:desktop`, installer packaging, then `npm run test:packaged` before artifact upload.
   - `test:desktop` launches the repository with Electron; `test:packaged` launches the packaged executable and requires `app.isPackaged` and an ASAR app path.
   - Local macOS: `npm run build && npx electron-builder --mac dmg --publish never && npm run test:packaged`. Run before `cleanup-macos-unpacked.mjs` removes the unpacked app.
   - Local Windows: `npm run build && npx electron-builder --win nsis --publish never && npm run test:packaged`.
   - Packaged tests launch outside the repository, use disposable app data/workspaces, and verify Setup, sample workspace creation, MathJax, PNG upload, immediate quit and restart persistence. Missing artifacts fail; failed runs retain logs, traces and screenshots under `test-results/packaged/`.
   - This checks the packaged application, not installation/uninstallation by DMG or NSIS. Test those installers manually in step 6. macOS success does not substitute for the Windows CI result.
6. Download and test artifacts:
   - Windows: `release/*.exe`
   - macOS: `release/*.dmg`
7. For tag builds, review the draft GitHub Release notes before publishing.

## Known Signing Limit

The project still does not perform Apple notarization or Windows code signing. Until a valid
Developer ID is configured, packaged macOS builds set `lqbUseMockKeychain` to avoid repeated login
keychain prompts. Remove that build metadata flag when signing is enabled, then verify the packaged
app uses the system keychain without prompting repeatedly. Public release notes should mention that
unsigned early builds may still show operating-system launch warnings.
