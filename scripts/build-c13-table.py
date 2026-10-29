"""Build ChemEZ's ¹³C shift table from NMRShiftDB2 (nmrshiftdb2withsignals.sd).

Usage: python scripts/build-c13-table.py path/to/nmrshiftdb2withsignals.sd

For every assigned carbon, the structure around it (radius 1–4 bonds) is written as a
canonical key, and the measured shifts for each key are reduced to a median and a count.
Data: NMRShiftDB2, extended ODC Open Database License (see THIRD_PARTY_NOTICES.md).
"""
import gzip, json, re, statistics, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from rdkit import Chem, RDLogger
from chemez.c13 import environment_keys, RADII

RDLogger.DisableLog('rdApp.*')
SIGNAL = re.compile(r'([\d.]+);[^;|]*;(\d+)')


def main(source):
    shifts = defaultdict(list)
    supplier = Chem.SDMolSupplier(source, removeHs=True, sanitize=True)
    used = 0
    for mol in supplier:
        if mol is None:
            continue
        spectra = [mol.GetProp(name) for name in mol.GetPropNames() if name.startswith('Spectrum 13C')]
        if not spectra:
            continue
        used += 1
        # One spectrum per molecule (the first) keeps repeated records from dominating.
        for value, atom in SIGNAL.findall(spectra[0]):
            index = int(atom)
            if index >= mol.GetNumAtoms() or mol.GetAtomWithIdx(index).GetSymbol() != 'C':
                continue
            for radius, key in environment_keys(mol, index).items():
                shifts[(radius, key)].append(float(value))
    table = {}
    for (radius, key), values in shifts.items():
        if len(values) >= (1 if radius < 4 else 2):
            table.setdefault(str(radius), {})[key] = [round(statistics.median(values), 1), len(values)]
    out = Path(__file__).resolve().parents[1] / 'backend' / 'chemez' / 'data' / 'c13_shifts.json.gz'
    out.parent.mkdir(exist_ok=True)
    with gzip.open(out, 'wt', encoding='utf8') as handle:
        json.dump({'source': 'NMRShiftDB2 (nmrshiftdb2withsignals.sd)', 'molecules': used, 'radii': RADII, 'table': table}, handle, separators=(',', ':'))
    print(f'{used} molecules, {sum(len(v) for v in table.values())} environments -> {out} ({out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main(sys.argv[1])
