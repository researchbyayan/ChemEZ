"""Standard textbook routes ChemEZ can draw itself for /synthesis, keyed by start and target.

Each step is (reactant SMILES, product SMILES, reagents, conditions, caption). The model is
given the route to explain; if it still returns no reaction blocks, ChemEZ draws these.
"""
import re
from rdkit import Chem
from .common_names import common_smiles

_ROUTES = [
    ('c1ccccc1', 'OC(=O)c1ccccc1', [
        ('c1ccccc1', 'Cc1ccccc1', 'CH3Cl, AlCl3', 'anhydrous', 'Step 1: Friedel–Crafts methylation'),
        ('Cc1ccccc1', 'OC(=O)c1ccccc1', 'KMnO4, NaOH', 'heat, then H3O+', 'Step 2: side-chain oxidation')]),
    ('Cc1ccccc1', 'OC(=O)c1ccccc1', [
        ('Cc1ccccc1', 'OC(=O)c1ccccc1', 'KMnO4, NaOH', 'heat, then H3O+', 'Side-chain oxidation')]),
    ('c1ccccc1', 'Nc1ccccc1', [
        ('c1ccccc1', 'O=[N+]([O-])c1ccccc1', 'conc. HNO3, conc. H2SO4', 'below 55 °C', 'Step 1: nitration'),
        ('O=[N+]([O-])c1ccccc1', 'Nc1ccccc1', 'Sn, conc. HCl', 'heat, then NaOH', 'Step 2: reduction')]),
    ('c1ccccc1', 'Oc1ccccc1', [
        ('c1ccccc1', 'O=S(=O)(O)c1ccccc1', 'fuming H2SO4 (SO3)', 'heat', 'Step 1: sulfonation'),
        ('O=S(=O)(O)c1ccccc1', 'Oc1ccccc1', 'NaOH', 'fusion at 300 °C, then H3O+', 'Step 2: alkali fusion')]),
    ('c1ccccc1', 'CC(=O)c1ccccc1', [
        ('c1ccccc1', 'CC(=O)c1ccccc1', 'CH3COCl, AlCl3', 'anhydrous, then H2O', 'Friedel–Crafts acylation')]),
    ('c1ccccc1', 'O=Cc1ccccc1', [
        ('c1ccccc1', 'O=Cc1ccccc1', 'CO, HCl, AlCl3, CuCl', 'pressure', 'Gattermann–Koch formylation')]),
    ('c1ccccc1', 'Brc1ccccc1', [
        ('c1ccccc1', 'Brc1ccccc1', 'Br2, FeBr3', 'room temperature, dark', 'Electrophilic bromination')]),
    ('Brc1ccccc1', 'OC(=O)c1ccccc1', [
        ('Brc1ccccc1', 'Br[Mg]c1ccccc1', 'Mg', 'dry ether', 'Step 1: Grignard reagent'),
        ('Br[Mg]c1ccccc1', 'OC(=O)c1ccccc1', 'CO2', 'dry ether, then H3O+', 'Step 2: carboxylation')]),
    ('CCO', 'CC(=O)O', [
        ('CCO', 'CC(=O)O', 'K2Cr2O7, H2SO4', 'heat under reflux', 'Oxidation')]),
    ('CCO', 'CCOC(C)=O', [
        ('CCO', 'CC(=O)O', 'K2Cr2O7, H2SO4', 'heat under reflux', 'Step 1: oxidation of part of the ethanol'),
        ('CC(=O)O.CCO', 'CCOC(C)=O', 'conc. H2SO4', 'heat', 'Step 2: Fischer esterification with more ethanol')]),
    ('CCO', 'C=C', [
        ('CCO', 'C=C', 'conc. H2SO4', '170 °C', 'Dehydration')]),
    ('C=C', 'CCO', [
        ('C=C', 'CCO', 'H2O, H3PO4', '300 °C, 60 atm', 'Hydration')]),
    ('CCO', 'CC=O', [
        ('CCO', 'CC=O', 'PCC', 'CH2Cl2', 'Partial oxidation')]),
]


def _key(smiles):
    mol = Chem.MolFromSmiles(smiles)
    return Chem.MolToSmiles(mol) if mol else None


ROUTES = {(_key(start), _key(target)): steps for start, target, steps in _ROUTES}


def _structure(name):
    name = name.strip(' .?!"\'').lower()
    name = re.sub(r'^(?:the|a|an)\s+', '', name)
    found = common_smiles(name)
    if found:
        return found
    mol = Chem.MolFromSmiles(name) if re.fullmatch(r'[A-Za-z0-9@+\-\[\]()=#$/\\%.]+', name) else None
    return Chem.MolToSmiles(mol) if mol else None


def find(question):
    """The verified route for "X to Y" (or "Y from X"), or None."""
    text = question.strip()
    match = re.search(r'(?:from\s+)?(.+?)\s+(?:to|into|→|->)\s+(.+)', text, re.I)
    start, target = (match.group(1), match.group(2)) if match else (None, None)
    reverse = re.search(r'(.+?)\s+from\s+(.+)', text, re.I)
    if reverse and not match:
        target, start = reverse.group(1), reverse.group(2)
    if not start:
        return None
    pair = (_key(_structure(start) or ''), _key(_structure(target) or ''))
    return ROUTES.get(pair) if all(pair) else None


def blocks(steps):
    return [{'type': 'reaction', 'reactants': [{'smiles': s, 'label': ''} for s in reactant.split('.')],
             'products': [{'smiles': product, 'label': ''}], 'reagents': reagents, 'conditions': conditions, 'caption': caption}
            for reactant, product, reagents, conditions, caption in steps]


def describe(steps):
    return ' → '.join(f'{caption} ({reagents}; {conditions})' for _, _, reagents, conditions, caption in steps)
