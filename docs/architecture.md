# Architecture

LaTeX Question Bank is a local-first React, Express, and Electron app. The browser UI talks to the local API through same-origin requests in packaged desktop builds and through the Vite proxy in development.

## Data Flow

```text
React UI
  -> src/api/client.ts
  -> Express API in server/index.ts
  -> domain services and storage modules
  -> workspace files: bank.json, assets/, exports/, .tmp/, .history/
```

The shared API and data contracts live in `shared/`. Frontend and backend modules should import those types instead of maintaining separate copies.

## Frontend Boundaries

- `src/App.tsx` is only the composition root and screen-state switch.
- `src/context/LayoutPreferencesContext.tsx` owns renderer layout preferences. Desktop builds read and write the internal `uiLayout` block in local `app-state.json` through narrow preload methods; browser development falls back to `localStorage`. These preferences never enter a workspace or `bank.json`.
- `src/context/QuestionBankProvider.tsx` exposes focused lifecycle, workspace, questions, selection, compile/export, workspace UI, app-view, and review contexts. Components consume only the domains they render.
- `src/hooks/useQuestionBankModel.ts` composes workspace state, derived lists, persistence, selection, reordering, compile, and export actions. `useQuestionBankContextValues.ts` turns that model into memoized context values with stable action references.
- `useSelectionFilters.ts` owns session-only export selection, multi-value filters, and current/selected list mode. `questionFilters.ts` applies OR within each filter field and AND across fields. Empty searches and failed structured filters never read the LaTeX modules; active full-text searches reuse an in-memory item-identity cache. Ordering, tag catalogues, and source-number conflict membership are cached from their structural fields so ordinary module typing does not rebuild them. The selected list derives only from `selectedIds`, so filters never mutate or constrain export selection.
- `src/hooks/useAutosave.ts` owns the single-flight, coalescing save queue and its `flush()` boundary. Any failed save pauses automatic draining: later edits only replace the pending in-memory bank until the user explicitly retries or resolves a conflict. `BANK_CONFLICT` is a distinct state with disk reload, revision-checked local overwrite, and save-as exits.
- Export operations capture the autosave workspace path and generation before waiting. The session-scoped flush rejects stale operations (including A → B → A) before touching the queue and drains the latest renderer bank instead of a captured older bank. It returns the saved snapshot/revision. Every export continuation checks its session and operation generation before changing notices, names, results, or busy state. An accepted server export may finish in its original workspace after a renderer transition; its stale response is ignored.
- `src/hooks/useBeforeCloseFlush.ts` owns the close boundary and runs two steps: commit the draft on the focused element, then flush both the bank autosave queue and the workspace-settings queue. Fields that keep a local draft and only commit on blur (source number, chapter name, review option name/colour, history name, half-typed tags, and the latexmk override) are invisible to their persistence queue until that blur happens, so quitting mid-typing would drop them silently. The blur must run inside `flushSync` — React batches bank state updates otherwise, and the flush would still close over the previous bank. The latexmk override uses its own serialized latest-value queue; it is combined into this one ordered close callback rather than a separate concurrent preload listener. A draft rejected by validation or either save queue aborts the close and surfaces its message through the main-process unsaved dialog.
- Initial lifecycle is ordered as AppInfo loading, Setup, Recovery, then Workspace. A `setupRequired` AppInfo never triggers a bank request; removing the last recent workspace clears bank/autosave references and returns to Setup.
- Question item mutations, drag tracking, and menus/reorder dialogs live in separate hooks instead of one interaction controller.
- `useBankSettingsActions.ts` owns validated chapter and review-option mutations, including normalized-name uniqueness, reference cleanup, and destructive confirmations.
- `useReviewHistory.ts` routes review-state and review-option mutations through one daily history transaction, owns the five-record capacity decision, and exposes rename, delete, and restore actions. `src/review-history.ts` contains the pure daily capture and restore merge rules.
- `useAppView.ts` owns top-level page selection plus the heatmap mode, scroll position, and roving-focus return target. Workspace changes reset the heatmap session state; a change started from Bank Settings keeps that top-level page active so consecutive workspace-management actions stay together.
- `src/heatmap.ts` is the shared frontend domain layer for chapter rows, Chinese chapter numerals, accessible item descriptions, and keyboard target calculation.
- `src/components/HeatmapScreen.tsx` composes the memoized chapter-row grid, a bounded resizable preview, and one MathJax preview. Cells never create their own preview instances. Hover and focus targets must remain stable for 200ms before the preview changes.
- `HeatmapGrid.tsx` resolves option ids to names and colours once per render using its own lookup maps, then passes only scalars and resolved options into the memoized cell. Never pass `bank` or a `HeatmapGroup` into `HeatmapCell`: both change identity on every bank edit, which defeats the memo across the whole 1000-item grid. `describeHeatmapItem` in `src/heatmap.ts` takes already-resolved values for the same reason.
- `src/components/` contains focused view components for setup, question navigation, workspace management in Bank Settings, the editor workspace, heatmap, module editors, preview, and overlays.
- `LatexPreview.tsx` owns both axes of preview scrolling in the editor and heatmap. Native horizontal wheel deltas pass through, while Shift plus a vertical wheel maps to horizontal movement when no horizontal delta is already present. Its MathJax content host is updated through one renderer-global queue: rapid updates are debounced, stale versions are skipped, old MathItems are cleared before content replacement, the TeX input state is reset, and `typesetPromise` calls never overlap across editor and heatmap previews.
- CodeMirror is isolated in `src/components/LatexEditor.tsx` and lazy-loaded by `ModuleEditor`, keeping the initial Vite bundle smaller.
- `src/api/client.ts` is the only place that should call `fetch` for app API routes.
- `src/styles/foundation.css` owns global tokens and reset rules. Shared controls and component styling use CSS Modules.

