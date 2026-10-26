# Design System

## Theme

The interface is a desktop-first paper editing desk: warm paper surfaces, restrained teal actions, and serif-led mathematical content. It favors long editing sessions and clear publishing hierarchy over decorative effects.

## Tokens

- Canvas: `oklch(0.97 0.008 91.5)`
- Paper panel: `oklch(0.994 0.007 88.6)`
- Sidebar: `oklch(0.952 0.014 157)`
- Ink: `oklch(0.237 0.016 168.5)`
- Muted ink: `oklch(0.553 0.014 156.7)`
- Accent: `oklch(0.511 0.086 186.4)`
- Danger: `oklch(0.543 0.137 31.5)`
- Radius scale: 4px, 8px, 12px

All shared tokens live in `src/styles/foundation.css`.

## Typography

- Product controls use the operating-system sans-serif stack.
- Mathematical previews, module titles, and product title use Songti-compatible system fonts.
- Source editors use the system monospace stack.
- Dynamic question numbers use tabular numerals.

No remote font dependency is required.

## Layout

- A persistent top navigation owns page switching and the global save state. Layout write failures show a separate “布局未保存 · 重试” action, leaving the bank save state visible and accurate. The status area can wrap at narrow widths; retry controls have a minimum 40px hit target. Editor, Review, and Bank Settings are peer pages rather than drawers or modals. The Review nav item carries the pending count.
- Wide desktop: the question navigation defaults to 288px, can be resized from 240px to 360px, and can collapse to a 48px rail. Workspace lifecycle controls live on the Bank Settings page rather than in the editor sidebar.
- The active module gives source code about 55% of the editor width and preview about 45%. The separator keeps both panes usable, with a 35% to 65% source-width range and pixel minimums before the layout stacks.
- The metadata panel keeps source (book + label), chapter, tags, review priority, pending status, and answer source visible without a collapsible “题目属性” drawer. Book and path management lives in Bank Settings; the read-only import log sits below it.
- A secondary context row appears only when needed: variants show their original question source as a link (or “原题已删除”), and attached screenshots render as compact expandable thumbnails. Attachments remain visible even when no TeX module references them; the preview is a focus-trapped dialog, not a replacement for embedded `\includegraphics`.
- Medium desktop: editor and preview stack vertically; metadata uses two columns.
- Below 760px: navigation and workspace become a single column with a horizontal question strip.
- The workspace uses focused editing with one active module at a time. Question, solution, and note switch through tabs, and the preview follows the active module.
- The Review page reuses the editor sidebar and workspace. A toolbar above the editor shows “待审阅 N 道”, the current source, and primary/secondary actions: approve and next, next without approval, delete, and approve the current filtered set. The export dock is hidden in Review. When no pending items remain, a centered empty state offers “返回编辑”; if filters hide pending items, it offers “清除筛选” instead.

## Interaction

