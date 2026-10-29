"""Textbook mechanisms ChemEZ builds itself from the reactants, so a model only has to name
the mechanism and give the reactant SMILES ({"type":"mechanism","name":"SN2","reactants":[…]}).

Each builder edits one RDKit molecule step by step (atoms are never deleted, so indices stay
fixed), writes every panel as SMILES and translates the arrows into that SMILES's atom order.
The panels then go through the normal electron-counting check like any model answer.
"""
import re
from rdkit import Chem

HALOGENS = ('Cl', 'Br', 'I')


class Builder:
    def __init__(self, *smiles):
        mol = Chem.Mol()
        for part in smiles:
            piece = Chem.MolFromSmiles(part)
            if piece is None:
                raise ValueError(f'Unreadable reactant SMILES: {part}')
            mol = Chem.CombineMols(mol, piece) if mol.GetNumAtoms() else piece
        self.mol = Chem.RWMol(mol)
        # Freeze every hydrogen count; hydrogens only move as explicit atoms.
        for atom in self.mol.GetAtoms():
            atom.SetNumExplicitHs(atom.GetTotalNumHs()); atom.SetNoImplicit(True)
        self.steps = []

    def atom(self, index):
        return self.mol.GetAtomWithIdx(index)

    def hydrogen(self, index):
        """Make one hydrogen on an atom explicit and return its index."""
        atom = self.atom(index)
        if atom.GetNumExplicitHs() < 1:
            raise ValueError('No hydrogen to move.')
        atom.SetNumExplicitHs(atom.GetNumExplicitHs() - 1)
        h = self.mol.AddAtom(Chem.Atom(1))
        self.mol.AddBond(index, h, Chem.BondType.SINGLE)
        return h

    def bond(self, a, b, order):
        """Set the a–b bond order (0 removes it)."""
        current = self.mol.GetBondBetweenAtoms(a, b)
        if current:
            self.mol.RemoveBond(a, b)
        if order:
            self.mol.AddBond(a, b, {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE, 3: Chem.BondType.TRIPLE}[order])

    def order(self, a, b):
        bond = self.mol.GetBondBetweenAtoms(a, b)
        return int(bond.GetBondTypeAsDouble()) if bond else 0

    def charge(self, index, delta):
        self.atom(index).SetFormalCharge(self.atom(index).GetFormalCharge() + delta)

    def panel(self, label, arrows=()):
        mol = self.mol.GetMol()
        mol.UpdatePropertyCache(strict=False)
        smiles = Chem.MolToSmiles(mol, canonical=False, allHsExplicit=False)
        order = [int(i) for i in mol.GetProp('_smilesAtomOutputOrder').strip('[],').split(',') if i]
        where = {atom: position for position, atom in enumerate(order)}
        self.steps.append({'smiles': smiles, 'label': label, 'arrows': [
            {'tail': [where[i] for i in tail], 'head': [where[i] for i in head], 'electrons': 2} for tail, head in arrows]})

    def block(self):
        return {'type': 'mechanism', 'steps': self.steps}


def _leaving_group(builder, start, end):
    """(carbon, halogen) of the first C–X bond in the substrate atoms start..end-1."""
    for index in range(start, end):
        atom = builder.atom(index)
        if atom.GetSymbol() in HALOGENS:
            carbon = atom.GetNeighbors()[0]
            if carbon.GetSymbol() == 'C':
                return carbon.GetIdx(), index
    raise ValueError('The substrate needs a C–Cl, C–Br or C–I bond.')


def _donor(builder, start, end):
    """The nucleophile or base atom: the negatively charged atom, else the first N, O or S."""
    atoms = [builder.atom(i) for i in range(start, end)]
    for atom in atoms:
        if atom.GetFormalCharge() < 0:
            return atom.GetIdx()
    for atom in atoms:
        if atom.GetSymbol() in ('N', 'O', 'S', 'P'):
            return atom.GetIdx()
    raise ValueError('The nucleophile needs a lone pair (an anion, or N, O, S or P).')


