"""Verified structures for common teaching compounds, keyed by IUPAC and common names.

Small models often name a compound correctly but write a wrong SMILES. When a name here
matches, the locally verified structure is drawn instead of the model's guess.
"""
import re
_ENTRIES = [
    ('C=C(C)C','2-methylpropene|isobutene|isobutylene'),
    ('COCC','methoxyethane|ethyl methyl ether|methyl ethyl ether'),
    ('C=CC=C','buta-1,3-diene|1,3-butadiene|butadiene'),
    ('C/C=C/C','(E)-but-2-ene|trans-but-2-ene|trans-2-butene'),
    ('C/C=C\\C','(Z)-but-2-ene|cis-but-2-ene|cis-2-butene'),
    ('CC[O-]','ethoxide|ethoxide ion|ethanolate'),
    ('[O-]c1ccccc1','phenoxide|phenoxide ion|phenolate'),
    ('CC(=O)[O-]','acetate|acetate ion|ethanoate'),
    ('CC(O)CC=O','3-hydroxybutanal'),
    ('c1ccccc1', 'benzene'), ('Cc1ccccc1', 'toluene|methylbenzene'), ('O=Cc1ccccc1', 'benzaldehyde|benzenecarbaldehyde'),
    ('CC(=O)c1ccccc1', 'acetophenone|1-phenylethanone|1-phenylethan-1-one|methyl phenyl ketone'), ('O=C(O)c1ccccc1', 'benzoic acid|benzenecarboxylic acid'),
    ('Oc1ccccc1', 'phenol|benzenol'), ('COc1ccccc1', 'anisole|methoxybenzene'), ('Nc1ccccc1', 'aniline|benzenamine|phenylamine'),
    ('O=[N+]([O-])c1ccccc1', 'nitrobenzene'), ('Clc1ccccc1', 'chlorobenzene'), ('Brc1ccccc1', 'bromobenzene'), ('Ic1ccccc1', 'iodobenzene'),
    ('CCc1ccccc1', 'ethylbenzene'), ('CC(C)c1ccccc1', 'cumene|isopropylbenzene|propan-2-ylbenzene|(propan-2-yl)benzene'), ('C=Cc1ccccc1', 'styrene|ethenylbenzene|vinylbenzene'),
    ('OCc1ccccc1', 'benzyl alcohol|phenylmethanol'), ('ClCc1ccccc1', 'benzyl chloride|(chloromethyl)benzene'), ('O=S(=O)(O)c1ccccc1', 'benzenesulfonic acid'),
    ('Cc1ccccc1C', 'o-xylene|1,2-dimethylbenzene'), ('Cc1cccc(C)c1', 'm-xylene|1,3-dimethylbenzene'), ('Cc1ccc(C)cc1', 'p-xylene|1,4-dimethylbenzene'),
    ('c1ccc2ccccc2c1', 'naphthalene'), ('c1ccncc1', 'pyridine'), ('O=C(Cl)c1ccccc1', 'benzoyl chloride'), ('N#Cc1ccccc1', 'benzonitrile'),
    ('O=C(c1ccccc1)c1ccccc1', 'benzophenone|diphenylmethanone'), ('CC(=O)Oc1ccccc1C(=O)O', 'aspirin|acetylsalicylic acid|2-acetyloxybenzoic acid|2-(acetyloxy)benzoic acid'),
    ('O=C(O)c1ccccc1O', 'salicylic acid|2-hydroxybenzoic acid'), ('Cc1ccc(cc1)S(=O)(=O)O', 'p-toluenesulfonic acid|4-methylbenzenesulfonic acid'),
    ('C', 'methane'), ('CC', 'ethane'), ('CCC', 'propane'), ('CCCC', 'butane|n-butane'), ('CC(C)C', 'isobutane|2-methylpropane'), ('C1CCCCC1', 'cyclohexane'),
    ('C=C', 'ethene|ethylene'), ('CC=C', 'propene|propylene'), ('C#C', 'ethyne|acetylene'), ('C1=CCCCC1', 'cyclohexene'),
    ('CCCCO', 'butan-1-ol|1-butanol|n-butanol|butyl alcohol'), ('CO', 'methanol'), ('CCO', 'ethanol'), ('CCCO', 'propan-1-ol|1-propanol'), ('CC(C)O', 'propan-2-ol|2-propanol|isopropanol|isopropyl alcohol'),
    ('CC(C)(C)O', 'tert-butanol|tert-butyl alcohol|2-methylpropan-2-ol'), ('OC1CCCCC1', 'cyclohexanol'), ('OCCO', 'ethane-1,2-diol|ethylene glycol'),
    ('OCC(O)CO', 'glycerol|propane-1,2,3-triol'), ('C=O', 'formaldehyde|methanal'), ('CC=O', 'acetaldehyde|ethanal'), ('CCC=O', 'propanal|propionaldehyde'),
    ('CC(C)=O', 'acetone|propanone|propan-2-one'), ('CCC(C)=O', 'butanone|butan-2-one|methyl ethyl ketone'), ('O=C1CCCCC1', 'cyclohexanone'),
    ('OC=O', 'formic acid|methanoic acid'), ('CC(=O)O', 'acetic acid|ethanoic acid'), ('CCC(=O)O', 'propanoic acid|propionic acid'),
    ('CC(=O)Cl', 'acetyl chloride|ethanoyl chloride'), ('CC(=O)OC(C)=O', 'acetic anhydride|ethanoic anhydride'), ('CCOC(C)=O', 'ethyl acetate|ethyl ethanoate'),
    ('COC(C)=O', 'methyl acetate|methyl ethanoate'), ('CC(N)=O', 'acetamide|ethanamide'), ('CC#N', 'acetonitrile|ethanenitrile'), ('CCOCC', 'diethyl ether|ethoxyethane'),
    ('C1CCOC1', 'tetrahydrofuran|thf|oxolane'), ('CS(C)=O', 'dimethyl sulfoxide|dmso'), ('CN(C)C=O', 'dimethylformamide|dmf|n,n-dimethylformamide'),
    ('CN', 'methylamine|methanamine'), ('CCN', 'ethylamine|ethanamine'), ('CNC', 'dimethylamine'), ('CN(C)C', 'trimethylamine'), ('NC(N)=O', 'urea'),
    ('CCl', 'chloromethane|methyl chloride'), ('CBr', 'bromomethane|methyl bromide'), ('CI', 'iodomethane|methyl iodide'), ('CCCl', 'chloroethane|ethyl chloride'),
    ('CCBr', 'bromoethane|ethyl bromide'), ('CC(C)(C)Cl', 'tert-butyl chloride|2-chloro-2-methylpropane'), ('CC(C)(C)Br', 'tert-butyl bromide|2-bromo-2-methylpropane'),
    ('ClCCl', 'dichloromethane|methylene chloride'), ('ClC(Cl)Cl', 'chloroform|trichloromethane'), ('ClC(Cl)(Cl)Cl', 'carbon tetrachloride|tetrachloromethane'),
    ('ClCCCl', '1,2-dichloroethane'), ('S=C=S', 'carbon disulfide|carbon disulphide'),
    ('O', 'water'), ('O=C=O', 'carbon dioxide'), ('[C-]#[O+]', 'carbon monoxide'), ('N', 'ammonia'), ('Cl', 'hydrogen chloride|hydrochloric acid'),
    ('Br', 'hydrogen bromide|hydrobromic acid'), ('I', 'hydrogen iodide'), ('F', 'hydrogen fluoride'), ('ClCl', 'chlorine|dichlorine'), ('BrBr', 'bromine|dibromine'),
    ('II', 'iodine|diiodine'), ('[H][H]', 'hydrogen|dihydrogen'), ('O=O', 'oxygen|dioxygen'), ('N#N', 'nitrogen|dinitrogen'),
    ('O=S(=O)(O)O', 'sulfuric acid|sulphuric acid'), ('O=[N+]([O-])O', 'nitric acid'), ('O=S(=O)=O', 'sulfur trioxide|sulphur trioxide'),
    ('ClP(Cl)Cl', 'phosphorus trichloride'), ('O=S(Cl)Cl', 'thionyl chloride'), ('Cl[Al](Cl)Cl', 'aluminium chloride|aluminum chloride|aluminium trichloride|aluminum trichloride'),
    ('ClC(Cl)=O', 'phosgene|carbonyl dichloride'), ('O=C(Cl)C(=O)Cl', 'oxalyl chloride'), ('[Na+].[OH-]', 'sodium hydroxide'), ('[K+].[OH-]', 'potassium hydroxide'),
    ('[Na+].[O-]c1ccccc1', 'sodium phenoxide|sodium phenolate'), ('[OH-]', 'hydroxide|hydroxide ion'), ('CC(C)Br', '2-bromopropane|isopropyl bromide'), ('CCC(C)Br', '2-bromobutane|sec-butyl bromide'), ('CCBr', 'bromoethane|ethyl bromide'), ('CBr', 'bromomethane|methyl bromide'), ('CCCBr', '1-bromopropane|propyl bromide'), ('CCCCBr', '1-bromobutane|butyl bromide'), ('CC(C)(C)Br', '2-bromo-2-methylpropane|tert-butyl bromide|t-butyl bromide'), ('CC(C)(C)Cl', '2-chloro-2-methylpropane|tert-butyl chloride'), ('CC(C)Cl', '2-chloropropane|isopropyl chloride'), ('[Cl-]', 'chloride|chloride ion'), ('[Br-]', 'bromide|bromide ion'),
    ('OO', 'hydrogen peroxide'), ('C1CO1', 'oxirane|ethylene oxide'), ('c1ccoc1', 'furan'), ('c1cc[nH]c1', 'pyrrole'), ('c1ccsc1', 'thiophene'),
    ('OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', 'glucose|d-glucose'), ('NCC(=O)O', 'glycine|aminoacetic acid|2-aminoacetic acid'), ('C[C@H](N)C(=O)O', 'alanine|l-alanine'),
]
COMMON = {name.lower(): smiles for smiles, names in _ENTRIES for name in names.split('|')}

