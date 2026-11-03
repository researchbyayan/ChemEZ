import json
import pytest
from rdkit import Chem
from chemez import mechanisms, drawing
from chemez.app import prepare_answer

FAMILIES = [
    ('SN2', ['CCBr', '[OH-]'], 'CCO.[Br-]'), ('SN1', ['CC(C)(C)Br', 'O'], None), ('E2', ['CC(C)Br', '[O-]CC'], None),
    ('E1', ['CC(C)(C)Br', 'O'], 'C=C(C)C.[Br-].[OH3+]'), ('Fischer esterification', ['CC(=O)O', 'CCO'], None),
    ('HX addition', ['CC=C', 'Br'], 'CC(C)Br'), ('halogen addition', ['C=C', 'BrBr'], 'BrCCBr'),
    ('acid-catalysed hydration', ['CC=C'], 'CC(C)O.O.[OH3+]'), ('nucleophilic addition', ['CC=O', '[C-]#N'], 'CC(O)C#N.[OH-]'),
    ('hydride reduction', ['CC(C)=O', '[BH4-]'], 'B.CC(C)O.[OH-]'), ('nucleophilic acyl substitution', ['CC(=O)Cl', 'N'], 'CC(N)=O.Cl'),
    ('saponification', ['CC(=O)OCC', '[OH-]'], 'CC(=O)[O-].CCO'),
    ('electrophilic aromatic substitution', ['c1ccccc1', 'O=[N+]=O'], 'O=[N+]([O-])c1ccccc1.[OH3+]'),
    ('SNAr', ['O=[N+]([O-])c1ccc(Cl)cc1', '[O-]C'], 'COc1ccc([N+](=O)[O-])cc1.[Cl-]'),
    ('Diels-Alder', ['C=CC=C', 'C=C'], 'C1=CCCCC1'), ('aldol', ['CC=O'], 'CC(O)CC=O.O.[OH-]'),
    ('E1cB', ['CC(O)CC=O'], 'CC=CC=O.O.[OH-]'), ('Michael addition', ['CC(C)=O', 'C=CC(C)=O'], 'CC(=O)CCCC(C)=O.O.[OH-]'),
    ('hydride shift', ['CC(C)C(C)Br', 'O'], 'Br.CCC(C)(C)O'), ('pinacol', ['CC(C)(O)C(C)(C)O'], 'CC(=O)C(C)(C)C.O.O.[OH3+]'),
    ('Beckmann', ['ON=C1CCCCC1'], 'O.O.O=C1CCCCCN1.[OH3+]'), ('radical halogenation', ['CC', 'ClCl'], 'CCCl.Cl.ClCl'),
    ('Suzuki coupling', ['Brc1ccccc1', 'O[B-](O)(O)c1ccccc1'], 'O[B-](O)(O)Br.[Pd].c1ccc(-c2ccccc2)cc1'),
    ('neutralisation', ['Cl', '[OH-]'], 'O.[Cl-]'), ('neutralisation', ['[H+]', '[OH-]'], 'O'), ('acid-base', ['CC(=O)O', 'N'], 'CC(=O)[O-].[NH4+]'),
]


@pytest.mark.parametrize('name,reactants,product', FAMILIES)
def test_every_built_in_mechanism_passes_the_electron_flow_check(name, reactants, product):
    block = mechanisms.build(name, reactants)
    blocks, failed = prepare_answer(json.dumps({'blocks': [block]}))
    assert not failed and blocks[0]['type'] == 'mechanism'
    assert not any(step.get('limitation') for step in blocks[0]['steps'])
    if product:
        assert Chem.MolToSmiles(Chem.MolFromSmiles(block['steps'][-1]['smiles'])) == Chem.MolToSmiles(Chem.MolFromSmiles(product))


def test_a_named_family_is_rebuilt_from_the_answers_own_structures():
    item = {'type': 'mechanism', 'steps': [{'smiles': 'c1ccccc1.O=[N+]=O', 'label': 'start'}]}
    rebuilt = mechanisms.recognise(item, [{'type': 'markdown', 'text': 'Nitration goes through an arenium ion.'}])
    assert rebuilt and len(rebuilt['steps']) == 3


@pytest.mark.parametrize('raw,text,expected', [
    ('{"blocks":[],"visual":false}', 'Hi! How can I help?', False),
    ('{"blocks":[]}', 'I am doing well, thanks for asking.', False),
    ('{"blocks":[]}', 'Chloroform oxidises to COCl2 and HCl.', True),
    ('{"blocks":[]}', 'Water is $\\ce{H2O}$.', True),
    ('{"blocks":[],"visual":true}', 'Benzene is aromatic.', True),
])
def test_the_drawing_step_runs_only_when_the_answer_calls_for_it(raw, text, expected):
    assert drawing.needed(raw, [{'type': 'markdown', 'text': text}]) is expected


def test_every_built_mechanism_names_its_family():
    for name, reactants, _ in FAMILIES:
        assert mechanisms.build(name, reactants)['family']


def test_the_family_badge_survives_reopening_a_chat():
    from chemez.app import restored_block
    blocks, _ = prepare_answer(json.dumps({'blocks': [mechanisms.build('SN2', ['CCBr', '[OH-]'])]}))
    assert restored_block(blocks[0])['family'] == 'SN2'


def test_spectra_asks_for_ms_intensities_when_the_table_has_none(monkeypatch):
    from chemez.styles import command_issue
    from chemez import nmr
    monkeypatch.setattr(nmr, 'issue', lambda *args: None)  # only the MS rule is under test here
    table = lambda header: [{'type': 'molecule', 'smiles': 'O'}, {'type': 'markdown', 'text': '**MS**\n\n' + header + '\n|---|---|\n| 18 | M+ |'}]
    assert 'Relative intensity' in command_issue('spectra', table('| m/z | Ion |'))
    assert command_issue('spectra', table('| m/z | Ion | Relative intensity (%) |')) is None
