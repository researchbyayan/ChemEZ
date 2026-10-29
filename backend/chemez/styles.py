"""Explicit answer-mode contracts, kept independent of provider implementations."""
import re

STYLES = {
    'mechanism': "Mechanism mode: the drawings carry the answer, the prose stays brief (one short sentence per stage, about 150 words in total). Draw everything the pathway needs. For a transformation, return ordered mechanism panels with all species, explicit formal charges, lone electron pairs and anchored electron-flow arrows. Explain bonds broken, formed or changed at each stage. End with the products panel. Ask for reactants and conditions when missing; do not invent a reaction for a molecule-only request. For resonance, return resonance contributors and electron movement instead of a reaction mechanism. Do not add an unsolicited quiz.",
    'balanced': '''Explain mode: the full, teaching answer. Mechanism panels are optional here: explain the mechanism in words and draw reaction schemes or structures where they help. For a substantial chemistry question write 250–450 prose words (drawings do not count). Open with the direct result in one or two sentences, then teach it: short headed sections (for example "Why it happens", "Step by step", "Conditions", "Common mistakes") with the reasoning behind each point, and the relevant drawings placed right after the text that refers to them. Use worked numbers when a calculation is involved. Do not add a quiz or a check-your-understanding question unless the user asks. Greetings and one-fact questions stay short.''',
    'concise': '''Quick answer mode: short, not curt. Write 50–100 prose words, never more than 120: the direct result in the first sentence, then two or three short bullets giving the key reason, number or condition. No headings, sections or step-by-step teaching (that is Explain mode), and not a bare one-liner either. Include the structure or reaction drawing the pathway needs; for a long, multi-part question you may skip drawings and answer in words. Drawing metadata does not count toward the prose limit. Do not add background teaching, a quiz, or an unsolicited final question. A mechanism explicitly requested by the user still needs its essential ordered panels. For an oversized task, give a useful bounded first part and ask for scope.''',
}


# The learner's level shapes vocabulary, depth and assumed knowledge. It never removes
# chemically necessary content: every level still gets the full drawings and correct details.
# The levels describe the reader, never ChemEZ itself (it must not call itself "undergraduate").
LEVELS = {
    'school': '''Learner level: high school (GCSE/A-level, AP, IB). Write so a 16-year-old follows every sentence. Short sentences, everyday words; define each technical term in brackets the first time ("nucleophile (an electron-pair donor)"). One concrete analogy where it helps. Name mechanisms in words ("the OH⁻ attacks the carbon") rather than with jargon. No orbital, kinetic-isotope, pKa-table or thermodynamic-equation arguments unless asked. Round numbers sensibly. Still give correct reagents, structures and every necessary step.''',
    'undergraduate': '''Learner level: university chemistry (first or second year). Standard textbook vocabulary (nucleophile, electrophile, carbocation, resonance, pKa, SN1/SN2, E1/E2) without defining routine terms. Give reasons in terms of electronics, sterics and stability; mention stereochemistry, regioselectivity and the classic exam pitfalls where relevant. Use equations with units where a calculation applies.''',
    'graduate': '''Learner level: graduate / professional chemist. Dense and technical; never define standard terms. Argue with orbitals (HOMO/LUMO, Bürgi–Dunitz, hyperconjugation), kinetics versus thermodynamics, Hammond postulate, solvent and counter-ion effects, and practical detail (typical conditions, catalyst loading, side reactions, workup, safety, industrial practice) where relevant. Cite named reactions and standard values precisely.''',
}