## Backend Boundaries

- `server/index.ts` only assembles middleware, routers, frontend serving, and server startup.
- `server/routes/` groups workspace, bank/recovery, and document/export HTTP adapters. `server/http/` owns shared middleware and API error responses.
- Mutating-origin checks run before body parsing. JSON parsers live on routers: bank PUT accepts 64 MiB, other JSON APIs accept 8 MiB, and image upload keeps its independent Multer limit.
- `server/app-state.ts` owns pure app-state reads and serialized app-state updates. It also normalizes the internal UI layout preferences and preserves them across ordinary app-state updates, while projecting them out of the public AppInfo contract.
- `server/bank-schema.ts` owns default and sample bank creation.
- `server/json-file.ts` owns atomic JSON writes and immediate `.bak` files.
- `shared/bank-validation.ts` owns persisted v1/v2 parsing and domain invariants, `shared/request-validation.ts` owns HTTP DTOs, and `shared/validation-primitives.ts` owns scalar/date/file-name parsing. `shared/validation.ts` is a compatibility barrel.
- `server/storage.ts` is a compatibility facade. Workspace lifecycle, revision-checked bank saves, and recovery/history are implemented by separate storage modules.
- Workspace-changing routes parse the target `bank.json` before committing app state and return `AppInfo` plus the matching `BankSnapshot` in one response. The renderer never follows a successful workspace change with a second bank request. Relocation validates the replacement and updates current/recent state in one serialized app-state operation.
- Compile requests carry a workspace path; export requests also carry the saved bank revision. Document routes reject a mismatched current workspace with `WORKSPACE_CHANGED` and reject a changed export snapshot with `BANK_CONFLICT` before creating artifacts. Once accepted, exports use their captured bank snapshot and current-item compilation passes one fixed workspace path through temporary-file preparation, asset copying, and result URL construction. These operations never re-resolve their target from current app state mid-flight.
- `server/asset-service.ts` validates image extension, MIME, and signature before generating a safe server-side filename.
- `server/export-service.ts` stages and compiles exports before handing directory replacement to `server/export-transaction.ts`. The transaction module journals the two-rename commit, restores interrupted replacements, and is the only owner allowed to delete `previous-export-*` directories.
- `server/latex.ts` is a compatibility facade. Pure rendering, workspace file preparation, and TeX process management live in separate modules. Compile output uses a one-MiB head/tail buffer, formal compilations have a single fail-fast execution slot, and installation probes are deduplicated and cached briefly.

## Data Safety

