# Third-party sources

## seq_encode

Vendored `seq_encode/smiles.py` and package marker from hcji/seq_encode,
commit 9515620390910dba252c67feb17223717448e119.
Source: https://github.com/hcji/seq_encode
Copyright and MIT terms are preserved in backend/vendor/seq_encode/LICENSE.
The vendored source is unmodified. ChemEZ wraps it for optional diagnostics;
the alphabet is returned with each encoding because upstream uses set ordering.

## chatbot-template

Architecture reference: https://github.com/IndrajeetPatil/chatbot-template
Reviewed commit: 8b5aa31392f98987814097ad2b1bd4e513b67c8e.
No license file was present in the reviewed repository. No source code or assets
from that repository are redistributed here. ChemEZ independently implements
its documented React/FastAPI and Markdown/math architecture.

## Installed dependencies

RDKit (BSD), Electron (MIT), React (MIT), FastAPI (MIT), KaTeX (MIT), and other
runtime dependencies retain their respective upstream licenses in distributions.
The Python bundle includes dependency metadata/licenses collected by PyInstaller.
Electron Builder includes Chromium/Electron license files with the application.

## Vitrio

Liquid-glass refraction at the composer and sidebar edges uses vitrio by Eamon Liu, MIT License.
Source: https://github.com/eamonliu/vitrio, commit 3fed16666d3f6b5a0c9657182199aeb72c510db1.
The repository's built `dist/vitrio.esm.js` (newer than the npm 0.1.2 release; it adds `attachTo`)
is vendored unmodified in `frontend/src/vendor/vitrio` with its LICENSE; the type declarations
file is renamed to sit beside it. Only a static decorative light layer is cloned and refracted;
chat content and credentials are never sampled.

## XSMILES

Interactive SMILES/structure view from Bayer-Group/xsmiles, BSD-3-Clause.
Source: https://github.com/Bayer-Group/xsmiles
Commit: f8395c5f099b197366b51172281989206638c574 (version 0.7.0).
The prebuilt `dist/plain/index.js` is vendored unmodified (except the license-comment
filename) as `frontend/src/vendor/xsmiles/xsmiles.js`, with its LICENSE and bundled
dependency notices alongside. Please cite: Heberle, H. et al. XSMILES: interactive
visualization for molecules, SMILES and XAI attribution scores. J Cheminform 15, 2 (2023).
ChemEZ colours atoms by RDKit Gasteiger partial charges; these are not XAI attributions.

## RDKit MinimalLib

`RDKit_minimal.js`/`.wasm` (BSD-3-Clause), as shipped with the XSMILES commit above,
are vendored in `frontend/src/vendor/rdkit` with their license. XSMILES requires them.
Both run only inside a sandboxed iframe (`frontend/public/xsmiles-viewer.html`), because
RDKit MinimalLib needs `eval`; the app window CSP is unchanged.

## chem-skill

Common-molecule data (PubChem isomeric SMILES and aliases) from ghutchis/chem-skill,
MIT License, Copyright (c) 2025 Geoff Hutchison. Source: https://github.com/ghutchis/chem-skill
Commit: bdb58112cd010cbf6a68a244ed904f4dfb90496f. The MOLECULES and ALIASES tables are
vendored in `backend/chemez/chem_skill_molecules.py`; two generic aliases ("acid", "alcohol")
are not used for structure substitution. Its ETKDG + MMFF conformer approach informed the 3D view.

## ChemClaw

Feature reference only: https://github.com/InternScience/ChemClaw (MIT), reviewed commit
58c9efc72886af6ef9356c14387fb36e9432d597. Its 3D viewer and molecular-property skills informed
ChemEZ's 3D model and RDKit property panel. No ChemClaw code or data is redistributed.

## 3Dmol.js

3D model rendering uses the `3dmol` npm package (BSD-3-Clause), https://github.com/3dmol/3Dmol.js.
Its license is included in the generated JavaScript dependency license bundle.

## chemdraw-mcp, openmolclaw, ChemCP (feature references)

Reviewed for features only; no code or data redistributed:
jurimaxam-dotcom/chemdraw-mcp (Apache-2.0, commit 7bc67d0) informed functional-group
highlighting and "highlight changes" comparison; scottmreed/openmolclaw (Apache-2.0,
commit c32ab53) informed CIP stereo labels and InChI/InChIKey; scottmreed/ChemCP
(commit fb1c28e) matched the existing RDKit property panel. ChemEZ implements these
independently with RDKit.

## Drawing conventions

ChemEZ's own code follows published conventions from these projects; no source code from
them is included:

- ReShiki (MIT OR Apache-2.0, Ameyanagi): notched arrowhead and one-sided fishhook geometry.
- markdown-simplechem (MIT, Dmitry Shintyakov): plain-text arrow tokens (`<=>`, `->`, `hnu`).
- chemdraw-mcp (Apache-2.0): equilibrium arrow layout and tangent-oriented arrowheads.
- Chemaxon documentation (Marvin MEFlow, Structure Checker): electron-flow source and target rules and structure checks, re-implemented with RDKit.

## NMRShiftDB2 (¹³C shift data)

`backend/chemez/data/c13_shifts.json.gz` is derived from NMRShiftDB2 (`nmrshiftdb2withsignals.sd`,
https://sourceforge.net/projects/nmrshiftdb2/files/data/, version of 2024-06-06), built by
`scripts/build-c13-table.py`. It holds median measured ¹³C shifts for carbon environments
(structure within 1–4 bonds) and the number of observations.

NMRShiftDB2 data is made available under an extended ODC Open Database License (ODbL); see
https://nmrshiftdb.nmr.uni-koeln.de for the licence text. This derived table is a derivative
database and is shared under the same licence; software built with the data must be open
source (ChemEZ is MIT-licensed). NMRShiftDB2 is by Stefan Kuhn and the NMRShiftDB contributors.