# Slash commands typed at the start of a question; they add to the selected answer mode.
COMMANDS = {
    'versus': '''/versus comparison. If only one comparison subject is named and the other is not clear from context, ask which second compound or concept the learner wants to compare; do not invent it. Compare the compounds, reactions or ideas the learner names. Draw each compound (molecule, or resonance block when resonance is the point) side by side, then one Markdown table with a row per relevant property (structure, key physical property, acidity or basicity, reactivity, and why they differ), then a one-line verdict that says which is greater or preferred and the main reason.''',
    'stepbystep': '''/stepbystep. Teach it one step at a time, never as a summary list. For a calculation: ONE markdown block of numbered steps, one short sentence each, with the equation each step needs. For structures, resonance or mechanisms: one markdown block per step, starting "**Step n.**", that says exactly which electrons move (which lone pair or π bond, from which atom or bond to which), followed by that step's own drawing: a resonance block whose contributors are just the before and after structures with their curved arrows, or a mechanism block for that step. Give the whole series in one resonance block (every contributor in order, including charge-separated ones, each with its curved arrows) or one complete mechanism block; ChemEZ splits it into one drawing per step and writes each step's electron movement from your arrows, so do not repeat the drawing per step. Never say how many structures there are without drawing each one. The last line is always the result, written as "**Answer:** ..." (with units for a calculation). Example: {"blocks":[{"type":"markdown","text":"1. Molar mass of NaOH = 40.00 g/mol.\\n2. $n = m/M = 10/40.00$\\n3. $n = 0.25$ mol\\n\\n**Answer:** 0.25 mol"}]}''',
    'synthesis': '''/synthesis. Plan a route from the starting material to the target the learner names (ask for whichever is missing). Return one reaction block per step, in order, then one short markdown note. No resonance or molecule blocks. Example shape for toluene to benzoic acid: {"blocks":[{"type":"reaction","reactants":[{"smiles":"Cc1ccccc1","label":"Toluene"}],"products":[{"smiles":"OC(=O)c1ccccc1","label":"Benzoic acid"}],"reagents":"KMnO4, NaOH","conditions":"heat, then H3O+","caption":"Step 1: side-chain oxidation"},{"type":"markdown","text":"Why: ..."}]}''',
    'practice': '''/practice. Do not answer or explain the topic. Return exactly one clarification block: "question" is one exam-style multiple-choice question on the topic at the learner's level, and "options" are four short answer choices in plain text, exactly one correct, in random order. Do not reveal which is correct. When the learner later picks an option, say whether it is right, explain why, and give the correct answer.''',
    'nomenclature': '''/nomenclature. Convert between name and structure (draw a molecule block with formula and IUPAC name). Then show the naming in short numbered rules: parent chain or ring, principal group and suffix, numbering, substituents in alphabetical order, stereodescriptors.''',
    'lab': '''/lab. Give a practical procedure for the reaction the learner names: the reaction block, then sections Reagents (amounts for a typical small scale), Procedure (numbered), Workup and purification, Hazards (GHS-level hazards of each reagent and the key precautions) and How to tell it worked. Educational guidance only; never give procedures for weapons, explosives or illicit drugs.''',
    'calc': '''/calc. Solve the calculation in numbered lines (use molar masses ChemEZ supplies; check the arithmetic of every line before writing the result): given values with units, the formula, the substituted numbers, then the result with units and sensible significant figures. Check units on every line and state any assumption. Draw a structure or reaction only if the problem is about one.''',
    'spectra': '''/spectra. For the compound the learner names, draw it (a molecule block), then give predicted spectra as Markdown tables: IR (key bands, cm⁻¹, assignment), ¹H NMR (δ ppm, integration, multiplicity, assignment), ¹³C NMR (δ ppm, assignment) and the mass spectrum (M⁺ equals the molar mass ChemEZ supplies, and the main fragments). Keep it compact: at most six rows per table and no prose between tables. Say these are typical predicted values, not measured data. No resonance or reaction blocks. Example shape: {"blocks":[{"type":"molecule","smiles":"CCO","label":"Ethanol","formula":"C2H6O"},{"type":"markdown","text":"**IR**\\n\\n| cm⁻¹ | Assignment |\\n|---|---|\\n| 3350 (broad) | O–H |\\n\\n**¹H NMR**\\n\\n| δ (ppm) | H | Multiplicity | Assignment |\\n|---|---|---|---|\\n| 1.2 | 3 | t | CH3 |\\n\\n**¹³C NMR**\\n\\n| δ (ppm) | Assignment |\\n|---|---|\\n| 58 | CH2O |\\n\\n**MS**\\n\\n| m/z | Ion |\\n|---|---|\\n| 46 | M⁺ |\\n\\nTypical predicted values, not measured data."}]}''',
}


def split_command(text):
    """('versus', rest of the question) for "/versus …", else (None, text)."""
    found = re.match(r'\s*/(\w+)\b\s*', text or '')
    if found and found.group(1).lower() in COMMANDS:
        return found.group(1).lower(), text[found.end():]
    return None, text


def command_issue(command, blocks):
    """What a slash command's answer must contain, as a repair request (None when it does)."""
    if command == 'practice':
        asked = [b for b in blocks if b.get('type') == 'clarification' and len(b.get('options') or []) >= 3]
        return None if asked else '/practice must return one clarification block: a multiple-choice question with four options, and no answer.'
    if any(b.get('type') in ('clarification', 'error') for b in blocks):
        return None
    kinds = {b.get('type') for b in blocks}
    if command == 'synthesis' and 'reaction' not in kinds:
        return '/synthesis needs one reaction block per step, in order, with reagents and conditions. Do not describe the route only in prose.'
    prose = ' '.join(b.get('text', '') for b in blocks if b.get('type') == 'markdown')
    last = prose.strip().split('\n')[-1] if prose.strip() else ''
    if command == 'stepbystep' and not re.search(r'answer\W*:|^\W*(?:result|therefore)\b', last, re.I) and not (re.search(r'=', last) and re.search(r'\d', last)):
        return '/stepbystep must end with the final result on its own line, written as "**Answer:** ...".'
    if command == 'calc' and not (re.search(r'answer|result|therefore|=', last, re.I) and re.search(r'\d', last) and not re.match(r'\s*\d+\.\s+\D*$', last)):
        return f'/{command} must end with the final result on its own line.'
    if command == 'spectra':
        from .nmr import issue
        drawn = next((b.get('smiles') for b in blocks if b.get('type') == 'molecule'), None)
        mismatch = drawn and issue(drawn, prose)
        if mismatch:
            return mismatch
    if command in ('nomenclature', 'spectra') and not kinds & {'molecule', 'resonance'}:
        return f'/{command} needs a molecule block for the compound (SMILES, formula and IUPAC name).'
    if command == 'spectra' and not any(b.get('type') == 'markdown' and '|' in b.get('text', '') for b in blocks):
        return '/spectra needs the predicted IR, NMR and mass spectra as Markdown tables.'
    return None


