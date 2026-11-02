# Design System

## Theme

The interface is a calm desktop editing tool. Quality comes from type, spacing, alignment, and restraint rather than themed props or decoration. Mathematical content is the most prominent thing on screen. The default skin is 精修: cool gray surfaces, ink blue text and actions, and red reserved for 必须看.

Skins are the design system's public surface. A skin sets tokens and a few enumerated layout options; it cannot contain CSS, scripts, or URLs. Built-in skins are 精修 (`sheet`), 瓷白 (`porcelain`), 暗房 (`darkroom`), and 松绿 (`pine`). See `docs/skin-authoring.md` for the token contract.

## Tokens

Components use only the tokens in `src/styles/foundation.css`; `tests/unit/style-tokens.test.ts` rejects hard-coded colors and undefined tokens. Runtime values come from the active skin (`src/context/SkinProvider.tsx`), which also sets `data-skin`, `data-nav`, `data-preview`, `data-density`, and `data-heading-font` on the root element. Corner radii derive from one skin value.

## Typography

- Interface text uses Hanken Grotesk for Latin and digits, bundled in `public/fonts/`, with the system CJK sans-serif.
- Mathematical previews use MathJax with Songti-compatible system fonts.
- Source editors use the system monospace stack.
- Numbers that align use tabular numerals.
- The type scale has six steps, from 12px to 30px.

No remote font dependency is required.

## Layout

- Navigation is a side rail or a top bar, chosen by the skin, and owns page switching and the global save state. Below 760px it is always a top bar. Editor, Review, Review Distribution, and Bank Settings are peer pages.
- The editor page has three columns: the question list, the editor and preview, and the collapsible 题目信息 panel, which holds review priority, source, chapter, topics, question types, pending status, attachments, and question actions.
- The question list keeps search and the six filters visible. Rows show the source label, types, topics, and a review-priority mark. Sticky chapter headings, virtualization, drag reorder, and selection for export are preserved.
- The active module gives source code about 55% of the width. The separator keeps a 35% to 65% range. Answer source and reference appear in the solution module.
- Export is an on-demand panel opened from the editor header. Review hides export. Compile logs appear next to the check button.
- The preview is flat, a centered sheet, or a lit page on a dark surface, chosen by the skin.
- The preview translates common text commands outside math (`src/utils/latexText.ts`) because MathJax only handles math. It follows TeX line rules: a single newline is a space and a blank line starts a paragraph. Commands it cannot translate stay visible with a notice, and environments it cannot draw, such as TikZ, show a notice in place. Translation never changes exported TeX.
- Review Distribution reads from coarse to fine: an overall proportion bar, four counts that open the filtered list, a per-chapter table with expandable question detail, and a must-review list. Counts include pending questions.
- Bank Settings starts with skins. Light and dark skins are chosen separately, and the mode can follow the system. The default mode is light.

## Interaction

