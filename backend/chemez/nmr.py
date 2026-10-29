"""Structure facts for /spectra, and checks that a spectrum matches the structure.

No shift tables: ChemEZ describes each symmetry-unique carbon and hydrogen set (what it is
bonded to, hybridisation, hydrogen count, neighbouring hydrogens) so the model can reason out
the shifts, then checks the counts any correct spectrum must satisfy for this structure.
"""
import re
from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors


def _unique(mol, symbol):
    ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=False))
    groups = {}
    for atom in mol.GetAtoms():
        if atom.GetSymbol() == symbol:
            groups.setdefault(ranks[atom.GetIdx()], []).append(atom)
    return list(groups.values())


def _describe(atom):
    bonds = []
    for bond in atom.GetBonds():
        other = bond.GetOtherAtom(atom)
        mark = {Chem.BondType.DOUBLE: '=', Chem.BondType.TRIPLE: '#', Chem.BondType.AROMATIC: 'aromatic '}.get(bond.GetBondType(), '')
        bonds.append(mark + other.GetSymbol() + (f'H{other.GetTotalNumHs()}' if other.GetTotalNumHs() else ''))
    return f'{str(atom.GetHybridization()).lower()}, {atom.GetTotalNumHs()} H, bonded to {", ".join(sorted(bonds))}'


