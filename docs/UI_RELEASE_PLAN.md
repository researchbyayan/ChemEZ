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

### CI runner migration

- Corrected checkpoint dcba7ab started native jobs, but GitHub cancelled macos-14 before allocation due its scheduled retirement brownout (check annotation 124622906421).
- Migrated ARM jobs to macos-15. macOS 14 clean-machine compatibility remains a separate required check; a macOS 15 build alone does not prove it.

### Owner approval gate

- Installer rebuilds and release publication are deferred until the owner approves the Electron development app.
- Cancelled native build run 41230389727 at owner's request.
- Next dev iteration: composer expands based on pointer proximity/focus; answers remain anchored at their beginning and do not automatically follow streaming output to the bottom.

### Dev approval iteration: pointer proximity and answer position

- Removed the manual composer toggle. Pointer proximity within 65 px above/30 px beside the composer or keyboard focus expands it; moving away collapses after 220 ms. Focused editing stays expanded.
- Removed repeated scroll-to-bottom effects and image-load scrolling. New answers anchor once at the pending answer's beginning; history opens at the top. Explicit latest-message button remains available.
- Five composer/history tests pass; a dedicated long streamed-answer regression passes and confirms the viewport is retained as additional paragraphs arrive.
- Opened npm run dev for owner review. No installer rebuilds or publication are authorized until approval.

- Fullscreen preference UI regression passes: desktop maximize default, native-fullscreen action after enabling, and persisted setting after reload. Native maximize/fullscreen transitions were separately checked by the Mac Electron smoke.
- Owner approval requested for the running dev preview; rebuilding/pushing remains gated.

### Owner review response

- Owner selected "Needs more changes" for the dev app. Build approval has not been granted.
- Requested specific design/behavior corrections before making further visual changes.
- Full dev UI regression run continues independently; existing tests are being adapted to reveal proximity-driven controls before interacting with them.

### Full dev regression findings

- Full run: 40/43 passed. Three failures were retained and investigated, not reported as a clean full run.
- The long settings/rename/pin/export flow exceeded its 30-second total budget; it passed with a 60-second flow budget (30.3 seconds observed).
- Fixed immediate composer blur collapse moving controls during an outside click: collapse is now delayed 250 ms and rechecks pointer proximity and keyboard focus. The failed-question edit/recovery flow passed afterward.
- Settings-to-API transition passed its independent rerun (14.6 seconds). No change to that transition was required.
- Existing tests now explicitly approach the composer before using controls hidden by the new proximity behavior.
- Owner requested more changes; details remain pending. All changes remain local and installer builds stay cancelled.

### New owner feedback: floating contextual composer

Requested: app self-knowledge; always-outline send arrow; jump button idle opacity 25%; plus-menu with slash commands/images; fast compositor behavior; docked versus floating setting; floating composer idle opacity 25% including text; near-question reply anchor, short rightward motion and blue gradient; default green Windowed maximize toggle.

First dev pass adds the outlined send SVG, jump opacity, commands/image tools menu, factual app support context in the assistant prompt, and relabels/inverts the window preference to Windowed maximize (on by default). Composer blur reduced from 28 to 12 px to limit sampling work.

Outstanding: docked/floating layout and persistent position, explicit contextual reply anchor/payload, blue reply styling and movement, full interaction/menu and accessibility checks, updating tests for new tool semantics. No installer builds are authorized yet.

### Floating-mode implementation checkpoint

- Dock chatbox at bottom defaults on; off makes a movable answer-overlay surface with 25% idle opacity (including text) and full hover/focus opacity.
- A drag handle moves the floating composer vertically within the chat area. Starting a draft within 280 px of an earlier question selects an explicit reply anchor; it is cleared on conversation switch and visible before send. Reply context is included in submitted text, not silently inferred by the backend.
- Reply state uses a blue gradient and short rightward shift, with reduced-motion override.
- Restored original solid send arrow per owner correction. Circle dims independently of the arrow in disabled state.
- Revised window-preference test passes; tools/floating test required a selector correction and is rerunning. Contextual drag/reply and image-menu integration still require validation. No push or installer rebuild.

- Owner rejected the first plus-menu styling. It now reuses `.slash-menu` and `.slash-command` directly, with Add image last/nearest the trigger for the upward-opening menu. Screenshot and menu regression passed.
- Removed the visible drag tab; floating composer remains draggable from its top edge.
- Contextual floating reply test passed after settling layout; confirms movement, explicit question binding, submitted reply context, and context clearing on chat navigation. Original-arrow/disabled-circle test passed after waiting for its opacity transition.

### Owner layout/reply corrections

- New floating chats use the centered welcome layout, with floating drag offset reset. Verified in browser UI.
- Floating chat history reserves 230 px of trailing reading space and scroll padding so the final answer can be moved above the overlay.
- Reply dismissal is inside the composer at the right edge with circular blue-gradient treatment; reply hue also reaches send and mode controls.
- Floating jump-to-latest stays available at the left, with effective idle opacity coordinated with its parent surface.
- Compact floating surface has an inverse light/dark treatment at low opacity.
- General reply actions are available on both questions and answers. Explicit reply anchors survive initial typing instead of being overwritten by automatic nearby-question selection.
- Contextual drag/reply and explicit-reply/new-chat regressions both passed. Additional full-suite and reading-space checks remain before release readiness. Installer builds still gated on owner approval.