`bank.json` and `app-state.json` are written through temp-file rename. Temporary content uses flushed writes and POSIX parent-directory entries are synced on a best-effort basis after commit. Directory-sync failure is warned rather than reported as a failed save after the rename has already committed. When replacing an existing file, the previous version is kept as `<file>.bak`.

The backup takes the same temp-file rename path as the main file: the previous content is copied to `<file>.bak.<pid>.<uuid>.tmp`, synced, and only then renamed over `<file>.bak`. Copying straight onto `<file>.bak` would let a crash mid-copy leave a truncated backup while the main file still holds good data — and that corruption is silent, because a backup that no longer parses simply disappears from the recovery candidate list instead of being reported. Both temp files are removed if any step fails; a hard kill can still leave one behind next to the target file. Each bank response includes a content-hash revision; saves carry that revision and are rejected with `BANK_CONFLICT` when the disk file changed. Save requests are serialized per workspace, and the renderer keeps at most one request in flight while coalescing newer edits.

Conflict overwrite never bypasses revision checks. The renderer reads `/api/bank/head` immediately before the overwrite attempt and performs one ordinary conditional save; a second external change produces another conflict instead of destroying it. The head endpoint hashes raw `bank.json`, so a valid local version can replace externally corrupted JSON while the atomic backup still preserves the corrupted disk content.

Explicit workspace transitions are server-side validation-and-commit operations. The target bank is read, validated, and migrated in memory before `currentWorkspacePath` changes; the committed AppState and matching snapshot are returned together. Invalid targets leave both server and renderer on the prior workspace. Startup is intentionally different: if the already-current workspace becomes damaged between sessions, the normal recovery screen remains available.

Startup failures distinguish an unavailable workspace from a damaged bank. A missing `bank.json` keeps the stale recent entry available for relocation and offers explicit switching/removal actions; malformed JSON continues to expose `.bak` and `.history` recovery candidates. The application never silently changes the current workspace. Electron development stores `userData` under the repository `.tmp/` tree, while packaged builds use Electron's normal application data directory; Vitest refuses to initialize storage outside the repository `.tmp/` tree.

Save-as builds a complete v2 workspace in a same-parent staging directory, copies only assets referenced by `QuestionItem.assets`, writes `bank.json`, and commits the directory before switching app state. The destination must be absent or empty. Missing, non-regular, or symlinked referenced assets fail the operation; exports, recovery history, and unreferenced assets are not copied. A failed pre-commit save-as leaves the original workspace and current app state unchanged.

Successful exports use a recoverable directory transaction. Before moving anything, the server writes a versioned record under `.tmp/export-transactions/`; it then moves the previous target aside, installs the complete staging directory, and removes the backup and record. Recovery prefers the previous complete export whenever the target is missing and a previous directory exists. Ambiguous states are preserved and block another export with `EXPORT_RECOVERY_REQUIRED`. Generic temporary cleanup never removes transaction records, previous exports, or staging protected by a pending transaction.

TeX remains a trusted-content boundary rather than a complete filesystem sandbox. Shell escape is disabled, compile processes have 45/60-second timeouts, process trees are terminated on timeout, only one formal compile may run at once, and stdout/stderr retention is capped. The renderer asks once per workspace and application session before the first real compile or export. A cross-platform restricted HOME/minimal-environment or platform sandbox would require a separate compatibility design.

The complete save request is limited to 64 MiB on both client and server. Oversized requests return `413 BANK_PAYLOAD_TOO_LARGE`, never reach storage, retain the renderer's pending bank, and can be retried after the content is reduced. Other JSON endpoints remain limited to 8 MiB.

The first bank modification in an application session also records a validated snapshot under `.history/`, retaining the newest ten snapshots. Recovery accepts only candidate IDs enumerated by the server and never accepts an arbitrary path.

The workspace schema is `version: 2`. It stores formal `chapters`, editable `masteryOptions` and `errorReasonOptions`, a validated `masteryHistory` collection, and questions with `chapterId`, `chapterOrder`, `masteryOptionId`, and `errorReasonOptionIds`. Uncategorized questions use `chapterId: null`; they sort after all formal chapters. Normal export order is derived from chapter order and chapter-local order rather than a stored global item order.

