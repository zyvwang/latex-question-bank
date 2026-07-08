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

- Wide desktop: 312-336px navigation plus a flexible editor workspace.
- Medium desktop: editor and preview stack vertically; metadata uses two columns.
- Below 760px: navigation and workspace become a single column with a horizontal question strip.
- The workspace uses focused editing with one active module at a time. Question, solution, and note switch through tabs, and the preview follows the active module.

## Interaction

- Module tabs support Left, Right, Home, and End.
- Interactive targets are at least 40px or use an expanded hit area.
- Press feedback uses `scale(0.96)` for 120-160ms.
- Motion is limited to opacity and transform, and is disabled for reduced-motion preferences.
- Focus rings remain visible for keyboard users.

## CSS Ownership

- `foundation.css`: reset, semantic tokens, focus, reduced motion.
- `controls.module.css`: shared buttons only.
- Component CSS Modules: local layout and visual states.
- CodeMirror selectors are scoped with `:global(...)` inside the module editor container.

Avoid decorative gradients, glass effects, mixed radius systems, and generic cards around every section.
