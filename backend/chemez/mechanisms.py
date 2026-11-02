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

    def radical(self, index, delta):
        atom = self.atom(index); atom.SetNumRadicalElectrons(atom.GetNumRadicalElectrons() + delta)

    def charge(self, index, delta):
        self.atom(index).SetFormalCharge(self.atom(index).GetFormalCharge() + delta)

    def panel(self, label, arrows=()):
        mol = self.mol.GetMol()
        mol.UpdatePropertyCache(strict=False)
        smiles = Chem.MolToSmiles(mol, canonical=False, allHsExplicit=False)
        order = [int(i) for i in mol.GetProp('_smilesAtomOutputOrder').strip('[],').split(',') if i]
        where = {atom: position for position, atom in enumerate(order)}
        # An arrow is (tail, head) for an electron pair, or (tail, head, 1) for a single-electron fishhook.
        self.steps.append({'smiles': smiles, 'label': label, 'arrows': [
            {'tail': [where[i] for i in arrow[0]], 'head': [where[i] for i in arrow[1]], 'electrons': arrow[2] if len(arrow) > 2 else 2} for arrow in arrows]})

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
    b.panel('Concerted backside attack: C–Nu bond formation with simultaneous C–X heterolysis', [((donor,), (donor, carbon)), ((carbon, halogen), (halogen,))])
    b.bond(donor, carbon, 1); b.bond(carbon, halogen, 0); b.charge(donor, +1); b.charge(halogen, -1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        # A neutral nucleophile (water, ammonia) is deprotonated by the halide.
        h = b.hydrogen(donor)
        b.panel('Protonated substitution product (Walden inversion at carbon)', [((halogen,), (halogen, h)), ((donor, h), (donor,))])
        b.bond(halogen, h, 1); b.bond(donor, h, 0); b.charge(halogen, +1); b.charge(donor, -1)
    b.panel('Products: substitution with inversion of configuration')
    return b.block()


def sn1(substrate, nucleophile):
    (s0, s1), (n0, n1) = _split([substrate, nucleophile], 2)
    b = Builder(substrate, nucleophile)
    carbon, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    b.panel('Ionisation (rate-determining): heterolysis of the C–X bond', [((carbon, halogen), (halogen,))])
    b.bond(carbon, halogen, 0); b.charge(carbon, +1); b.charge(halogen, -1)
    b.panel('Nucleophilic capture: attack at either face of the planar carbocation', [((donor,), (donor, carbon))])
    b.bond(donor, carbon, 1); b.charge(carbon, -1); b.charge(donor, +1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        h = b.hydrogen(donor)
        b.panel('Deprotonation of the oxonium ion', [((halogen,), (halogen, h)), ((donor, h), (donor,))])
        b.bond(halogen, h, 1); b.bond(donor, h, 0); b.charge(halogen, +1); b.charge(donor, -1)
    b.panel('Products: substitution with racemisation at the stereocentre')
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
    b.panel('Concerted anti-periplanar elimination: β-deprotonation, C=C formation and C–X heterolysis',
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
    b.panel('Activation: protonation of the carbonyl oxygen', [((carbonyl,), (carbonyl, h1)), ((hydronium, h1), (hydronium,))])
    b.bond(carbonyl, h1, 1); b.bond(hydronium, h1, 0); b.charge(carbonyl, +1); b.charge(hydronium, -1)
    # 2. The alcohol adds to the activated carbonyl carbon.
    b.panel('Nucleophilic addition: the alcohol oxygen adds to the carbonyl carbon', [((oxygen,), (oxygen, carbon)), ((carbon, carbonyl), (carbonyl,))])
    b.bond(oxygen, carbon, 1); b.bond(carbon, carbonyl, 1); b.charge(oxygen, +1); b.charge(carbonyl, -1)
    # 3. Deprotonate the added oxygen (water as base).
    h2 = b.hydrogen(oxygen)
    b.panel('Proton transfer: deprotonation of the oxonium ion', [((water,), (water, h2)), ((oxygen, h2), (oxygen,))])
    b.bond(water, h2, 1); b.bond(oxygen, h2, 0); b.charge(water, +1); b.charge(oxygen, -1)
    # 4. Protonate an OH to make water the leaving group.
    h3 = b.hydrogen(water)
    b.panel('Proton transfer: protonation of a hydroxyl group (water as leaving group)', [((hydroxyl,), (hydroxyl, h3)), ((water, h3), (water,))])
    b.bond(hydroxyl, h3, 1); b.bond(water, h3, 0); b.charge(hydroxyl, +1); b.charge(water, -1)
    # 5. Water leaves as the C=O+ re-forms.
    b.panel('Elimination: loss of water with re-formation of C=O', [((carbonyl,), (carbonyl, carbon)), ((carbon, hydroxyl), (hydroxyl,))])
    b.bond(carbon, carbonyl, 2); b.bond(carbon, hydroxyl, 0); b.charge(carbonyl, +1); b.charge(hydroxyl, -1)
    # 6. Deprotonate to give the ester and regenerate the acid catalyst.
    h4 = next(n.GetIdx() for n in b.atom(carbonyl).GetNeighbors() if n.GetAtomicNum() == 1)
    b.panel('Deprotonation: formation of the ester; regeneration of the catalyst', [((hydronium,), (hydronium, h4)), ((carbonyl, h4), (carbonyl,))])
    b.bond(hydronium, h4, 1); b.bond(carbonyl, h4, 0); b.charge(hydronium, +1); b.charge(carbonyl, -1)
    b.panel('Products: ester and water; H₃O⁺ regenerated')
    return b.block()


# ---- More mechanism families -------------------------------------------------------------
# Each builder finds its reacting atoms by substructure, edits the molecule one elementary step
# at a time and records a panel per step; prepare_answer then checks every arrow like any other.

def _kekule(b):
    """Aromatic rings as alternating single and double bonds, so bonds can be edited one at a time."""
    mol = b.mol.GetMol(); Chem.Kekulize(mol, clearAromaticFlags=True); b.mol = Chem.RWMol(mol)


def _find(b, smarts, start=0, end=None):
    """The first SMARTS match whose atoms all lie in start..end-1."""
    end = b.mol.GetNumAtoms() if end is None else end
    for match in b.mol.GetSubstructMatches(Chem.MolFromSmarts(smarts)):
        if all(start <= i < end for i in match):
            return match
    raise ValueError(f'No {smarts} group in the reactants.')


def _hcount(b, index):
    return b.atom(index).GetNumExplicitHs() + sum(1 for n in b.atom(index).GetNeighbors() if n.GetAtomicNum() == 1)


def _markovnikov(b, c1, c2):
    """(carbon that gains H, carbon that becomes the cation): H goes to the carbon with more H."""
    return (c1, c2) if _hcount(b, c1) >= _hcount(b, c2) else (c2, c1)


def e1(substrate, base='O'):
    (s0, s1), (n0, n1) = _split([substrate, base], 2)
    b = Builder(substrate, base)
    alpha, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    b.panel('Ionisation (rate-determining): heterolysis of the C–X bond to a carbocation', [((alpha, halogen), (halogen,))])
    b.bond(alpha, halogen, 0); b.charge(alpha, +1); b.charge(halogen, -1)
    betas = [n.GetIdx() for n in b.atom(alpha).GetNeighbors() if n.GetSymbol() == 'C' and n.GetNumExplicitHs()]
    if not betas:
        raise ValueError('E1 needs a hydrogen on a carbon next to the carbocation.')
    beta = min(betas, key=lambda i: (b.atom(i).GetNumExplicitHs(), i))
    h = b.hydrogen(beta)
    b.panel('β-Deprotonation: the C–H bonding pair forms the C=C π bond', [((donor,), (donor, h)), ((beta, h), (beta, alpha))])
    b.bond(donor, h, 1); b.bond(beta, h, 0); b.bond(beta, alpha, 2); b.charge(alpha, -1); b.charge(donor, +1)
    b.panel('Products: the more substituted (Zaitsev) alkene')
    return b.block()


def hx_addition(alkene, acid):
    (a0, a1), (x0, x1) = _split([alkene, acid], 2)
    b = Builder(alkene, acid)
    c1, c2 = _find(b, 'C=C', a0, a1)
    x = next(i for i in range(x0, x1) if b.atom(i).GetSymbol() in HALOGENS)
    h = b.hydrogen(x)
    gain, cation = _markovnikov(b, c1, c2)
    b.panel('Electrophilic protonation: Markovnikov addition of H⁺ to the more stable carbocation', [((c1, c2), (gain, h)), ((h, x), (x,))])
    b.bond(c1, c2, 1); b.bond(gain, h, 1); b.bond(h, x, 0); b.charge(cation, +1); b.charge(x, -1)
    b.panel('Nucleophilic capture: halide addition to the carbocation', [((x,), (x, cation))])
    b.bond(x, cation, 1); b.charge(x, +1); b.charge(cation, -1)
    b.panel('Product: the Markovnikov alkyl halide')
    return b.block()


def halogen_addition(alkene, halogen='BrBr'):
    (a0, a1), (x0, x1) = _split([alkene, halogen], 2)
    b = Builder(alkene, halogen)
    ca, cb = _find(b, 'C=C', a0, a1)
    x1i, x2i = x0, x0 + 1
    b.panel('Electrophilic addition: formation of the cyclic halonium ion with X–X heterolysis',
            [((ca, cb), (cb, x1i)), ((x1i,), (x1i, ca)), ((x1i, x2i), (x2i,))])
    b.bond(ca, cb, 1); b.bond(cb, x1i, 1); b.bond(x1i, ca, 1); b.bond(x1i, x2i, 0); b.charge(x1i, +1); b.charge(x2i, -1)
    b.panel('Ring opening: backside attack of halide on the halonium ion (anti addition)', [((x2i,), (x2i, ca)), ((ca, x1i), (x1i,))])
    b.bond(x2i, ca, 1); b.bond(ca, x1i, 0); b.charge(x2i, +1); b.charge(x1i, -1)
    b.panel('Product: the anti vicinal dihalide')
    return b.block()


def acid_hydration(alkene):
    b = Builder(alkene, '[OH3+]', 'O', 'O')
    n = Chem.MolFromSmiles(alkene).GetNumAtoms()
    c1, c2 = _find(b, 'C=C', 0, n)
    hydronium, water, base = n, n + 1, n + 2
    h = b.hydrogen(hydronium)
    gain, cation = _markovnikov(b, c1, c2)
    b.panel('Electrophilic protonation: formation of the more stable carbocation', [((c1, c2), (gain, h)), ((hydronium, h), (hydronium,))])
    b.bond(c1, c2, 1); b.bond(gain, h, 1); b.bond(hydronium, h, 0); b.charge(cation, +1); b.charge(hydronium, -1)
    b.panel('Nucleophilic capture: addition of water to the carbocation', [((water,), (water, cation))])
    b.bond(water, cation, 1); b.charge(water, +1); b.charge(cation, -1)
    h2 = b.hydrogen(water)
    b.panel('Proton transfer: deprotonation of the oxonium ion', [((base,), (base, h2)), ((water, h2), (water,))])
    b.bond(base, h2, 1); b.bond(water, h2, 0); b.charge(base, +1); b.charge(water, -1)
    b.panel('Products: the Markovnikov alcohol; H₃O⁺ regenerated')
    return b.block()


def nucleophilic_addition(carbonyl, nucleophile):
    (c0, c1), (n0, n1) = _split([carbonyl, nucleophile], 2)
    b = Builder(carbonyl, nucleophile, 'O')
    carbon, oxygen = _find(b, '[CX3]=O', c0, c1)
    donor = _donor(b, n0, n1)
    water = n1
    b.panel('Nucleophilic addition: attack at the carbonyl carbon; C=O π electrons to oxygen', [((donor,), (donor, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(donor, carbon, 1); b.bond(carbon, oxygen, 1); b.charge(donor, +1); b.charge(oxygen, -1)
    h = b.hydrogen(water)
    b.panel('Work-up: protonation of the alkoxide', [((oxygen,), (oxygen, h)), ((water, h), (water,))])
    b.bond(oxygen, h, 1); b.bond(water, h, 0); b.charge(oxygen, +1); b.charge(water, -1)
    b.panel('Product: the alcohol')
    return b.block()


def hydride_reduction(carbonyl, hydride='[BH4-]'):
    (c0, c1), (r0, r1) = _split([carbonyl, hydride], 2)
    b = Builder(carbonyl, hydride, 'O')
    carbon, oxygen = _find(b, '[CX3]=O', c0, c1)
    metal = next(i for i in range(r0, r1) if b.atom(i).GetSymbol() in ('B', 'Al'))
    water = r1
    h = b.hydrogen(metal)
    b.panel('Hydride transfer: delivery of H⁻ from the metal hydride to the carbonyl carbon', [((metal, h), (h, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(metal, h, 0); b.bond(h, carbon, 1); b.bond(carbon, oxygen, 1); b.charge(metal, +1); b.charge(oxygen, -1)
    h2 = b.hydrogen(water)
    b.panel('Work-up: protonation of the alkoxide', [((oxygen,), (oxygen, h2)), ((water, h2), (water,))])
    b.bond(oxygen, h2, 1); b.bond(water, h2, 0); b.charge(oxygen, +1); b.charge(water, -1)
    b.panel('Product: the alcohol')
    return b.block()


def acyl_substitution(acyl, nucleophile):
    (a0, a1), (n0, n1) = _split([acyl, nucleophile], 2)
    b = Builder(acyl, nucleophile)
    carbon, oxygen, leaving = _find(b, '[CX3](=O)[Cl,Br,I,$([OX2][CX3]=O)]', a0, a1)
    donor = _donor(b, n0, n1)
    b.panel('Addition: nucleophilic attack at the acyl carbon (tetrahedral intermediate)', [((donor,), (donor, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(donor, carbon, 1); b.bond(carbon, oxygen, 1); b.charge(donor, +1); b.charge(oxygen, -1)
    b.panel('Elimination: collapse of the tetrahedral intermediate; loss of the leaving group', [((oxygen,), (oxygen, carbon)), ((carbon, leaving), (leaving,))])
    b.bond(oxygen, carbon, 2); b.bond(carbon, leaving, 0); b.charge(oxygen, +1); b.charge(leaving, -1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        h = b.hydrogen(donor)
        b.panel('Proton transfer: deprotonation of the added nucleophile', [((leaving,), (leaving, h)), ((donor, h), (donor,))])
        b.bond(leaving, h, 1); b.bond(donor, h, 0); b.charge(leaving, +1); b.charge(donor, -1)
    b.panel('Products: the acyl substitution product and the leaving group')
    return b.block()


def saponification(ester, base='[OH-]'):
    (e0, e1), (n0, n1) = _split([ester, base], 2)
    b = Builder(ester, base)
    carbon, oxygen, alkoxy, _ = _find(b, '[CX3](=O)[OX2][#6]', e0, e1)
    hydroxide = _donor(b, n0, n1)
    b.panel('Addition: hydroxide attack at the ester carbonyl', [((hydroxide,), (hydroxide, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(hydroxide, carbon, 1); b.bond(carbon, oxygen, 1); b.charge(hydroxide, +1); b.charge(oxygen, -1)
    b.panel('Elimination: collapse of the tetrahedral intermediate; loss of alkoxide', [((oxygen,), (oxygen, carbon)), ((carbon, alkoxy), (alkoxy,))])
    b.bond(oxygen, carbon, 2); b.bond(carbon, alkoxy, 0); b.charge(oxygen, +1); b.charge(alkoxy, -1)
    h = b.hydrogen(hydroxide)
    b.panel('Proton transfer: irreversible deprotonation to the carboxylate', [((alkoxy,), (alkoxy, h)), ((hydroxide, h), (hydroxide,))])
    b.bond(alkoxy, h, 1); b.bond(hydroxide, h, 0); b.charge(alkoxy, +1); b.charge(hydroxide, -1)
    b.panel('Products: carboxylate and alcohol')
    return b.block()


def electrophilic_aromatic_substitution(arene, electrophile, base='O'):
    (a0, a1), (e0, e1), (_, _) = _split([arene, electrophile, base], 3)
    b = Builder(arene, electrophile, base); _kekule(b)
    base_atom = e1
    centre = next(i for i in range(e0, e1) if b.atom(i).GetFormalCharge() > 0)
    # Nitronium: N+ takes the ring's electrons while one N=O π pair moves onto oxygen.
    oxo = next((n.GetIdx() for n in b.atom(centre).GetNeighbors() if n.GetSymbol() == 'O' and b.order(centre, n.GetIdx()) == 2), None)
    ipso, partner = next((a, n.GetIdx()) for a in range(a0, a1) if b.atom(a).GetSymbol() == 'C' and b.atom(a).GetNumExplicitHs()
                         for n in b.atom(a).GetNeighbors() if b.order(a, n.GetIdx()) == 2)
    arrows = [((ipso, partner), (ipso, centre))]
    if oxo is not None:
        arrows.append(((centre, oxo), (oxo,)))
    b.panel('Electrophilic attack: formation of the arenium ion (σ-complex)', arrows)
    b.bond(ipso, partner, 1); b.bond(ipso, centre, 1); b.charge(partner, +1)
    if oxo is not None:
        b.bond(centre, oxo, 1); b.charge(oxo, -1)
    else:
        b.charge(centre, -1)
    h = b.hydrogen(ipso)
    b.panel('Deprotonation: restoration of aromaticity', [((base_atom,), (base_atom, h)), ((ipso, h), (ipso, partner))])
    b.bond(base_atom, h, 1); b.bond(ipso, h, 0); b.bond(ipso, partner, 2); b.charge(base_atom, +1); b.charge(partner, -1)
    b.panel('Products: the substituted arene')
    return b.block()


def snar(aryl_halide, nucleophile):
    (a0, a1), (n0, n1) = _split([aryl_halide, nucleophile], 2)
    b = Builder(aryl_halide, nucleophile); _kekule(b)
    ipso, halogen = next((n.GetIdx(), i) for i in range(a0, a1) if b.atom(i).GetSymbol() in ('F', 'Cl', 'Br', 'I')
                         for n in b.atom(i).GetNeighbors() if n.GetIsAromatic() or b.atom(n.GetIdx()).IsInRing())
    partner = next(n.GetIdx() for n in b.atom(ipso).GetNeighbors() if b.order(ipso, n.GetIdx()) == 2)
    donor = _donor(b, n0, n1)
    b.panel('Addition: nucleophilic attack at the ipso carbon', [((donor,), (donor, ipso)), ((ipso, partner), (partner,))])
    b.bond(donor, ipso, 1); b.bond(ipso, partner, 1); b.charge(donor, +1); b.charge(partner, -1)
    b.panel('Elimination: loss of halide from the Meisenheimer complex', [((partner,), (partner, ipso)), ((ipso, halogen), (halogen,))])
    b.bond(partner, ipso, 2); b.bond(ipso, halogen, 0); b.charge(partner, +1); b.charge(halogen, -1)
    b.panel('Products: the substituted arene and the halide')
    return b.block()


def diels_alder(diene, dienophile):
    (d0, d1), (p0, p1) = _split([diene, dienophile], 2)
    b = Builder(diene, dienophile)
    c1, c2, c3, c4 = _find(b, 'C=CC=C', d0, d1)
    e1_, e2_ = _find(b, 'C=C', p0, p1)
    b.panel('Concerted [4+2] cycloaddition: suprafacial reorganisation of three π bonds',
            [((e1_, e2_), (e2_, c1)), ((c1, c2), (c2, c3)), ((c3, c4), (c4, e1_))])
    b.bond(e1_, e2_, 1); b.bond(e2_, c1, 1); b.bond(c1, c2, 1); b.bond(c2, c3, 2); b.bond(c3, c4, 1); b.bond(c4, e1_, 1)
    b.panel('Product: the cyclohexene adduct')
    return b.block()


def aldol(carbonyl, partner=None, base='[OH-]'):
    partner = partner or carbonyl
    (c0, c1), (p0, p1), (b0, b1) = _split([carbonyl, partner, base], 3)
    b = Builder(carbonyl, partner, base, 'O')
    alpha = _find(b, '[CX4;!H0][CX3]=O', c0, c1)[0]
    carbon, oxygen = _find(b, '[CX3]=O', p0, p1)
    hydroxide, water = _donor(b, b0, b1), b1
    h = b.hydrogen(alpha)
    b.panel('Enolate formation: α-deprotonation by hydroxide (carbanion form shown)', [((hydroxide,), (hydroxide, h)), ((alpha, h), (alpha,))])
    b.bond(hydroxide, h, 1); b.bond(alpha, h, 0); b.charge(hydroxide, +1); b.charge(alpha, -1)
    b.panel('Nucleophilic addition: the enolate carbon adds to the second carbonyl', [((alpha,), (alpha, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(alpha, carbon, 1); b.bond(carbon, oxygen, 1); b.charge(alpha, +1); b.charge(oxygen, -1)
    h2 = b.hydrogen(water)
    b.panel('Work-up: protonation of the alkoxide by water regenerates hydroxide', [((oxygen,), (oxygen, h2)), ((water, h2), (water,))])
    b.bond(oxygen, h2, 1); b.bond(water, h2, 0); b.charge(oxygen, +1); b.charge(water, -1)
    b.panel('Product: the β-hydroxy carbonyl (aldol)')
    return b.block()


# ---- Conjugate additions, eliminations via carbanions, rearrangements, radicals, organometallics ----

def e1cb(substrate, base='[OH-]'):
    (s0, s1), (n0, n1) = _split([substrate, base], 2)
    b = Builder(substrate, base)
    match = _find(b, '[OX2H1][CX4][CX4;!H0][CX3]=O', s0, s1)
    hydroxyl, beta, alpha = match[0], match[1], match[2]
    donor = _donor(b, n0, n1)
    h = b.hydrogen(alpha)
    b.panel('Enolate formation: deprotonation at the acidic α-carbon', [((donor,), (donor, h)), ((alpha, h), (alpha,))])
    b.bond(donor, h, 1); b.bond(alpha, h, 0); b.charge(donor, +1); b.charge(alpha, -1)
    b.panel('Elimination: expulsion of hydroxide from the β-carbon (rate-determining)', [((alpha,), (alpha, beta)), ((beta, hydroxyl), (hydroxyl,))])
    b.bond(alpha, beta, 2); b.bond(beta, hydroxyl, 0); b.charge(alpha, +1); b.charge(hydroxyl, -1)
    b.panel('Products: the α,β-unsaturated carbonyl')
    return b.block()


def michael(donor_carbonyl, acceptor, base='[OH-]'):
    (d0, d1), (a0, a1), (b0, b1) = _split([donor_carbonyl, acceptor, base], 3)
    b = Builder(donor_carbonyl, acceptor, base, 'O')
    alpha = _find(b, '[CX4;!H0][CX3]=O', d0, d1)[0]
    beta, alpha2, carbon, oxygen = _find(b, '[CX3]=[CX3][CX3]=O', a0, a1)
    hydroxide, water = _donor(b, b0, b1), b1
    h = b.hydrogen(alpha)
    b.panel('Enolate formation: α-deprotonation of the donor (carbanion form shown)', [((hydroxide,), (hydroxide, h)), ((alpha, h), (alpha,))])
    b.bond(hydroxide, h, 1); b.bond(alpha, h, 0); b.charge(hydroxide, +1); b.charge(alpha, -1)
    b.panel('Conjugate (1,4-) addition: attack at the β-carbon of the acceptor',
            [((alpha,), (alpha, beta)), ((beta, alpha2), (alpha2, carbon)), ((carbon, oxygen), (oxygen,))])
    b.bond(alpha, beta, 1); b.bond(beta, alpha2, 1); b.bond(alpha2, carbon, 2); b.bond(carbon, oxygen, 1); b.charge(alpha, +1); b.charge(oxygen, -1)
    h2 = b.hydrogen(water)
    b.panel('Proton transfer: C-protonation of the enolate with re-formation of C=O', [((oxygen,), (oxygen, carbon)), ((carbon, alpha2), (alpha2, h2)), ((water, h2), (water,))])
    b.bond(oxygen, carbon, 2); b.bond(carbon, alpha2, 1); b.bond(alpha2, h2, 1); b.bond(water, h2, 0); b.charge(oxygen, +1); b.charge(water, -1)
    b.panel('Product: the 1,5-dicarbonyl (Michael adduct); hydroxide regenerated')
    return b.block()


def carbocation_rearrangement(substrate, nucleophile='O'):
    """SN1 with a 1,2-hydride or 1,2-methyl shift to the more stable carbocation."""
    (s0, s1), (n0, n1) = _split([substrate, nucleophile], 2)
    b = Builder(substrate, nucleophile)
    cation, halogen = _leaving_group(b, s0, s1)
    donor = _donor(b, n0, n1)
    b.panel('Ionisation: heterolysis of the C–X bond to a carbocation', [((cation, halogen), (halogen,))])
    b.bond(cation, halogen, 0); b.charge(cation, +1); b.charge(halogen, -1)
    degree = lambda i: sum(1 for n in b.atom(i).GetNeighbors() if n.GetSymbol() == 'C')
    neighbours = [n.GetIdx() for n in b.atom(cation).GetNeighbors() if n.GetSymbol() == 'C' and degree(n.GetIdx()) > degree(cation) - 0]
    target = max(neighbours, key=degree, default=None)
    if target is None or degree(target) <= degree(cation):
        raise ValueError('No neighbouring carbon gives a more stable carbocation.')
    if b.atom(target).GetNumExplicitHs():
        mover = b.hydrogen(target); kind = '1,2-hydride shift'
    else:
        mover = next(n.GetIdx() for n in b.atom(target).GetNeighbors() if n.GetSymbol() == 'C' and n.GetIdx() != cation and degree(n.GetIdx()) == 1); kind = '1,2-methyl shift'
    b.panel(f'{kind[0].upper()}{kind[1:]}: migration to the cationic centre, giving the more stable carbocation', [((target, mover), (mover, cation))])
    b.bond(target, mover, 0); b.bond(mover, cation, 1); b.charge(cation, -1); b.charge(target, +1)
    b.panel('Nucleophilic capture of the rearranged carbocation', [((donor,), (donor, target))])
    b.bond(donor, target, 1); b.charge(target, -1); b.charge(donor, +1)
    if b.atom(donor).GetFormalCharge() > 0 and b.atom(donor).GetNumExplicitHs():
        h = b.hydrogen(donor)
        b.panel('Proton transfer: deprotonation by halide', [((halogen,), (halogen, h)), ((donor, h), (donor,))])
        b.bond(halogen, h, 1); b.bond(donor, h, 0); b.charge(halogen, +1); b.charge(donor, -1)
    b.panel('Products: substitution on the rearranged skeleton')
    return b.block()


def pinacol(diol):
    b = Builder(diol, '[OH3+]', 'O')
    n = Chem.MolFromSmiles(diol).GetNumAtoms()
    o1, c1, c2, o2 = _find(b, '[OX2H1][CX4][CX4][OX2H1]', 0, n)
    hydronium, water = n, n + 1
    h = b.hydrogen(hydronium)
    b.panel('Activation: protonation of a hydroxyl group', [((o1,), (o1, h)), ((hydronium, h), (hydronium,))])
    b.bond(o1, h, 1); b.bond(hydronium, h, 0); b.charge(o1, +1); b.charge(hydronium, -1)
    b.panel('Ionisation: loss of water to the carbocation', [((c1, o1), (o1,))])
    b.bond(c1, o1, 0); b.charge(c1, +1); b.charge(o1, -1)
    mover = next(nb.GetIdx() for nb in b.atom(c2).GetNeighbors() if nb.GetSymbol() == 'C' and nb.GetIdx() != c1)
    b.panel('1,2-Alkyl shift: migration to the cationic centre; oxocarbenium stabilisation',
            [((c2, mover), (mover, c1)), ((o2,), (o2, c2))])
    b.bond(c2, mover, 0); b.bond(mover, c1, 1); b.bond(o2, c2, 2); b.charge(c1, -1); b.charge(o2, +1)
    h2 = b.hydrogen(o2)
    b.panel('Deprotonation of the oxocarbenium ion', [((water,), (water, h2)), ((o2, h2), (o2,))])
    b.bond(water, h2, 1); b.bond(o2, h2, 0); b.charge(water, +1); b.charge(o2, -1)
    b.panel('Products: pinacolone; H₃O⁺ regenerated')
    return b.block()


def beckmann(oxime):
    b = Builder(oxime, '[OH3+]', 'O', 'O')
    n = Chem.MolFromSmiles(oxime).GetNumAtoms()
    carbon, nitrogen, oxygen = _find(b, '[CX3]=[NX2][OX2H1]', 0, n)
    hydronium, water, base = n, n + 1, n + 2
    h = b.hydrogen(hydronium)
    b.panel('Activation: protonation of the oxime hydroxyl', [((oxygen,), (oxygen, h)), ((hydronium, h), (hydronium,))])
    b.bond(oxygen, h, 1); b.bond(hydronium, h, 0); b.charge(oxygen, +1); b.charge(hydronium, -1)
    mover = next(nb.GetIdx() for nb in b.atom(carbon).GetNeighbors() if nb.GetIdx() != nitrogen and nb.GetSymbol() == 'C')
    b.panel('Rearrangement: antiperiplanar migration to nitrogen with loss of water',
            [((carbon, mover), (mover, nitrogen)), ((nitrogen, oxygen), (oxygen,))])
    b.bond(carbon, mover, 0); b.bond(mover, nitrogen, 1); b.bond(nitrogen, oxygen, 0); b.charge(carbon, +1); b.charge(oxygen, -1)
    b.panel('Nitrilium ion formation (C≡N⁺)', [((nitrogen,), (nitrogen, carbon))])
    b.bond(nitrogen, carbon, 3); b.charge(carbon, -1); b.charge(nitrogen, +1)
    b.panel('Nucleophilic addition: water adds to the nitrilium carbon', [((water,), (water, carbon)), ((carbon, nitrogen), (nitrogen,))])
    b.bond(water, carbon, 1); b.bond(carbon, nitrogen, 2); b.charge(water, +1); b.charge(nitrogen, -1)
    h2 = b.hydrogen(water)
    b.panel('Proton transfer: deprotonation of the oxonium ion', [((base,), (base, h2)), ((water, h2), (water,))])
    b.bond(base, h2, 1); b.bond(water, h2, 0); b.charge(base, +1); b.charge(water, -1)
    h3 = b.hydrogen(base)
    b.panel('Tautomerisation: imidic acid to amide', [((nitrogen, carbon), (nitrogen, h3)), ((water,), (water, carbon)), ((base, h3), (base,))])
    b.bond(nitrogen, carbon, 1); b.bond(nitrogen, h3, 1); b.bond(water, carbon, 2); b.bond(base, h3, 0); b.charge(water, +1); b.charge(base, -1)
    h4 = b.hydrogen(water)
    b.panel('Deprotonation: formation of the amide', [((hydronium,), (hydronium, h4)), ((water, h4), (water,))])
    b.bond(hydronium, h4, 1); b.bond(water, h4, 0); b.charge(hydronium, +1); b.charge(water, -1)
    b.panel('Products: the amide (lactam from a cyclic oxime); H₃O⁺ regenerated')
    return b.block()


def radical_halogenation(alkane, halogen='ClCl'):
    b = Builder(alkane, halogen, halogen)
    n = Chem.MolFromSmiles(alkane).GetNumAtoms()
    x1, x2, x3, x4 = n, n + 1, n + 2, n + 3
    b.panel('Initiation: homolysis of X–X (hν or Δ)', [((x1, x2), (x1,), 1), ((x1, x2), (x2,), 1)])
    b.bond(x1, x2, 0); b.radical(x1, 1); b.radical(x2, 1)
    carbon = max((i for i in range(n) if b.atom(i).GetSymbol() == 'C' and b.atom(i).GetNumExplicitHs()),
                 key=lambda i: (sum(1 for nb in b.atom(i).GetNeighbors() if nb.GetSymbol() == 'C'), -i))
    h = b.hydrogen(carbon)
    b.panel('Propagation 1: hydrogen abstraction by the halogen radical',
            [((x1,), (x1, h), 1), ((carbon, h), (x1, h), 1), ((carbon, h), (carbon,), 1)])
    b.bond(carbon, h, 0); b.bond(x1, h, 1); b.radical(x1, -1); b.radical(carbon, 1)
    b.panel('Propagation 2: halogen abstraction from X₂; chain carrier regenerated',
            [((carbon,), (carbon, x3), 1), ((x3, x4), (carbon, x3), 1), ((x3, x4), (x4,), 1)])
    b.bond(x3, x4, 0); b.bond(carbon, x3, 1); b.radical(carbon, -1); b.radical(x4, 1)
    b.panel('Termination: radical recombination', [((x2,), (x2, x4), 1), ((x4,), (x2, x4), 1)])
    b.bond(x2, x4, 1); b.radical(x2, -1); b.radical(x4, -1)
    b.panel('Products: the alkyl halide and HX')
    return b.block()


def suzuki(aryl_halide, boronate='OB(O)(O)c1ccccc1'):
    """Pd(0) catalytic cycle: oxidative addition, transmetalation, reductive elimination (ligands omitted)."""
    (a0, a1), (r0, r1) = _split([aryl_halide, boronate], 2)
    b = Builder(aryl_halide, boronate, '[Pd]'); _kekule(b)
    pd = r1
    carbon, halogen = next((nb.GetIdx(), i) for i in range(a0, a1) if b.atom(i).GetSymbol() in ('Cl', 'Br', 'I') for nb in b.atom(i).GetNeighbors())
    boron = next(i for i in range(r0, r1) if b.atom(i).GetSymbol() == 'B')
    if b.atom(boron).GetFormalCharge() >= 0:
        raise ValueError('Give the activated boronate, e.g. OB(O)(O)c1ccccc1 as [B-].')
    aryl2 = next(nb.GetIdx() for nb in b.atom(boron).GetNeighbors() if nb.GetSymbol() == 'C')
    b.panel('Oxidative addition: Pd(0) insertion into the C–X bond (Pd(II))', [((pd,), (pd, carbon)), ((carbon, halogen), (halogen, pd))])
    b.bond(pd, carbon, 1); b.bond(carbon, halogen, 0); b.bond(halogen, pd, 1)
    b.panel('Transmetalation: aryl transfer from boronate to palladium',
            [((boron, aryl2), (aryl2, pd)), ((pd, halogen), (halogen, boron))])
    b.bond(boron, aryl2, 0); b.bond(aryl2, pd, 1); b.bond(pd, halogen, 0); b.bond(halogen, boron, 1)
    b.panel('Reductive elimination: C–C bond formation; Pd(0) regenerated', [((pd, carbon), (carbon, aryl2)), ((pd, aryl2), (pd,))])
    b.bond(pd, carbon, 0); b.bond(carbon, aryl2, 1); b.bond(pd, aryl2, 0)
    b.panel('Products: the biaryl, borate and Pd(0) (ligands omitted)')
    return b.block()


def acid_base(acid, base):
    """Proton transfer (neutralisation): the base's lone pair takes the acidic proton."""
    (a0, a1), (b0, b1) = _split([acid, base], 2)
    b = Builder(acid, base)
    donor = _donor(b, b0, b1)
    proton = next((i for i in range(a0, a1) if b.atom(i).GetAtomicNum() == 1 and b.atom(i).GetFormalCharge() == 1 and not b.atom(i).GetDegree()), None)
    if proton is not None:
        b.panel('Proton transfer: lone-pair donation from the base to H⁺', [((donor,), (donor, proton))])
        b.bond(donor, proton, 1); b.charge(proton, -1); b.charge(donor, +1)
    else:
        holder = next((i for i in range(a0, a1) if b.atom(i).GetSymbol() in ('F', 'Cl', 'Br', 'I', 'O', 'N', 'S') and b.atom(i).GetNumExplicitHs()), None)
        if holder is None:
            raise ValueError('The acid needs an H on O, N, S or a halogen, or give H+ directly.')
        h = b.hydrogen(holder)
        b.panel('Proton transfer: base attack at H with H–A heterolysis',
                [((donor,), (donor, h)), ((holder, h), (holder,))])
        b.bond(donor, h, 1); b.bond(holder, h, 0); b.charge(donor, +1); b.charge(holder, -1)
    b.panel('Products: the conjugate acid and conjugate base')
    return b.block()


BUILDERS = {'sn2': sn2, 'sn1': sn1, 'e2': e2, 'e1': e1, 'fischer_esterification': fischer_esterification,
            'hx_addition': hx_addition, 'halogen_addition': halogen_addition, 'acid_hydration': acid_hydration,
            'nucleophilic_addition': nucleophilic_addition, 'hydride_reduction': hydride_reduction,
            'acyl_substitution': acyl_substitution, 'saponification': saponification,
            'electrophilic_aromatic_substitution': electrophilic_aromatic_substitution, 'snar': snar,
            'diels_alder': diels_alder, 'aldol': aldol, 'e1cb': e1cb, 'michael': michael,
            'carbocation_rearrangement': carbocation_rearrangement, 'pinacol': pinacol, 'beckmann': beckmann,
            'radical_halogenation': radical_halogenation, 'suzuki': suzuki, 'acid_base': acid_base}
ALIASES = {'esterification': 'fischer_esterification', 'fischer esterification': 'fischer_esterification',
           'acid catalysed esterification': 'fischer_esterification', 'acid catalyzed esterification': 'fischer_esterification',
           'electrophilic addition': 'hx_addition', 'hydrohalogenation': 'hx_addition', 'markovnikov addition': 'hx_addition',
           'halogenation of alkene': 'halogen_addition', 'bromination of alkene': 'halogen_addition', 'bromine addition': 'halogen_addition',
           'hydration': 'acid_hydration', 'acid catalysed hydration': 'acid_hydration', 'acid catalyzed hydration': 'acid_hydration',
           'grignard': 'nucleophilic_addition', 'cyanohydrin': 'nucleophilic_addition', 'nucleophilic addition': 'nucleophilic_addition',
           'nabh4 reduction': 'hydride_reduction', 'lialh4 reduction': 'hydride_reduction', 'reduction': 'hydride_reduction',
           'nucleophilic acyl substitution': 'acyl_substitution', 'ester hydrolysis': 'saponification', 'base hydrolysis': 'saponification',
           'eas': 'electrophilic_aromatic_substitution', 'electrophilic aromatic substitution': 'electrophilic_aromatic_substitution',
           'nitration': 'electrophilic_aromatic_substitution', 'sn ar': 'snar', 'nucleophilic aromatic substitution': 'snar',
           'diels alder': 'diels_alder', 'aldol addition': 'aldol', 'aldol reaction': 'aldol',
           'e1 cb': 'e1cb', 'michael addition': 'michael', 'conjugate addition': 'michael',
           'hydride shift': 'carbocation_rearrangement', 'methyl shift': 'carbocation_rearrangement', 'wagner meerwein': 'carbocation_rearrangement',
           'pinacol rearrangement': 'pinacol', 'beckmann rearrangement': 'beckmann', 'free radical halogenation': 'radical_halogenation',
           'radical chlorination': 'radical_halogenation', 'radical bromination': 'radical_halogenation', 'suzuki coupling': 'suzuki', 'suzuki miyaura': 'suzuki',
           'neutralisation': 'acid_base', 'neutralization': 'acid_base', 'proton transfer': 'acid_base', 'acid base': 'acid_base', 'acid base reaction': 'acid_base'}


NAMES = ('SN1', 'SN2', 'E1', 'E2', 'Fischer esterification', 'HX addition', 'halogen addition', 'acid-catalysed hydration',
         'nucleophilic addition', 'hydride reduction', 'nucleophilic acyl substitution', 'saponification',
         'electrophilic aromatic substitution', 'SNAr', 'Diels–Alder', 'aldol', 'E1cB', 'Michael addition',
         'carbocation rearrangement', 'pinacol', 'Beckmann', 'radical halogenation', 'Suzuki coupling', 'acid-base')


def key(name):
    text = re.sub(r'[\s_-]+', ' ', (name or '').strip().lower())
    compact = {name.replace('_', ''): name for name in BUILDERS}
    return ALIASES.get(text) or compact.get(text.replace(' ', ''), text.replace(' ', ''))


LABELS = {'sn1': 'SN1', 'sn2': 'SN2', 'e1': 'E1', 'e2': 'E2', 'e1cb': 'E1cB', 'fischer_esterification': 'Fischer esterification',
          'hx_addition': 'Electrophilic addition', 'halogen_addition': 'Halogen addition', 'acid_hydration': 'Acid-catalysed hydration',
          'nucleophilic_addition': 'Nucleophilic addition', 'hydride_reduction': 'Hydride reduction', 'acyl_substitution': 'Nucleophilic acyl substitution',
          'saponification': 'Saponification', 'electrophilic_aromatic_substitution': 'Electrophilic aromatic substitution', 'snar': 'SNAr',
          'diels_alder': 'Diels–Alder', 'aldol': 'Aldol', 'michael': 'Michael addition', 'carbocation_rearrangement': 'Carbocation rearrangement',
          'pinacol': 'Pinacol rearrangement', 'beckmann': 'Beckmann rearrangement', 'radical_halogenation': 'Radical halogenation', 'suzuki': 'Suzuki coupling', 'acid_base': 'Acid–base (proton transfer)'}


def build(name, reactants):
    block = _build(name, reactants)
    block['family'] = LABELS.get(key(name), '')
    return block


def _build(name, reactants):
    builder = BUILDERS.get(key(name))
    if builder is None:
        raise ValueError(f'ChemEZ has no built-in mechanism called "{name}". Built-in: ' + ', '.join(NAMES) + '.')
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
        elif isinstance(block, dict) and block.get('type') == 'molecule' and isinstance(block.get('smiles'), str):
            texts += block['smiles'].split('.')
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
    counts = {name: len(re.findall(pattern, words)) for name, pattern in (
        ('fischer_esterification', r'esterif'), ('sn2', r'\bs\W?n\W?2\b'), ('sn1', r'\bs\W?n\W?1\b'), ('e2', r'\be2\b'), ('e1', r'\be1\b'),
        ('snar', r'\bs\W?n\W?ar\b|meisenheimer'), ('electrophilic_aromatic_substitution', r'electrophilic aromatic|arenium|sigma complex|σ-complex|nitration'),
        ('diels_alder', r'diels'), ('aldol', r'\baldol'), ('saponification', r'saponif|base hydrolysis'),
        ('hydride_reduction', r'nabh4|lialh4|hydride'), ('halogen_addition', r'bromonium|chloronium|halonium'),
        ('acid_hydration', r'hydration'), ('hx_addition', r'markovnikov|hydrohalogenation'),
        ('acyl_substitution', r'acyl substitution|tetrahedral intermediate'), ('nucleophilic_addition', r'cyanohydrin|grignard|nucleophilic addition'),
        ('e1cb', r'\be1\W?cb\b'), ('michael', r'michael|conjugate addition|1,4-addition'), ('carbocation_rearrangement', r'hydride shift|methyl shift|wagner'),
        ('pinacol', r'pinacol'), ('beckmann', r'beckmann'), ('radical_halogenation', r'radical (chlorination|bromination|halogenation)|homoly'),
        ('suzuki', r'suzuki|oxidative addition|transmetal'), ('acid_base', r'neutrali[sz]|proton transfer|acid.base'))}
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
    if name not in ('fischer_esterification', 'sn1', 'sn2', 'e2'):
        # Other families: try the answer's own structures, in order, as the reactant list.
        from itertools import permutations
        for count in (2, 1, 3):
            for combo in permutations(mols, count):
                try:
                    return build(name, [smiles(m) for m in combo])
                except (ValueError, StopIteration, TypeError):
                    continue
        return None
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