def answer_system(base, mode, level='undergraduate'):
    return base + '\n\nAnswer style: ' + STYLES[mode] + '\n' + LEVELS[level] + '\nThis selected answer mode takes precedence over general suggestions about prose length; the learner level sets vocabulary and depth. Chemical correctness and explicitly requested content remain required at every level. For questions outside chemistry, answer directly in one or two brief sentences regardless of mode, without forcing diagrams. Never use an em dash.'


def style_issue(blocks, mode, question):
    if any(b.get('type') in ('clarification', 'error') for b in blocks):
        return None
    if mode=='mechanism' and re.search(r'react|mechanism|hydrolys|substitut|eliminat|oxid|reduc|addition|esterif|\b[se]n?[12]\b',question,re.I) and not any(b.get('type') in ('mechanism','resonance') for b in blocks) and not (re.search(r'industrial|gas.phase|surface|catalytic converter|haber|contact process',question,re.I) and any(b.get('type')=='reaction' for b in blocks)):
        return 'Mechanism mode requires ordered mechanism panels with anchored electron-flow arrows, or a clarification if essential conditions are missing. For SN2, SN1, E2 or Fischer esterification you may instead give {"type":"mechanism","name":"SN2","reactants":[substrate SMILES, nucleophile or base SMILES]} (acid then alcohol for esterification) and ChemEZ draws every panel.'
    prose = '\n'.join(b.get('text', '') for b in blocks if b.get('type') == 'markdown')
    words = re.findall(r'\S+', prose)
    if mode == 'mechanism' and len(words) > 300:
        return 'Mechanism mode keeps prose brief: one short sentence per stage, about 150 words in total. Keep every drawing.'
    if mode == 'concise' and len(words) > 140:
        return 'Quick answer mode requires at most 120 prose words: the result first, then two or three short bullets, no headings or quiz. Keep all necessary validated drawings.'
    return None


def diagram_issue(blocks,question,mode='balanced'):
    if any(b.get('type') in ('clarification','error') for b in blocks):
        return None
    transformation=bool(re.search(r'react|synthesi|prepar|convert|oxid|reduc|mechanism|resonan|electron|esterif|multistep|route|two.stage|two.step',question,re.I))
    structure_only=bool(re.search(r'structure|iupac|formula|name|draw',question,re.I)) and not transformation
    # A bare topic ("Benzylic carbocation") is about a species, not a reaction to invent.
    topic=len(question.split())<=4 and not transformation and not re.search(r'\w(?<!c)ation\b|condens|rearrang|coupling|reagent|made|form',question,re.I)
    if (structure_only or topic) and any(b.get('type') in ('reaction','mechanism') for b in blocks):
        return 'This is a structure/name question. Return the requested molecule and name, without an unrequested reaction or mechanism.' if structure_only else 'This question is about a species, not a reaction. Draw the species (and its resonance contributors if they explain it) without an unrequested reaction or mechanism.'
    prose=' '.join(b.get('text','') for b in blocks if b.get('type')=='markdown')
    no_reaction=bool(re.search(r'no reaction|does not (?:undergo|react)|will not|doesn.t react',prose,re.I))
    requested=bool(re.search(r'reaction|oxidation|reduction|esterification|synthesis|multistep|multi-step|route|two-stage|two-step',question,re.I))
    drawings=[b for b in blocks if b.get('type') in ('reaction','mechanism')]
    for b in blocks:
        steps=b.get('steps') or []
        if b.get('type')=='mechanism' and (len(steps)<2 or steps[-1].get('arrows')):
            return 'Each mechanism block must be complete: start from the reactants, give every intermediate as its own panel, and end with a products panel that has no arrows.'
    # Quick answers may leave drawings out of long questions; the pathway still decides the rest.
    if mode=='concise' and len(question.split())>25:
        return None
    if requested and not drawings and not no_reaction:
        return 'The question requests a reaction, synthesis or mechanism, but the answer has no validated reaction or mechanism drawing. Include the requested ordered scheme.'
    if re.search(r'multistep|multi-step|two-stage|two-step',question,re.I) and len(drawings)<2 and not no_reaction:
        return 'This multi-step question needs separate ordered reaction blocks for each step, rather than a single collapsed drawing.'
    return None
