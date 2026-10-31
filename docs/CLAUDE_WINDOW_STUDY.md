# Claude desktop window study

Inspected locally with REA and read-only ASAR source inspection. No Claude code was executed, modified, or incorporated into ChemEZ.

## Artifact and coverage

- Artifact: `/Applications/Claude.app/Contents/Resources/app.asar`
- SHA256 reported by REA: `f09c89b9f9b73b6d21c44052d6ebc3f9d4b1fb2f9800b4c33f60fa2a4d5e693e`
- Initial scope: `.vite/build/mainWindow.js`, evidence `ev_1a06fae223e76f0402588a1b7ed8673ee42f68cfa608181332093c89b7892c65`.
- Bootstrap: package entry `.vite/build/index.pre.js` requires `.vite/build/index.js`; that imports `.vite/build/index.chunk-m4oMImJ-.js`.
- Bootstrap REA evidence: `ev_dd15375628434449df48ba9bf62dc35e379323c2fedc5d79467bf7d445f6654b`.
- ASAR metadata contradicts some unpacked native files; REA recorded those integrity issues and marked affected content untrusted. Static source observations do not prove runtime behavior or platform equivalence.

## Relevant observations

The main chunk has window-state restore logic that independently tests maximized and fullscreen states and invokes Electron's corresponding window methods. This supports keeping desktop maximize and native fullscreen as separate user-selectable operations in ChemEZ. It does not establish exactly how Claude's titlebar buttons behave at runtime.

The same chunk contains a sidebar-material preference and a sidebar vibrancy option. This is a macOS reference, not a Windows acrylic implementation. ChemEZ's Windows compatibility adapter therefore follows Electron's documented OS support instead of assuming macOS vibrancy maps to Windows.

No reliable conclusion about Claude's remote chat-history ownership or composer proximity behavior has been established from these window modules. ChemEZ's implementation is independently covered by its own interaction regressions, including switching away from and back to a generating chat and preserving scroll position during long answers.

## ChemEZ verification

- Local Electron smoke checked maximize against desktop work area, fullscreen entry, and fullscreen exit.
- UI regression checked saved fullscreen preference and expand-action dispatch.
- Windows backdrop options are unit-tested for Windows 10 and Windows 11 builds. Native Windows visual verification remains outstanding.
- Installer builds remain stopped pending explicit owner approval of the Electron dev UI.

Full semantic analysis of the 6.8 MB main chunk reached REA's 30-second per-source deadline; partial observation is retained as `ev_237f294c6138753fc7b4568b19e4507f5845d7748f50333c66988dfda3f077bd`. The window observations above come from direct bounded read-only source excerpts, not a claim that full semantic analysis completed.
