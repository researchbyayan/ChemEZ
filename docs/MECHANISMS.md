# Mechanisms and electron flow

## What ChemEZ now checks

- A singleton identity scheme is a molecule, even when a model puts `None` or other labels on an arrow. Legacy stored reaction cards are normalized on restoration; the database is not destructively rewritten.
- Mechanism mode requests ordered elementary panels rather than a net equation. Missing reactants or conditions require clarification. A structure-only question remains a structure request in this mode.
- Each transition retains the atom inventory and net charge. Electron-pair arrows apply graph edits to the source panel; the resulting structure must match the following panel, including charges and stereochemistry.
- Atom → atom donation forms a bond. Atom → bond donation increases bond order. Bond → atom flow cleaves or decreases a bond. Bond → bond flow shifts bond order. The donor must have the required lone pair. Explicit hydrogen atoms are required for proton-transfer arrow anchors.
- Lone pairs appear directly on mechanism and resonance diagrams, alongside formal charges. Formed/broken bonds and changed bond orders are displayed under the relevant panel. Lone-pair dot counts use ordinary main-group Lewis electron counting.
- Resonance additionally requires identical atom order/connectivity, formula and total charge. Its arrows must reach the next contributor's exact bond orders and charges; the hybrid is a separate representation.
- Fishhook/radical transitions are not verified by the new electron-pair checker. Unsupported transitions show a limitation rather than an asserted valid arrow diagram. A terminal panel carrying arrows has an explicit unverified-destination note.

These checks establish graph consistency, not experimental truth, kinetics, solvent effects, transition states or the preferred pathway. Ambiguous stereochemical mappings can be rejected rather than inferred.

## The requested repositories

Inspected 2026-10-26:

- [MolBART](https://github.com/MolecularAI/MolBART): Apache-2.0; repository archived. The README describes SMILES denoising/heteroencoding and fine-tuned reaction prediction, retrosynthesis, optimization and properties. It does not output elementary curved-arrow mechanisms. The documented environment uses PyTorch 1.8, CUDA 11.1, Apex and additional training dependencies. No checkpoint was downloaded or run; MolBART is not bundled or credited as an inference engine.
- [RMG-Py](https://github.com/ReactionMechanismGenerator/RMG-Py): MIT/X11. It generates kinetic reaction networks and supports thermochemistry/kinetics through reaction-family databases. Its [ReactionRecipe interface](https://reactionmechanismgenerator.github.io/RMG-Py/reference/data/reactionrecipe.html) uses explicit bond, charge, radical and lone-pair actions. The independently implemented RDKit checker in `backend/chemez/electron_flow.py` uses the same public bond-action vocabulary (`FORM_BOND`, `BREAK_BOND`, `CHANGE_BOND`). This is an application of the recipe approach, not execution of RMG or a reproduction of its pathway generator. No RMG code/assets were copied.

Neither package is installed in the app runtime. Full RMG inference would need its compiled dependencies, kinetics/thermo databases, a reactor/conditions input and a separately isolated integration. Its generated kinetic network would still require a justified conversion to textbook electron-flow arrows. MolBART predictions would need a compatible fine-tuned checkpoint and would remain product candidates, not verified elementary steps. Advertising either as the current mechanism generator would be inaccurate.

## UI

Mechanism is an explicit composer answer mode. Chemistry level is in Model & API settings (and Preferences), not the composer. The existing first-launch level chooser is retained. 3D remains the default explorer view; additional 2D analysis stays on demand.

## Reproducible checks

`node scripts/smoke-mechanisms.mjs` starts an isolated profile with a local fixture endpoint and the real backend. It captures butane creation/restoration, acetate resonance and SN2 electron flow. It does not use a hosted AI key or claim live model accuracy. Screenshots and logs are saved under `tmp/mechanism-fixes/`.
