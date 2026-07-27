# Release Checklist

Use this checklist before producing a public macOS DMG or Windows NSIS installer.

## Local Verification

1. Run `npm ci` on a clean checkout when possible.
2. Run `npm run verify`.
3. Run `npm run test:desktop` after `npm run build`.
4. Confirm coverage remains at or above statements/lines/functions 75% and branches 65%.
5. Confirm the Vite output keeps the main chunk separate from `LatexEditor`.
6. If TeX is installed locally, confirm `scripts/verify-export.ts` compiles both `questions.pdf` and `full.pdf`.
7. Validate schema migration with a disposable v1 workspace:
   - opening returns an in-memory v2 bank while `bank.json` remains byte-for-byte v1
   - the returned revision hashes the original v1 content
   - the first real save writes v2 and preserves v1 in both `bank.json.bak` and the session recovery snapshot
   - duplicate legacy source numbers remain loadable, while new same-chapter conflicts are rejected
8. Launch the desktop app with `npm run desktop:dev` and smoke-test:
   - first workspace setup
   - editing followed immediately by app quit and restart
   - generic save failure pauses automatic requests and retries only once on demand
   - save conflict remains stable while editing, refreshes its disk summary, and supports disk reload, revision-checked local overwrite, and independent save-as
   - conflict save-as copies referenced images only and rejects non-empty or symlinked targets without changing the current workspace
   - missing recent workspace relocation/removal
   - damaged `bank.json` recovery from `.bak` or `.history/`
   - PNG/JPEG upload and disguised-file rejection
   - current-item compile
   - successful same-name export replacement and failed replacement preservation
   - chapter creation/rename/reorder/delete and chapter-local question reorder
   - review-option edit/reorder/delete, reference cleanup, and multi-tag comma input
   - multi-value chapter/tag/mastery/error-reason filtering with OR within fields and AND across fields
   - current/selected list switching, preserved filters, filter-independent export selection, and default select-all after workspace switch
   - complete sidebar review marks, separate wrapping chapter/tag tokens, and matching editor metadata tokens
   - normal export order follows chapter order and chapter-local order
   - Heatmap mastery, error-reason, and combined modes, including patterns, three-stripe limit, `+N`, and the visible legend
   - 200ms heatmap preview switching across Question, Solution, and Note with only one MathJax preview instance
   - two-pane heatmap layout without a chapter index, with chapter labels retained on each row
   - horizontal trackpad/wheel and Shift-wheel scrolling for wide MathJax in both editor and heatmap previews
   - Heatmap Arrow keys, Home, End, Enter, screen-reader names, visible focus, and editor-return restoration
   - a production build with the 1000-item fixture, checking entry, mode switching, scrolling, and preview response without noticeable input blocking
   - same-day mastery-history merging, cross-day creation, unique rename validation, detail viewing, deletion, and restore
   - restoration keeps bodies, chapters, order, assets, and newer questions while recreating missing review options
   - the sixth-history chooser defaults to the oldest record; canceling keeps all records and abandons the triggering review edit
   - mastery history in `bank.json` is clearly distinguished from `.history/` disaster-recovery snapshots
   - workspace create/open/switch/reorder/relocate/reveal/remove-from-list actions on Bank Settings, including staying on that page after a switch
   - removing the final workspace returns to Setup while its directory and `bank.json` remain on disk
   - a bank save beyond 64 MiB shows the persistent size error and leaves disk/revision unchanged; reducing content retries successfully

## CI Release Build

1. Push the release branch or tag.
2. Run the **Build LaTeX Question Bank Installers** workflow.
3. Confirm Linux verification and TeX Live export compilation pass.
4. Confirm both Windows and macOS jobs pass `npm run verify`, the packaged Electron smoke test, and installer packaging.
5. Download and test artifacts:
   - Windows: `release/*.exe`
   - macOS: `release/*.dmg`
6. For tag builds, review the draft GitHub Release notes before publishing.

## Known Signing Limit

The project still does not perform Apple notarization or Windows code signing. Until a valid
Developer ID is configured, packaged macOS builds set `lqbUseMockKeychain` to avoid repeated login
keychain prompts. Remove that build metadata flag when signing is enabled, then verify the packaged
app uses the system keychain without prompting repeatedly. Public release notes should mention that
unsigned early builds may still show operating-system launch warnings.