def _split(smiles_list, count):
    if len(smiles_list) != count:
        raise ValueError(f'This mechanism needs {count} reactants.')
    sizes = [Chem.MolFromSmiles(s).GetNumAtoms() if Chem.MolFromSmiles(s) else 0 for s in smiles_list]
    starts = [sum(sizes[:i]) for i in range(count)]
    return [(start, start + size) for start, size in zip(starts, sizes)]


def sn2(substrate, nucleophile):
    (s0, s1), (n0, n1) = _split([substrate, nucleophile], 2)
    b = Builder(substrate, nucleophile)
    carbon, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    b.panel('Backside attack: the nucleophile forms the new bond as the leaving group departs', [((donor,), (donor, carbon)), ((carbon, halogen), (halogen,))])
    b.bond(donor, carbon, 1); b.bond(carbon, halogen, 0); b.charge(donor, +1); b.charge(halogen, -1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        # A neutral nucleophile (water, ammonia) is deprotonated by the halide.
        h = b.hydrogen(donor)
        b.panel('Substitution product (inversion at carbon), still protonated', [((halogen,), (halogen, h)), ((donor, h), (donor,))])
        b.bond(halogen, h, 1); b.bond(donor, h, 0); b.charge(halogen, +1); b.charge(donor, -1)
    b.panel('Products: substitution with inversion of configuration')
    return b.block()


def sn1(substrate, nucleophile):
    (s0, s1), (n0, n1) = _split([substrate, nucleophile], 2)
    b = Builder(substrate, nucleophile)
    carbon, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    b.panel('Ionisation (rate-determining): the leaving group departs with the bonding pair', [((carbon, halogen), (halogen,))])
    b.bond(carbon, halogen, 0); b.charge(carbon, +1); b.charge(halogen, -1)
    b.panel('Planar carbocation: the nucleophile attacks either face', [((donor,), (donor, carbon))])
    b.bond(donor, carbon, 1); b.charge(carbon, -1); b.charge(donor, +1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        h = b.hydrogen(donor)
        b.panel('Deprotonation of the oxonium ion', [((halogen,), (halogen, h)), ((donor, h), (donor,))])
        b.bond(halogen, h, 1); b.bond(donor, h, 0); b.charge(halogen, +1); b.charge(donor, -1)
    b.panel('Products: substitution, racemised at a stereocentre')
    return b.block()


def e2(substrate, base):
    (s0, s1), (n0, n1) = _split([substrate, base], 2)
    b = Builder(substrate, base)
    alpha, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    # Zaitsev: remove a hydrogen from the most substituted β-carbon.
    betas = [n.GetIdx() for n in b.atom(alpha).GetNeighbors() if n.GetSymbol() == 'C' and n.GetNumExplicitHs()]
    if not betas:
        raise ValueError('E2 needs a hydrogen on a carbon next to the C–X carbon.')
    beta = min(betas, key=lambda i: (b.atom(i).GetNumExplicitHs(), i))
    h = b.hydrogen(beta)
    b.panel('Concerted anti-periplanar elimination: the base removes the β-hydrogen, the C=C forms and the halide leaves',
            [((donor,), (donor, h)), ((beta, h), (beta, alpha)), ((alpha, halogen), (halogen,))])
    b.bond(donor, h, 1); b.bond(beta, h, 0); b.bond(beta, alpha, 2); b.bond(alpha, halogen, 0)
    b.charge(donor, +1); b.charge(halogen, -1)
    b.panel('Products: the more substituted (Zaitsev) alkene')
    return b.block()


def fischer_esterification(acid, alcohol):
    (a0, a1), (o0, o1) = _split([acid, alcohol], 2)
    b = Builder(acid, alcohol, '[OH3+]', 'O')
    carbon = next(i for i in range(a0, a1) if b.atom(i).GetSymbol() == 'C'
                  and any(n.GetSymbol() == 'O' and b.order(i, n.GetIdx()) == 2 for n in b.atom(i).GetNeighbors())
                  and any(n.GetSymbol() == 'O' and b.order(i, n.GetIdx()) == 1 and n.GetNumExplicitHs() for n in b.atom(i).GetNeighbors()))
    carbonyl = next(n.GetIdx() for n in b.atom(carbon).GetNeighbors() if n.GetSymbol() == 'O' and b.order(carbon, n.GetIdx()) == 2)
    hydroxyl = next(n.GetIdx() for n in b.atom(carbon).GetNeighbors() if n.GetSymbol() == 'O' and b.order(carbon, n.GetIdx()) == 1 and n.GetNumExplicitHs())
    oxygen = next(i for i in range(o0, o1) if b.atom(i).GetSymbol() == 'O' and b.atom(i).GetNumExplicitHs())
    hydronium, water = o1, o1 + 1
    # 1. Protonate the carbonyl oxygen.
    h1 = b.hydrogen(hydronium)
    b.panel('Protonation of the carbonyl oxygen by the acid catalyst', [((carbonyl,), (carbonyl, h1)), ((hydronium, h1), (hydronium,))])
    b.bond(carbonyl, h1, 1); b.bond(hydronium, h1, 0); b.charge(carbonyl, +1); b.charge(hydronium, -1)
    # 2. The alcohol adds to the activated carbonyl carbon.
    b.panel('The alcohol oxygen attacks the carbonyl carbon', [((oxygen,), (oxygen, carbon)), ((carbon, carbonyl), (carbonyl,))])
    b.bond(oxygen, carbon, 1); b.bond(carbon, carbonyl, 1); b.charge(oxygen, +1); b.charge(carbonyl, -1)
    # 3. Deprotonate the added oxygen (water as base).
    h2 = b.hydrogen(oxygen)
    b.panel('Proton transfer: water removes the proton from the added oxygen', [((water,), (water, h2)), ((oxygen, h2), (oxygen,))])
    b.bond(water, h2, 1); b.bond(oxygen, h2, 0); b.charge(water, +1); b.charge(oxygen, -1)
    # 4. Protonate an OH to make water the leaving group.
    h3 = b.hydrogen(water)
    b.panel('Proton transfer: an OH group is protonated so it can leave as water', [((hydroxyl,), (hydroxyl, h3)), ((water, h3), (water,))])
    b.bond(hydroxyl, h3, 1); b.bond(water, h3, 0); b.charge(hydroxyl, +1); b.charge(water, -1)
    # 5. Water leaves as the C=O+ re-forms.
    b.panel('Loss of water: the remaining OH pushes electrons back to re-form C=O', [((carbonyl,), (carbonyl, carbon)), ((carbon, hydroxyl), (hydroxyl,))])
    b.bond(carbon, carbonyl, 2); b.bond(carbon, hydroxyl, 0); b.charge(carbonyl, +1); b.charge(hydroxyl, -1)
    # 6. Deprotonate to give the ester and regenerate the acid catalyst.
    h4 = next(n.GetIdx() for n in b.atom(carbonyl).GetNeighbors() if n.GetAtomicNum() == 1)
    b.panel('Deprotonation gives the ester and regenerates the acid catalyst', [((hydronium,), (hydronium, h4)), ((carbonyl, h4), (carbonyl,))])
    b.bond(hydronium, h4, 1); b.bond(carbonyl, h4, 0); b.charge(hydronium, +1); b.charge(carbonyl, -1)
    b.panel('Products: ester and water; H₃O⁺ is regenerated')
    return b.block()


BUILDERS = {'sn2': sn2, 'sn1': sn1, 'e2': e2, 'fischer_esterification': fischer_esterification}
ALIASES = {'esterification': 'fischer_esterification', 'fischer esterification': 'fischer_esterification',
           'acid-catalysed esterification': 'fischer_esterification', 'acid-catalyzed esterification': 'fischer_esterification'}


def key(name):
    text = re.sub(r'[\s_-]+', ' ', (name or '').strip().lower())
    return ALIASES.get(text) or text.replace(' ', '')


def build(name, reactants):
    builder = BUILDERS.get(key(name))
    if builder is None:
        raise ValueError(f'ChemEZ has no built-in mechanism called "{name}". Built-in: SN2, SN1, E2, Fischer esterification.')
    return builder(*reactants)


def _fragments(item, answer):
    """Reactant structures the answer mentions: the first mechanism panel, then reaction blocks."""
    texts = []
    steps = item.get('steps') if isinstance(item.get('steps'), list) else []
    # Reactants are often split across the first panels, so read every arrowless or first panel.
    for number, step in enumerate(steps):
        if isinstance(step, dict) and isinstance(step.get('smiles'), str) and (number == 0 or not step.get('arrows') and number < len(steps) - 1):
            texts += step['smiles'].split('.')
    for block in answer:
        if isinstance(block, dict) and block.get('type') == 'reaction':
            texts += [r.get('smiles', '') for r in block.get('reactants', []) if isinstance(r, dict)]
    found = []
    for text in texts:
        mol = Chem.MolFromSmiles(text) if text else None
        if mol is not None and mol.GetNumHeavyAtoms() and Chem.MolToSmiles(mol) not in [Chem.MolToSmiles(m) for m in found]:
            found.append(mol)
    return found


def _match(mols, pattern):
    query = Chem.MolFromSmarts(pattern)
    return next((m for m in mols if m.HasSubstructMatch(query)), None)


def recognise(item, answer):
    """Rebuild a mechanism the model named but could not draw: the mechanism type from the
    answer's own wording, the reactants from its structures. None when unsure."""
    words = ' '.join(str(b.get(k, '')) for b in answer if isinstance(b, dict) for k in ('caption', 'text')).lower()
    words += ' ' + ' '.join(str(s.get(k, '')) for s in (item.get('steps') or []) if isinstance(s, dict) for k in ('label', 'limitation')).lower()
    mols = _fragments(item, answer)
    counts = {name: len(re.findall(pattern, words)) for name, pattern in (('fischer_esterification', r'esterif'), ('sn2', r'\bs\W?n\W?2\b'), ('sn1', r'\bs\W?n\W?1\b'), ('e2', r'\be2\b'))}
    ranked = sorted(counts, key=counts.get, reverse=True)
    name = ranked[0] if counts[ranked[0]] and counts[ranked[0]] > counts[ranked[1]] else None
    # Reagents named only in words ("in water", "with hydroxide").
    for word, smiles_text in (('hydroxide', '[OH-]'), ('ethoxide', '[O-]CC'), ('methoxide', '[O-]C'), ('water', 'O'), ('cyanide', '[C-]#N')):
        if re.search(word, words) and not any(Chem.MolToSmiles(m) == Chem.MolToSmiles(Chem.MolFromSmiles(smiles_text)) for m in mols):
            mols.append(Chem.MolFromSmiles(smiles_text))
    if name is None:
        # No single named pathway: decide from the structures, as a textbook would.
        if _match(mols, '[CX3](=O)[OX2H1]') and _match(mols, '[CX4][OX2H1]'):
            name = 'fischer_esterification'
        elif (halide := _match(mols, '[CX4][Cl,Br,I]')) is not None:
            tertiary = halide.HasSubstructMatch(Chem.MolFromSmarts('[CX4;H0]([#6])([#6])([#6])[Cl,Br,I]'))
            name = 'sn1' if tertiary else 'sn2'
        else:
            return None
    smiles = lambda mol: Chem.MolToSmiles(mol)
    if name == 'fischer_esterification':
        acid, alcohol = _match(mols, '[CX3](=O)[OX2H1]'), _match(mols, '[CX4][OX2H1]')
        reactants = [acid, alcohol]
    else:
        substrate = _match(mols, '[CX4][Cl,Br,I]')
        partner = next((m for m in mols if m is not substrate and (any(a.GetFormalCharge() < 0 for a in m.GetAtoms()) or name == 'sn1' and m.HasSubstructMatch(Chem.MolFromSmarts('[N,O,S;!$(*=*)]')))), None)
        if name == 'sn2' and partner is None:
            return None
        reactants = [substrate, partner]
    if any(r is None for r in reactants):
        return None
    try:
        return build(name, [smiles(r) for r in reactants])
    except (ValueError, StopIteration):
        return None
