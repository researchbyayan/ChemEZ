# Offline tools and spectra review

Development candidate, 2026-11-02. No installers rebuilt or published.

## Preserve the current source checkpoint

Reviewed recent commits d593b80 (chat polish), ac1c958 (warm chemistry workers,
mechanism families and provider performance), 9cf3c73 (academic cards, electron
arrows, acid-base family and formula typesetting), and e927803 (unused asset cleanup).

The following remain byte-for-byte unchanged against this checkpoint:
chemistry.py, mechanisms.py, processing.py, providers.py, storage.py; App.tsx,
ChatScrollbar.tsx, UserMessage.tsx, scripts.ts, italics.tsx, titleCase.ts,
diagram-layout.css; Electron main and preload.

The shared answer renderer retains chemScripts, mhchem, KaTeX, academic italics,
structure scaling, step labels, family badges, title casing and molecule grouping.
Only spectral Markdown gains a lazy-loaded wrapper. Consecutive spectral Markdown
blocks can be joined so headings and peak tables split by the model still plot.
Non-spectral blocks retain the existing rendering path and order. Spectral CSS uses
only new .spectrum-figure selectors, leaving the chatbox and existing cards intact.
The backend quick-answer path adds bounded local calculations before model inference.
Existing automatic chat naming remains intact and can still call the selected API.

## Included

- Pint 0.25.3, Molmass 2026.1.8 and their small required dependencies, without extras.
- Explicit unit conversions, average/monoisotopic formula masses, atomic reference
  tables and unique neutral-equation balancing. Balancing uses original exact
  rational elimination rather than bundling ChemPy's solver stack. It conserves
  elements; it does not establish that a reaction occurs. Ionic and underdetermined
  equations are not guessed.
- Helpers are imported only for matching questions. Work runs in a thread so first
  use does not block the async event loop. The unit registry is cached.
- SVG graphs directly after IR, 1H NMR, 13C NMR and MS tables. Numeric rows only;
  ranges use their midpoint. Conventional reversed IR/NMR x-axes and forward m/z.
  Equal-height markers are schematic positions, not experimental intensities,
  integrations, line shapes or simulated multiplets. Missing numeric peaks produce
  an explicit unavailable note rather than fabricated data. No chart dependency,
  CDN, separate server, model weights or runtime downloads.
- Runtime requirements/constraints are pinned; packaging collects Pint's unit
  definitions and Python distribution metadata/licenses. Native packaged validation
  remains pending the owner's installer-build approval.

## Excluded after size/dependency inspection

- ChemPy 0.10.2: its default dependency list includes SciPy, Matplotlib, SymPy and
  additional solvers. Original narrow balancing avoids that stack.
- Chemicals 1.5.2: 22.3 MB downloaded wheel before dependencies. No property tables
  were copied; exact source-level redistribution review and a size-bounded subset
  are still required. Molmass provides offline elemental reference in this change;
  existing compound lookup/cache and RDKit descriptors are retained.
- Ketcher 3.18.0: published unpacked size ~29.8 MB for ketcher-react and ~109.8 MB for
  ketcher-standalone, before the remaining dependency tree. Not integrated. These are
  package metadata sizes, not measured installer deltas.
- No duplicate renderer, 3D library, Bioicons collection, or local LLM was installed.

Upstreams: https://github.com/hgrecco/pint ; https://github.com/cgohlke/molmass ;
https://github.com/bjodah/chempy ; https://github.com/CalebBell/chemicals ;
https://github.com/epam/ketcher .

## Performance evidence

See evaluation/local-tools-performance.json and scripts/benchmark-local-tools.py.
The five new distributions total about 4.1 MB installed in the development venv,
including metadata and bytecode. This is not an installer-size measurement.
Backend import does not import Pint or Molmass. On this machine the first unit
conversion took ~766 ms; warm median conversions ~0.30 ms, masses ~0.17 ms,
balancing ~0.95 ms, and unrelated-question dispatch ~0.004 ms. Filesystem caches
and other running applications affect timing. No claim of zero performance cost
or complete release readiness is made.

## Remaining checks

Public-release size/signature/clean-machine gates remain unchanged. No live model
accuracy run was performed for this addition; spectra graph UI tests use mock
provider events. Full compound-property datasets and a molecular sketcher are
explicitly not delivered by this candidate.

## Verification completed

- Mechanism families, chemistry, answer policy and initial local tools: 121 passing
  test executions. App and updated local-tool suite: 84 passing test executions
  (these groups overlap on local-tool tests; they are not 205 unique tests).
- Existing card rendering, formula scripts, academic italics/title casing,
  follow-up quotes, plus the new spectral parser: 13 passing frontend tests.
- Mock-provider spectra UI: four graphs, labelled axes and schematic limits;
  screenshot saved at evaluation/local-tools/spectra-graphs.png.
- TypeScript and isolated frontend production-bundle checks passed. The new
  SpectralMarkdown chunk is 3,015 bytes, 1,485 bytes gzip. This was a frontend
  measurement into a temporary directory, not an Electron installer rebuild.
- Each new package has its license text present in the generated offline credits.
  The pre-existing missing npm:lazy-val license notice remains a public-release gate.
- Existing 3Dmol eval and large-chunk build warnings were not changed by this work.


## Follow-up correction: spectra generation and table UI

The owner explicitly cancelled the dataset approach. The partial IR shard, NMR
source, archive and extracted records were removed from temporary storage; no
MultimodalAnalytical data or runtime dependency was copied into the repository.

IR curves now use Gaussian display broadening of the table positions, with broad
bands for labels indicating O-H/N-H or broadening. NMR uses Lorentzian display
broadening, without fabricated J couplings or spin-system predictions. These
algorithms change presentation, not the accuracy of the input peak estimates.
Both limitations are stated next to each chart. MS uses supplied relative
intensities where available, otherwise explicitly equal-height markers.
Spectra mode additionally calculates a natural-abundance molecular-ion isotope
envelope using Molmass, with positive unit charge and electron-mass correction.
This is not an EI fragmentation or ion-formation predictor.

The highlighter supports peak clicks, range drags, keyboard peak selection and
matching table-row highlighting. The chart can be exported as PNG. Tables now
have a complete enclosing scroll border; empty/comma-only cells show an en dash,
while numeric zero remains zero. Existing chemical typography is retained.

The earlier 3,015-byte chunk measurement describes the initial marker-only
renderer, not the enhanced interactive one. Updated graph screenshot:
evaluation/local-tools/interactive-spectra.png.

## Presentation follow-up

- Formula-only captions for exact diatomic structures resolve to common display
  names (ClCl / Cl2 -> Chlorine), while the separate formula remains Cl₂. Chlorine's
  local IUPAC field is molecular chlorine, verified against PubChem CID 24526.
- Selected peaks appear as individual rows, with isotope/formula typography.
- Clear selection and standard settings/action buttons share the compact Structure
  action treatment. Window controls, send buttons and toggle-switch geometry are
  intentionally preserved.
- Graph generation notes collapse into a details disclosure; estimated-position
  provenance stays visible in the header. Cosmetic changes do not establish that
  predicted shifts/intensities are experimentally accurate.
- Chemistry regression: 76 passing tests. Selected frontend tests: 12 passing.
  Interactive chart/PNG/export/table/UI test: passing; TypeScript checked.

Final UI cleanup: removed the original-citation disclosure and duplicate DOI line
from the References panel, retaining the source-title hyperlink and URLs in copy
output. Keyboard focus is inset and non-animated; the sidebar logo has no outline.
Reference dialog and actual keyboard-focus UI checks passed.