- Undoing a question deletion checks the restored book + label against the whole bank. A conflict shows an error and preserves the undo until its original ten-second deadline; resolving the conflict allows a retry without overwriting another question.
- Chapter and book names commit on Enter or blur after normalized-name validation. Destructive chapter and book deletion requires confirmation; a book that is still referenced by questions cannot be deleted.
- Review priority uses four labeled segments: 必须看 / 再看看 / 不用看 / 未标记. The pending state is a text badge with a single “批准” action; approved items do not keep a badge in the metadata panel.
- Sidebar filters use compact multi-select menus that stay visible. Counts expose active filters without expanding the control labels; book, priority, and status filters pair text labels with their values.
- Desktop sidebar question rows are virtualized with dynamic heights; keyboard navigation and export selection follow the complete logical list. Sticky chapter headings retain their push-away behaviour. Narrow layouts at 760px and below keep the ordinary list.
- Sidebar question summaries show the source label, compact review-priority, and pending-review badges plus one compact badge per question type, followed by topic tokens. Sidebar questions are grouped by chapter, with an opaque sticky chapter heading below the filters. The next chapter pushes the previous heading away. Only chapters with visible questions appear, including an uncategorized group last; current and selected lists share this behavior. Chapter names wrap in full and are not repeated as row tokens. Topic tokens remain rectangular, wrapping as whole tokens and breaking inside a token only when one name exceeds the available width.
- The editor uses the same chapter, book, priority, and tag vocabulary while keeping the native chapter select and the existing tag add/remove behavior.
- “Current list” and “Selected items” share one stable action slot. Selected-items mode replaces filter controls with a quiet note explaining that filters are preserved but paused.
- Module tabs support Left, Right, Home, and End.
- Editor and question-navigation separators are draggable and keyboard adjustable. Arrow keys move by one step, Home and End move to the limits, and every separator exposes its controlled panes and current range through ARIA.
- Editor LaTeX previews own their horizontal and vertical scrolling. Trackpad and horizontal-wheel deltas scroll directly, Shift plus a vertical wheel scrolls horizontally, and overflowing content exposes a horizontal scrollbar.
- Pending review is always written as「待审阅」.
- With version management on, Review gains a「原题 / 版本」switch. The version queue is a list of originals beside one reading column: the original once, then each version with its answer in plain sight, and a sticky bar for the next decision. With it off, Review shows no trace of versions.
- Review marks never rely on color alone: 必须看 is filled, 再看看 half filled, 不用看 a ring, and 未标记 a faint ring, and every mark has a text label. Opening a question from Review Distribution clears filters only when they would hide it. Selecting a count replaces the sidebar filters with that status. Returning from the editor restores expanded chapters and scroll position.
- `⌘K` (Ctrl+K outside macOS) opens the command palette for pages, skins, and questions. It is a focus-trapped dialog.
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

## Brand Icon

The mark is a Q with vertical stress, as in Computer Modern, whose tail is the end-of-proof tombstone ∎: a question that ends in Q.E.D. Paper on ink, with one coral tombstone. It deliberately carries no paper, book, or pencil props.

- `scripts/generate-brand-icons.ts` is the only source of the geometry. Change it and run `npm run brand:icons`; do not edit the PNG, ICO, or ICNS outputs by hand. Regenerating needs macOS for `iconutil`.
- Sizes below 64px use a separate heavier drawing with a larger tombstone, because the display drawing's thin side collapses when downscaled.
- macOS keeps the standard transparent margin and soft shadow on the 1024 grid; Windows and in-app icons crop tighter. `public/brand/icon-64.png` carries its own shape, so don't add a radius or box shadow around it.

## CSS Ownership

- `foundation.css`: reset, semantic tokens, focus, reduced motion.
- `controls.module.css`: shared buttons only.
- Component CSS Modules: local layout and visual states.
- CodeMirror selectors are scoped with `:global(...)` inside the module editor container.

Avoid themed props, decorative gradients, glass effects, mixed radius systems, and generic cards around every section.

## Papers

The paper workspace reuses navigation, semantic skin tokens and shared controls. A narrow saved-paper list sits beside a single scrolling editor; at narrow widths the list stacks above the editor. The form exposes rules before slots, while section headings and numbered rows carry the main hierarchy. Missing questions and rule conflicts appear on their own slots. Ordinary editing has no motion; controls retain press feedback and reduced-motion support. Styles stay in `PapersScreen.module.css`.

Primary-topic classification is an inline disclosure in Papers settings, with paged review rows, one editable standard group per question, explicit batch confirmation and visible stale/error states. Strict quotas are opt-in and appear as a compact table below paper rules. Target, selected, eligible and missing counts use aligned tabular numbers. Existing editor preview scrolling remains independent; inline paper previews chain scrolling to their parent.

表达版本管理沿用组卷页的折叠设置、分隔线和按钮层级；默认关闭。当前原题位于族顶部，生成时原题与版本题面并排对照，窄屏单列。答案、解析与不可变历史折叠展开。审批必须显式勾选同族版本，基准变化时额外确认；专门纠错使用理由、确认与状态回馈，不混入普通题型编辑。

- The expression-variant workbench keeps workspace enablement and Agent automatic enrollment as separate native checkbox rows. Automatic enrollment defaults off and stays disabled until version management is enabled. Its adjacent copy states that newly imported originals and variants require human review; it reuses the existing CSS Modules, typography, focus and 40px label targets.