def normalize(name):
    return ' '.join(name.lower().replace('–', '-').split())

def common_smiles(*names):
    for name in names:
        if name and normalize(name) in COMMON:
            return COMMON[normalize(name)]
    return None

# Merge chem-skill's PubChem table (MIT). Local entries above win; generic one-word aliases
# that could match an ordinary label ("acid", "alcohol") are not used for substitution.
from .chem_skill_molecules import MOLECULES as _PUBCHEM, ALIASES as _PUBCHEM_ALIASES
_SKIP = {'acid', 'alcohol'}
for _name, _smiles in _PUBCHEM.items():
    COMMON.setdefault(normalize(_name.replace('_', ' ')), _smiles)
for _alias, _target in _PUBCHEM_ALIASES.items():
    _smiles = _PUBCHEM.get(_target)
    if _smiles and _alias not in _SKIP:
        COMMON.setdefault(normalize(_alias.replace('_', ' ')), _smiles)

def _formula_key(text):
    counts = {}
    for element, count in re.findall(r'([A-Z][a-z]?)(\d*)', text):
        counts[element] = counts.get(element, 0) + int(count or 1)
    return tuple(sorted(counts.items()))

_BY_FORMULA = {}
def formula_smiles(text):
    """A condensed formula written in place of SMILES (COCl2, CHCl3) -> the one common compound with that formula."""
    text = text.strip()
    if not re.fullmatch(r'(?:[A-Z][a-z]?\d*)+', text):
        return None
    if not _BY_FORMULA:
        from rdkit import Chem
        from rdkit.Chem import rdMolDescriptors
        for smiles in set(COMMON.values()):
            mol = Chem.MolFromSmiles(smiles)
            if mol:
                _BY_FORMULA.setdefault(_formula_key(rdMolDescriptors.CalcMolFormula(mol)), set()).add(Chem.MolToSmiles(mol, isomericSmiles=False))
    found = _BY_FORMULA.get(_formula_key(text), set())
    return next(iter(found)) if len(found) == 1 else None
