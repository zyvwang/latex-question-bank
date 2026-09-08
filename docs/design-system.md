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

- A persistent top navigation owns page switching and the global save state. Editor, Heatmap, and Bank Settings are peer pages rather than drawers or modals.
- Wide desktop: the question navigation defaults to 288px, can be resized from 240px to 360px, and can collapse to a 48px rail. Workspace lifecycle controls live on the Bank Settings page rather than in the editor sidebar.
- The active module gives source code about 55% of the editor width and preview about 45%. The separator keeps both panes usable, with a 35% to 65% source-width range and pixel minimums before the layout stacks.
- The heatmap uses a wrapping grid and one preview pane. Its toolbar is approximately 72px tall; the mode-specific legend opens on demand. The preview defaults to 420px, resizes from 380px to 520px, and can collapse. Small banks use a compact content band instead of stretching the grid through the viewport. Rows retain Chinese chapter numerals; uncategorized items stay last without a numeral.
- Medium desktop: editor and preview stack vertically; metadata uses two columns.
- Below 760px: navigation and workspace become a single column with a horizontal question strip.
- The workspace uses focused editing with one active module at a time. Question, solution, and note switch through tabs, and the preview follows the active module.

## Interaction

- Undoing a question deletion checks source-number availability in the destination chapter. A conflict shows an error and preserves the undo until its original ten-second deadline; resolving the conflict allows a retry without overwriting another question.
- Chapter and review-option names and review colors commit on Enter or blur after validation. Destructive chapter and option deletion requires confirmation.
- Review metadata combines text with color swatches; “unset” remains a fixed system state and is never represented as a removable option.
- Sidebar filters use compact multi-select menus. Counts expose active filters without expanding the control labels, and review filters pair color swatches with text.
- Sidebar question summaries show review state as compact color-and-pattern marks, separated into mastery and error-reason groups. Chapter and tag names use separate rectangular tokens, wrap as whole tokens, and break inside a token only when one name exceeds the available width.
- The editor uses the same chapter and tag token vocabulary while keeping the native chapter select and the existing tag add/remove behavior.
- “Current list” and “Selected items” share one stable action slot. Selected-items mode replaces filter controls with a quiet note explaining that filters are preserved but paused.
- Module tabs support Left, Right, Home, and End.
- Editor, question-navigation, and heatmap-preview separators are draggable and keyboard adjustable. Arrow keys move by one step, Home and End move to the limits, and every separator exposes its controlled panes and current range through ARIA.
- Heatmap cells are real buttons with roving `tabindex`. Left and Right traverse the ordered grid, Up and Down move between chapter rows, Home and End move within the current chapter, and Enter opens the full editor.
- Heatmap preview changes require a stable 200ms hover or keyboard-focus target. Changing the item resets the preview to Question. Returning from the editor restores the previous mode, scroll position, and cell focus.
- Editor and heatmap LaTeX previews own their horizontal and vertical scrolling. Trackpad and horizontal-wheel deltas scroll directly, Shift plus a vertical wheel scrolls horizontally, and overflowing content exposes a horizontal scrollbar.
- Mastery mode pairs the option color with its pattern. Error mode shows at most three patterned stripes and a `+N` overflow label. Combined mode uses mastery as the background and error reasons as corner marks.
- Mastery history uses a persistent record list beside a read-only detail view. Names edit inline; delete and restore require confirmation. Only the five-record capacity boundary uses a modal chooser, with the oldest record selected by default and a clear warning that canceling abandons the pending review edit.
- Review state is never encoded by color alone. Patterns, corner marks, numeric overflow, accessible names, preview text, and the visible legend carry the same meaning. Cell text automatically chooses dark ink or white for contrast.
- Interactive targets are at least 40px or use an expanded hit area.
- Press feedback uses `scale(0.96)` for 120-160ms.
- Motion is limited to opacity and transform, and is disabled for reduced-motion preferences. Resizing and high-frequency editing feedback do not animate layout properties.
- Focus rings remain visible for keyboard users.
- Modal dialogs contain keyboard focus. The backdrop only blocks the pointer, so `src/hooks/useFocusTrap.ts` wraps Tab and Shift+Tab at both ends and returns focus to the opening element on close. The hook owns initial focus; a dialog that needs a specific landing spot marks it with `data-autofocus` rather than `autoFocus`, which fires too early to record the outside element.
- A save conflict opens a dismissible, focus-contained resolution dialog and leaves a persistent coral “保存冲突” action in the global navigation. Dismissing it allows continued editing but does not resume disk writes. The dialog shows a structural difference summary and keeps destructive disk/local replacement actions explicit; save-as remains non-destructive to the original workspace.

## CSS Ownership

- `foundation.css`: reset, semantic tokens, focus, reduced motion.
- `controls.module.css`: shared buttons only.
- Component CSS Modules: local layout and visual states.
- CodeMirror selectors are scoped with `:global(...)` inside the module editor container.

Avoid decorative gradients, glass effects, mixed radius systems, and generic cards around every section.
