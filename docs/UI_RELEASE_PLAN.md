# UI and window release plan

Requested scope: composer collapses with a sliding animation into a search-bar-height input; native maximize/fullscreen preference; bundled Lexend-style application font; Windows desktop transparency; safe history navigation during generation; Claude behavior study using REA; native release builds on GitHub.

## Sequence and gates

1. Audit existing work and inspect Claude's shipped Electron application using REA. Preserve current chat switching changes.
2. Implement composer compact/expanded states, keyboard behavior, transitions and reduced-motion support. Verify desktop and narrow layouts.
3. Add a settings preference for maximize versus native fullscreen, with validated main-process IPC. Verify restore behavior.
4. Bundle a licensed Lexend font locally for app text only. Include attribution and preserve chemistry/math fonts.
5. Audit Windows transparency/window creation and native material support. Validate on Windows CI; report machine-dependent limitations accurately.
6. Verify chat navigation during generation, late events, cancellation, restoration and drafts with real UI regression coverage.
7. Build native macOS Intel/Apple Silicon and Windows installers; inspect CI results, sizes and packaged smoke checks. Publish release candidates with actual verification status and retain signing prerequisites.

## Current evidence

- The three supplied references identify the composer, native window controls, and wordmark typography.
- Existing uncommitted work modifies generation ownership in App.tsx and adds switching.spec.ts. It is retained for review and verification.
- Final release readiness is unproven until every gate above has evidence. No EOD completion claim is made in advance.

## Progress checkpoint

- Composer compact/expanded preference and sliding tools implemented; production frontend build passes. UI geometry, attachment behavior and keyboard regression checks remain required.
- Added validated `toggle-fullscreen` IPC and saved Appearance preference for native fullscreen versus desktop maximize. Native runtime verification remains required.
- Bundled Lexend variable font (Google Fonts) with SIL Open Font License, registered in attribution inventory. Website untouched.
- Four history/navigation-during-generation Playwright regressions pass (switch away/back, immediate history listing, new empty chat during generation, late events while viewing other chats).
- REA inspected Claude `.vite/build/mainWindow.js` under evidence `ev_1a06fae223e76f0402588a1b7ed8673ee42f68cfa608181332093c89b7892c65`. Archive integrity contradictions were recorded as untrusted; static analysis does not establish runtime behavior. Focused interpretation/runtime comparison remains required.
- Windows currently requests acrylic on every Windows version, although native backdrop support depends on OS version. Windows 10 fallback and real-machine verification are outstanding.
- Public signed release workflow requires owner signing credentials. No release has been produced for this checkpoint yet.

### Validation update

- All five UI tests pass, including a compact composer height <=58 px, retained draft, Enter submission while compact, restored controls, and computed Lexend font.
- Windows backdrop adapter now selects native acrylic only on build 22621+; Windows 10/earlier Windows 11 use transparent surfaces. Three adapter tests pass. Native Windows visual checks remain outstanding.
- macOS explicitly disables zoomToPageWidth so desktop maximize fills screen width rather than using page preferred width. Fullscreen remains a separate saved user preference.
- npm test passes (Electron suites plus 11 frontend unit tests).

### User correction

- Lexend is restricted to the top-left ChemEZ wordmark. General interface typography is restored to its original stack; the connected EZ artwork and italic hero styling remain.
- Replaced the floating boxed collapse chevron with a faint composer-edge grab handle.