Readers also accept `version: 1` and run the pure, deterministic migration in `shared/bank-migration.ts` in memory. Legacy stars are discarded, legacy chapter text becomes formal chapters in first-appearance order, and existing duplicate source numbers remain loadable. Reads keep the revision of the original v1 bytes and do not write. Save requests accept v2 only, so the first real edit uses the existing revision check, session snapshot, atomic write, and `.bak` path to preserve the original v1 file before upgrading it.

Source-number uniqueness is a chapter-local editing invariant. Undoing deletion also checks the restored destination (or uncategorized if the chapter disappeared): an occupied non-empty source number rejects the undo without changing bank or selection. The undo remains available until its original ten-second deadline, allowing retry after resolving the conflict. Validation permits legacy duplicates so unrelated edits remain saveable; question and chapter actions prevent new duplicates when changing a source number, moving a question, or deleting a populated chapter.

Each question stores its three editable LaTeX snippets under `modules.question.tex`, `modules.solution.tex`, and `modules.note.tex`. Module rendering, upload insertion, validation, compile, and export all use this shared shape.

The `.history/` directory remains disaster-recovery storage. The `masteryHistory` array inside `bank.json` is a separate product data structure that stores at most one final review snapshot per local date and at most five dates. Review-state and option-definition changes update today's record through the normal autosave path. Creating a sixth date requires the user to choose a record to delete; canceling abandons the triggering review mutation.

Workspace subdirectories are checked with `assertRealWorkspaceSubdir` before access. Reads of individual files under `.history/`, `assets/`, and `.tmp/` additionally use `resolveRealWorkspaceFile`, which rejects absolute or parent-relative paths, symlinks in every path component, non-regular final entries, and real paths outside the checked subdirectory. Missing workspace static files may continue to the packaged frontend asset server, but unresolved `/assets/*` and `/tmp/*` requests return 404 instead of falling through to the SPA document.

Restoring mastery history changes only mastery IDs, error-reason IDs, and any missing option definitions. It keeps question bodies, chapters, order, assets, newly added questions, and current definitions. Historical options merge by stable ID, then normalized name, and missing definitions are recreated. Deleted questions are ignored, and the restore is itself captured in today's mastery history.

Question filters and export selection are renderer session state only. Opening or switching a workspace selects every question by default. Search and filter changes affect the current list but never modify `selectedIds`; the selected-items list ignores all filters and returns to the preserved current-list filters.

The heatmap is also renderer-only derived state. It does not filter or persist a second copy of question data. Formal chapter rows follow chapter order, uncategorized items form the final unnumbered row, and every cell displays the stored chapter-local order. Chapter names live on the rows rather than in a separate index. Opening a cell updates the normal editor selection; returning remounts the heatmap with its saved mode, scroll position, and roving focus target.

## Desktop Boundary

Electron exposes only narrow preload capabilities for selecting a directory, revealing a known workspace path, opening trusted URLs, reading and writing local UI layout preferences, and registering the close-time flush callback. It does not expose `ipcRenderer` and has no workspace deletion IPC.

The main process acquires Electron's single-instance lock before starting the local API, registering IPC, or creating a window. A second launch exits immediately and asks the primary process to restore, show, and focus its existing window; concurrent activation and second-instance events share one window-creation promise.

Workspaces are user-managed ordinary directories. Removing one from the recent list never deletes or trashes its directory; if it was current, the server selects the next recent workspace whose bank validates or returns Setup.

Every IPC entry validates its sender. Main-window navigation is locked to the application origin, new Electron windows are denied, and trusted HTTPS or local PDF links are delegated to the system browser. App quit and window close both wait for the renderer save queue; failures offer either returning to edit or explicitly discarding unsaved changes.

Packaged pages receive a strict CSP. Development additionally allows Vite's inline React Refresh bootstrap, local HMR, and local API connections. The macOS development runtime uses an isolated Chromium session and mock keychain so it does not contend with or request credentials for an installed build. Until Developer ID signing and notarization are configured, packaged macOS builds also enable the mock keychain through `lqbUseMockKeychain`; remove that metadata after signing is available, then verify packaged builds use the system keychain without repeated prompts.