def facts(smiles):
    """Plain structure facts for the model, plus the expected counts used by `issue`."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    carbons = _unique(mol, 'C')
    hydrogens = []
    for group in carbons + _unique(mol, 'O') + _unique(mol, 'N'):
        count = sum(a.GetTotalNumHs() for a in group)
        if count:
            atom = group[0]
            neighbours = sum(n.GetTotalNumHs() for n in atom.GetNeighbors() if n.GetSymbol() == 'C')
            hydrogens.append((count, atom, neighbours))
    total_h = sum(a.GetTotalNumHs() for a in mol.GetAtoms())
    mass = round(Descriptors.MolWt(mol))
    text = ' '.join([
        f'{len(carbons)} distinct carbon environment(s): ' + '; '.join(
            f'C{n} ({len(group)} equivalent) {_describe(group[0])}' for n, group in enumerate(carbons, 1)) + '.',
        f'{len(hydrogens)} distinct hydrogen set(s), {total_h} H in total: ' + '; '.join(
            f'{count} H on {atom.GetSymbol()} ({_describe(atom)}), {neighbours} H on neighbouring carbons' for count, atom, neighbours in hydrogens) + '.',
        f'Molecular ion M⁺ = {mass} ({rdMolDescriptors.CalcMolFormula(mol)}).'])
    # Table skeletons with one row per environment; the model fills in only the shifts.
    split = {0: 's', 1: 'd', 2: 't', 3: 'q', 4: 'quint', 5: 'sext', 6: 'sept'}
    template = ('**IR**\n\n| cm⁻¹ | Bond |\n|---|---|\n| ? | ? |\n\n**¹H NMR**\n\n| δ (ppm) | H | Multiplicity | Assignment |\n|---|---|---|---|\n'
                + '\n'.join(f'| ? | {count}H | {"m" if atom.GetIsAromatic() else "s" if atom.GetSymbol() != "C" else split.get(neighbours, "m")} | {count} H on {atom.GetSymbol()} ({_describe(atom)}) |' for count, atom, neighbours in hydrogens)
                + '\n\n**¹³C NMR**\n\n| δ (ppm) | Carbon |\n|---|---|\n'
                + carbon_rows(smiles, carbons)
                + f'\n\n**MS**\n\n| m/z | Ion |\n|---|---|\n| {mass} | M⁺ |\n| ? | main fragment |')
    return {'text': text, 'template': template, 'carbons': len(carbons), 'hydrogens': total_h, 'mass': mass}


def _section(prose, heading):
    found = re.search(heading + r'.*?(?=\n\s*\*\*|\n#|\Z)', prose, re.S | re.I)
    return found.group(0) if found else ''


def issue(smiles, prose):
    """Count mismatches between the written spectra and the structure, as a repair request."""
    expected = facts(smiles)
    if not expected:
        return None
    problems = [f'the {name} table is missing' for name, heading in (('IR', r'\bIR\b'), ('¹H NMR', r'(?:¹|1)\s*H\s*NMR'), ('¹³C NMR', r'(?:¹³|13)\s*C'), ('mass spectrum', r'\bMS\b|mass spec'))
                if not re.search(heading, prose, re.I)]
    if re.search(r'\|\s*\?\s*\|', prose):
        problems.append('some ? cells were left unfilled')
    carbon = _section(prose, r'(?:¹³|13)\s*C')
    rows = [line for line in carbon.split('\n') if line.strip().startswith('|') and re.search(r'\d', line) and not re.fullmatch(r'\|[\s|:-]+', line.strip())]
    if rows and len(rows) != expected['carbons']:
        problems.append(f'the ¹³C table has {len(rows)} signals but the structure has {expected["carbons"]} distinct carbon environments')
    outside = [x for row in rows for x in re.findall(r'^\|\s*~?(\d+(?:\.\d+)?)', row.strip()) if not 0 <= float(x) <= 230]
    if outside:
        problems.append(f'¹³C shifts lie between 0 and 230 ppm; {", ".join(outside)} is impossible')
    proton = _section(prose, r'(?:¹|1)\s*H\s*NMR')
    high = [x for x in re.findall(r'\n\|\s*~?(\d+(?:\.\d+)?)\s*(?:[–-]\s*[\d.]+)?\s*\|\s*\d+\s*H', proton) if float(x) > 14]
    if high:
        problems.append(f'¹H shifts lie between 0 and 14 ppm; {", ".join(high)} is impossible')
    integrations = [int(x) for x in re.findall(r'\|\s*(\d+)\s*H\s*\|', proton)]
    if integrations and sum(integrations) != expected['hydrogens']:
        problems.append(f'the ¹H integrations add up to {sum(integrations)} H but the molecule has {expected["hydrogens"]} H')
    ion = re.search(r'\|\s*(\d{2,4})(?:\.\d+)?\s*\|\s*M\s*[⁺+]', prose)
    if ion and int(ion.group(1)) != expected['mass']:
        problems.append(f'M⁺ must be {expected["mass"]}, not {ion.group(1)}')
    return ('/spectra does not match the structure: ' + '; '.join(problems) + '. Reason from the structure facts given and correct the tables.') if problems else None


def carbon_rows(smiles, carbons=None):
    """¹³C rows: database predictions from measured spectra when available, else blanks to fill."""
    from . import c13
    predicted = c13.predict(smiles)
    if predicted:
        return '\n'.join(f'| {shift:.1f} | C{number}: {_describe_index(smiles, atoms[0])} |' if shift is not None else f'| ? | C{number}: {_describe_index(smiles, atoms[0])} |'
                         for number, atoms, shift, count, radius in sorted(predicted, key=lambda p: -(p[2] or 0)))
    mol = Chem.MolFromSmiles(smiles)
    return '\n'.join(f'| ? | C{n}: {_describe(group[0])} |' for n, group in enumerate(carbons or _unique(mol, 'C'), 1))


def _describe_index(smiles, index):
    return _describe(Chem.MolFromSmiles(smiles).GetAtomWithIdx(index))


def carbon_section(smiles):
    """The ¹³C table ChemEZ states itself from measured data, or None without the database."""
    from . import c13
    if not c13.available():
        return None
    rows = carbon_rows(smiles)
    if '| ? |' in rows:
        return None
    return ('**¹³C NMR** (predicted from measured spectra in NMRShiftDB2)\n\n| δ (ppm) | Carbon |\n|---|---|\n' + rows)


def replace_carbon_section(text, section):
    """Swap the ¹³C table in a Markdown answer for ChemEZ's own; append it if missing."""
    pattern = re.compile(r'\*\*\s*(?:¹³|13)\s*C[^\n]*\n.*?(?=\n\s*\*\*|\Z)', re.S)
    if pattern.search(text):
        return pattern.sub(lambda _: section, text, count=1)
    return text.rstrip() + '\n\n' + section