- Undoing a question deletion checks the restored book + label against the whole bank. A conflict shows an error and preserves the undo until its original ten-second deadline; resolving the conflict allows a retry without overwriting another question.
- Chapter and book names commit on Enter or blur after normalized-name validation. Destructive chapter and book deletion requires confirmation; a book that is still referenced by questions cannot be deleted.
- Review priority uses four text segments: 未标记 / 不用看 / 再看看 / 必须看. The pending state is a text badge with a single “批准” action; approved items do not keep a badge in the metadata panel.
- Sidebar filters use compact multi-select menus. Counts expose active filters without expanding the control labels; book, priority, and status filters pair text labels with their values.
- Desktop sidebar question rows are virtualized with dynamic heights; keyboard navigation and export selection follow the complete logical list. Sticky chapter headings retain their push-away behaviour. Narrow layouts at 760px and below keep the ordinary list.
- Sidebar question summaries show the source label, compact review-priority, pending-review, and variant badges, followed by method tags. Sidebar questions are grouped by chapter, with an opaque sticky chapter heading below the filters. The next chapter pushes the previous heading away. Only chapters with visible questions appear, including an uncategorized group last; current and selected lists share this behavior. Chapter names wrap in full and are not repeated as row tokens. Method tags remain rectangular tokens, wrapping as whole tokens and breaking inside a token only when one name exceeds the available width.
- The editor uses the same chapter, book, priority, and tag vocabulary while keeping the native chapter select and the existing tag add/remove behavior.
- “Current list” and “Selected items” share one stable action slot. Selected-items mode replaces filter controls with a quiet note explaining that filters are preserved but paused.
- Module tabs support Left, Right, Home, and End.
- Editor and question-navigation separators are draggable and keyboard adjustable. Arrow keys move by one step, Home and End move to the limits, and every separator exposes its controlled panes and current range through ARIA.
- Editor LaTeX previews own their horizontal and vertical scrolling. Trackpad and horizontal-wheel deltas scroll directly, Shift plus a vertical wheel scrolls horizontally, and overflowing content exposes a horizontal scrollbar.
- Review priority is never encoded by color alone: each segment has a text label and a dot, with 必须看 in coral, 再看看 in amber, 不用看 in muted ink, and 未标记 as an outlined dot. Pending review is always written as「待审阅」.
- Approving the current filtered set requires a confirmation with the count. Deleting an item keeps the existing ten-second undo. The review page selects the next pending item after approval or deletion and does not alter editor filters.
- External Agent imports use a fixed banner above the bottom edge when local drafts would be lost. It names the import count, offers “重新加载” and “稍后”, and never silently replaces local edits. Idle apps refresh automatically and show a transient success notice instead; batch undos use the same path and report deleted/restored counts.
- Interactive targets are at least 40px or use an expanded hit area.
- Press feedback uses `scale(0.96)` for 120-160ms.
- Motion is limited to opacity and transform, and is disabled for reduced-motion preferences. Resizing and high-frequency editing feedback do not animate layout properties.
- Focus rings remain visible for keyboard users.
- Modal dialogs contain keyboard focus. The backdrop only blocks the pointer, so `src/hooks/useFocusTrap.ts` wraps Tab and Shift+Tab at both ends and returns focus to the opening element on close. The hook owns initial focus; a dialog that needs a specific landing spot marks it with `data-autofocus` rather than `autoFocus`, which fires too early to record the outside element.
- Conflict save-as keeps its dialog open and disables its actions while choosing a directory or copying. The background editor and navigation are inert; a status message explains the wait. Cancellation or failure restores the dialog actions and preserves the draft.
- Before AppInfo is available, a failed startup displays the error and a retry action without workspace-specific controls.
- A save conflict opens a dismissible, focus-contained resolution dialog and leaves a persistent coral “保存冲突” action in the global navigation. Dismissing it allows continued editing but does not resume disk writes. The dialog shows a structural difference summary and keeps destructive disk/local replacement actions explicit; save-as remains non-destructive to the original workspace.
- Closing during image upload returns an unsaved warning; returning to edit keeps the upload running. Retry closing after upload completion. Workspace changes reject pending uploads with a notice and ignore duplicate transition requests. The editor and navigation are inert during a transition, and new uploads cannot start until it finishes.

- Recovery disables restore, retry, and workspace transition controls while an operation runs. An uncertain workspace write pauses editing and offers “核对工作区状态”; it never silently replays the previous action.
- An uncertain conflict save-as keeps its draft and dialog open and exposes “核对另存结果”. A successful check applies the original completed response; a still-pending check keeps editing paused.

## CSS Ownership

- `foundation.css`: reset, semantic tokens, focus, reduced motion.
- `controls.module.css`: shared buttons only.
- Component CSS Modules: local layout and visual states.
- CodeMirror selectors are scoped with `:global(...)` inside the module editor container.

Avoid decorative gradients, glass effects, mixed radius systems, and generic cards around every section.
