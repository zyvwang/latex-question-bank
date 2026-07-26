# Mastery Heatmap

The heatmap is a local, read-only overview of review metadata already stored on each question. It does not add filters, automatic scoring, remote data, or review information to LaTeX and PDF exports.

## Status semantics

Each question has two independent dimensions:

- Mastery is a single option. `masteryOptionId: null` means unset.
- Error reasons are a list. `errorReasonOptionIds: []` means unset.

Unset is a fixed system state with color `#858681` and a dot pattern. It is not an editable or removable option. Other options have stable IDs, names, order, `#RRGGBB` colors, and one of the supported patterns.

The grid has three modes:

- Mastery uses the mastery color and pattern as the cell background.
- Error reasons divide the cell into at most three patterned stripes. Additional reasons appear as `+N`.
- Combined uses mastery for the background and up to three error-reason corner marks, with `+N` for additional reasons.

Cell text automatically chooses dark ink or white from the rendered background. Color is never the only status signal. The visible legend, patterns, corner marks, overflow text, preview metadata, and accessible name repeat the meaning.

## Chapter and item order

Formal chapters follow their saved order and use Chinese numerals in the chapter index and grid. A chapter name is shown once beside its wrapping cell collection. Cells show chapter-local numbers only.

Uncategorized questions use `chapterId: null`. They always form the final row, use no chapter numeral, and still use their normalized chapter-local order.

The heatmap derives this order from `bank.json`; it does not persist a second order or modify the editor and export selections.

## Preview and editing

There is exactly one MathJax preview on the page. A hover or keyboard-focus target must remain stable for 200ms before it replaces the preview. This keeps rapid pointer and keyboard movement from repeatedly typesetting intermediate questions.

The preview has Question, Solution, and Note tabs. Selecting another question resets the preview to Question. Clicking a cell or pressing Enter opens that question in the full editor. Returning to Heatmap restores the selected mode, grid scroll position, and roving-focus cell for the current workspace session.

## Keyboard and assistive technology

Every cell is a real button. Only the current cell has `tabindex="0"`:

- Left and Right move through the complete ordered grid.
- Up and Down move to the nearest available position in the adjacent non-empty chapter.
- Home and End move to the first and last question in the current chapter.
- Enter opens the full editor.

Each accessible name includes the chapter, chapter-local order, source number, mastery, and every error reason, including reasons hidden behind `+N`. Focus rings remain visible and interactive targets are at least 40px.

## Performance boundary

The first implementation directly renders 1000 memoized cell buttons and does not use a virtual list. Only the preview contains MathJax. Unit and UI fixtures verify ordering, mode changes, debouncing, and a single preview; the packaged desktop test exercises entry, scrolling, mode switching, and preview updates with 1000 questions.

If production measurements no longer meet the input-response requirement, the approved fallback is chapter-row virtualization without changing the schema or user flow.

## Data safety and history boundary

Heatmap navigation and preview actions do not write history and do not introduce API routes. Changes to mastery state, error reasons, or their option definitions continue through the normal bank model and revision-checked autosave path, and also update mastery history.

`bank.json` version 2 stores mastery history for the whole workspace:

- Each local date has at most one record, continually replaced with that day's final review state.
- A default name uses `WorkspaceName · 2026-Jul-25`. Names are unique after whitespace trimming, Unicode normalization, and English case folding; automatic conflicts receive ` (2)` and later suffixes.
- At most five records are retained. Before a sixth date is created, the user chooses a record to delete, with the oldest selected by default. Canceling leaves history unchanged and abandons the triggering review edit.
- Settings can view, rename, delete, and restore a record. Delete and restore require confirmation.
- Restore changes only mastery, error reasons, and missing option definitions. Question bodies, chapters, order, assets, and questions added later remain unchanged; questions deleted since the record are ignored.
- Historical option definitions merge first by stable ID and then by normalized name. Any still-missing definition is recreated.
- Restore is itself a review mutation and is recorded in the current local date.

The workspace `.history/` directory and `bank.json.bak` remain disk disaster-recovery storage. They are not the same as mastery history and are not changed by deleting a mastery-history record.
