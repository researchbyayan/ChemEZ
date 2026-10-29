"""¹³C shift prediction from measured NMRShiftDB2 spectra (no hand-written shift rules).

Each carbon's surroundings within 1–4 bonds become a canonical key; the prediction is the
median measured shift of the largest radius seen often enough in the database. The table
is built by scripts/build-c13-table.py.
"""
import gzip, json
from functools import lru_cache
from pathlib import Path
from rdkit import Chem

RADII = [1, 2, 3, 4]
TABLE = Path(__file__).with_name('data') / 'c13_shifts.json.gz'


def environment_keys(mol, index):
    """{radius: canonical SMILES of the atoms within that many bonds, centre marked}."""
    keys = {}
    for radius in RADII:
        bonds = Chem.FindAtomEnvironmentOfRadiusN(mol, radius, index)
        if not bonds and radius > 1:
            break
        atoms = {index} | {a for b in bonds for a in (mol.GetBondWithIdx(b).GetBeginAtomIdx(), mol.GetBondWithIdx(b).GetEndAtomIdx())}
        marked = Chem.RWMol(mol)
        marked.GetAtomWithIdx(index).SetAtomMapNum(1)
        keys[radius] = Chem.MolFragmentToSmiles(marked, atomsToUse=sorted(atoms), bondsToUse=list(bonds) or None, canonical=True, allHsExplicit=True)
        if len(bonds) == 0:
            break
    return keys


@lru_cache(maxsize=1)
def _table():
    if not TABLE.exists():
        return None
    with gzip.open(TABLE, 'rt', encoding='utf8') as handle:
        return json.load(handle)['table']


def available():
    return _table() is not None


def predict(smiles):
    """[(carbon number, atom indices, predicted δ, observations, radius)] per distinct carbon, or None."""
    table = _table()
    mol = Chem.MolFromSmiles(smiles)
    if table is None or mol is None:
        return None
    ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=False))
    groups = {}
    for atom in mol.GetAtoms():
        if atom.GetSymbol() == 'C':
            groups.setdefault(ranks[atom.GetIdx()], []).append(atom.GetIdx())
    result = []
    for number, atoms in enumerate(groups.values(), 1):
        keys = environment_keys(mol, atoms[0])
        # A key spanning the whole molecule is an exact match to a measured compound.
        whole = {radius for radius in keys if len({atoms[0]} | {a for b in Chem.FindAtomEnvironmentOfRadiusN(mol, radius, atoms[0]) for a in (mol.GetBondWithIdx(b).GetBeginAtomIdx(), mol.GetBondWithIdx(b).GetEndAtomIdx())}) == mol.GetNumAtoms()}
        found = None
        for radius in sorted(keys, reverse=True):
            entry = table.get(str(radius), {}).get(keys[radius])
            if entry and entry[1] >= (1 if radius in whole else 3 if radius < 4 else 2):
                found = (entry[0], entry[1], radius)
                break
        if found is None:
            for radius in sorted(keys, reverse=True):
                entry = table.get(str(radius), {}).get(keys[radius])
                if entry:
                    found = (entry[0], entry[1], radius)
                    break
        result.append((number, atoms, *(found or (None, 0, 0))))
    return result
