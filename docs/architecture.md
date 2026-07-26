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
- `src/context/QuestionBankProvider.tsx` exposes focused lifecycle, workspace, questions, selection, compile/export, workspace UI, app-view, and review contexts. Components consume only the domains they render.
- `src/hooks/useQuestionBankModel.ts` composes workspace state, derived lists, persistence, selection, reordering, compile, and export actions. `useQuestionBankContextValues.ts` turns that model into memoized context values with stable action references.
- `useSelectionFilters.ts` owns session-only export selection, multi-value filters, and current/selected list mode. `questionFilters.ts` applies OR within each filter field and AND across fields. The selected list derives only from `selectedIds`, so filters never mutate or constrain export selection.
- `src/hooks/useAutosave.ts` owns the single-flight, coalescing save queue and its `flush()` boundary.
- Question item mutations, drag tracking, and menus/reorder dialogs live in separate hooks instead of one interaction controller.
- `useBankSettingsActions.ts` owns validated chapter and review-option mutations, including normalized-name uniqueness, reference cleanup, and destructive confirmations.
- `useReviewHistory.ts` routes review-state and review-option mutations through one daily history transaction, owns the five-record capacity decision, and exposes rename, delete, and restore actions. `src/review-history.ts` contains the pure daily capture and restore merge rules.
- `useAppView.ts` owns top-level page selection plus the heatmap mode, scroll position, and roving-focus return target. Workspace changes reset the heatmap session state; a change started from Bank Settings keeps that top-level page active so consecutive workspace-management actions stay together.
- `src/heatmap.ts` is the shared frontend domain layer for chapter rows, Chinese chapter numerals, accessible item descriptions, and keyboard target calculation.
- `src/components/HeatmapScreen.tsx` composes the memoized chapter-row grid and one MathJax preview. Cells never create their own preview instances. Hover and focus targets must remain stable for 200ms before the preview changes.
- `src/components/` contains focused view components for setup, question navigation, workspace management in Bank Settings, the editor workspace, heatmap, module editors, preview, and overlays.
- `LatexPreview.tsx` owns both axes of preview scrolling in the editor and heatmap. Native horizontal wheel deltas pass through, while Shift plus a vertical wheel maps to horizontal movement when no horizontal delta is already present.
- CodeMirror is isolated in `src/components/LatexEditor.tsx` and lazy-loaded by `ModuleEditor`, keeping the initial Vite bundle smaller.
- `src/api/client.ts` is the only place that should call `fetch` for app API routes.
- `src/styles/foundation.css` owns global tokens and reset rules. Shared controls and component styling use CSS Modules.

## Backend Boundaries

- `server/index.ts` only assembles middleware, routers, frontend serving, and server startup.
- `server/routes/` groups workspace, bank/recovery, and document/export HTTP adapters. `server/http/` owns shared middleware and API error responses.
- `server/app-state.ts` owns pure app-state reads and serialized app-state updates.
- `server/bank-schema.ts` owns default and sample bank creation.
- `server/json-file.ts` owns atomic JSON writes and immediate `.bak` files.
- `server/storage.ts` is a compatibility facade. Workspace lifecycle, revision-checked bank saves, and recovery/history are implemented by separate storage modules.
- `server/asset-service.ts` validates image extension, MIME, and signature before generating a safe server-side filename.
- `server/export-service.ts` stages and compiles exports before atomically replacing the final directory.
- `server/latex.ts` is a compatibility facade. Pure rendering, workspace file preparation, and TeX process management live in separate modules.

## Data Safety

`bank.json` and `app-state.json` are written through temp-file rename. When replacing an existing file, the previous version is kept as `<file>.bak`. Each bank response includes a content-hash revision; saves carry that revision and are rejected with `BANK_CONFLICT` when the disk file changed. Save requests are serialized per workspace, and the renderer keeps at most one request in flight while coalescing newer edits.

The first bank modification in an application session also records a validated snapshot under `.history/`, retaining the newest ten snapshots. Recovery accepts only candidate IDs enumerated by the server and never accepts an arbitrary path.

The workspace schema is `version: 2`. It stores formal `chapters`, editable `masteryOptions` and `errorReasonOptions`, a validated `masteryHistory` collection, and questions with `chapterId`, `chapterOrder`, `masteryOptionId`, and `errorReasonOptionIds`. Uncategorized questions use `chapterId: null`; they sort after all formal chapters. Normal export order is derived from chapter order and chapter-local order rather than a stored global item order.

Readers also accept `version: 1` and run the pure, deterministic migration in `shared/bank-migration.ts` in memory. Legacy stars are discarded, legacy chapter text becomes formal chapters in first-appearance order, and existing duplicate source numbers remain loadable. Reads keep the revision of the original v1 bytes and do not write. Save requests accept v2 only, so the first real edit uses the existing revision check, session snapshot, atomic write, and `.bak` path to preserve the original v1 file before upgrading it.

Source-number uniqueness is a chapter-local editing invariant. Validation permits legacy duplicates so unrelated edits remain saveable; question and chapter actions prevent new duplicates when changing a source number, moving a question, or deleting a populated chapter.

Each question stores its three editable LaTeX snippets under `modules.question.tex`, `modules.solution.tex`, and `modules.note.tex`. Module rendering, upload insertion, validation, compile, and export all use this shared shape.

The `.history/` directory remains disaster-recovery storage. The `masteryHistory` array inside `bank.json` is a separate product data structure that stores at most one final review snapshot per local date and at most five dates. Review-state and option-definition changes update today's record through the normal autosave path. Creating a sixth date requires the user to choose a record to delete; canceling abandons the triggering review mutation.

Restoring mastery history changes only mastery IDs, error-reason IDs, and any missing option definitions. It keeps question bodies, chapters, order, assets, newly added questions, and current definitions. Historical options merge by stable ID, then normalized name, and missing definitions are recreated. Deleted questions are ignored, and the restore is itself captured in today's mastery history.

Question filters and export selection are renderer session state only. Opening or switching a workspace selects every question by default. Search and filter changes affect the current list but never modify `selectedIds`; the selected-items list ignores all filters and returns to the preserved current-list filters.

The heatmap is also renderer-only derived state. It does not filter or persist a second copy of question data. Formal chapter rows follow chapter order, uncategorized items form the final unnumbered row, and every cell displays the stored chapter-local order. Chapter names live on the rows rather than in a separate index. Opening a cell updates the normal editor selection; returning remounts the heatmap with its saved mode, scroll position, and roving focus target.

## Desktop Boundary

Electron exposes only narrow preload capabilities for selecting a directory, opening/trashing a known workspace path, opening trusted URLs, and registering the close-time flush callback. It does not expose `ipcRenderer`.

Every IPC entry validates its sender. Main-window navigation is locked to the application origin, new Electron windows are denied, and trusted HTTPS or local PDF links are delegated to the system browser. App quit and window close both wait for the renderer save queue; failures offer either returning to edit or explicitly discarding unsaved changes.

Packaged pages receive a strict CSP. Development additionally allows Vite's inline React Refresh bootstrap, local HMR, and local API connections. The macOS development runtime uses an isolated Chromium session and mock keychain so it does not contend with or request credentials for an installed build. Until Developer ID signing and notarization are configured, packaged macOS builds also enable the mock keychain through `lqbUseMockKeychain`; remove that metadata after signing is available, then verify packaged builds use the system keychain without repeated prompts.
