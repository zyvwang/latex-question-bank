# Release Checklist

Use this checklist before producing a public macOS DMG or Windows NSIS installer.

## Local Verification

1. Run `npm ci` on a clean checkout when possible.
2. Run `npm run verify`.
3. Run `npm run test:desktop` after `npm run build`.
4. Confirm coverage remains at or above statements/lines/functions 75% and branches 65%.
5. Confirm the Vite output keeps the main chunk separate from `LatexEditor`.
6. If TeX is installed locally, confirm `scripts/verify-export.ts` compiles both `questions.pdf` and `full.pdf`.
7. For schema changes, validate a disposable workspace copy and confirm incompatible versions are rejected without overwriting `bank.json`.
8. Launch the desktop app with `npm run desktop:dev` and smoke-test:
   - first workspace setup
   - editing followed immediately by app quit and restart
   - save conflict and retry feedback
   - missing recent workspace relocation/removal
   - damaged `bank.json` recovery from `.bak` or `.history/`
   - PNG/JPEG upload and disguised-file rejection
   - current-item compile
   - successful same-name export replacement and failed replacement preservation
   - reveal/delete workspace actions

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
