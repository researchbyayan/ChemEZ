import json
from chemez.answer_policy import condensed,prose,references
from chemez.app import prepare_answer,restored_block
from chemez.models import Molecule
from chemez.chemistry import render_block
from chemez.models import MoleculeBlock

def test_condensed_acid_and_model_validation():
    assert condensed('CH₂=CHCH₂COOH')==('C=CCC(=O)O','but-3-enoic acid')
    molecule=Molecule(smiles='ch2=chch2cooh')
    assert molecule.smiles=='C=CCC(=O)O'
    block=render_block(MoleculeBlock(type='molecule',smiles=molecule.smiles))
    assert block['formula']=='C4H6O2'
    assert condensed('C4H10O') is None

def test_answer_prose_and_reference_persistence():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'markdown','text':'Adults usually have 206 bones\u2014bone mineral includes calcium phosphate.'}],'references':[{'title':'PubChem','url':'https://pubchem.ncbi.nlm.nih.gov/compound/2244'}]}))
    assert not failed and '\u2014' not in blocks[0]['text']
    assert restored_block(blocks[0])['references'][0]['provenance']=='model'
    assert prose({'smiles':'CC','svg':'a\u2014b','text':'a\u2014b'})['svg']=='a\u2014b'

def test_reference_urls_are_filtered():
    urls=['javascript:alert(1)','file:///etc/passwd','https://127.0.0.1/a','https://user:secret@example.org','https://host.local/a','https://pubchem.ncbi.nlm.nih.gov/compound/1']
    result=references([{'title':'Source','url':url} for url in urls])
    assert len(result)==1 and result[0]['url']==urls[-1]


def test_written_reference_list_moves_to_references():
    from chemez.answer_policy import move_references
    blocks=move_references([{'type':'markdown','text':'About 30 % is lethal.\n\n**References**\n\n- Katz, *Annu. Rev.* (1972).\n- Thomson, Isotope Effects.'}])
    assert blocks[0]['text']=='About 30 % is lethal.'
    assert [r['title'] for r in blocks[0]['references']]==['Katz, Annu. Rev. (1972).','Thomson, Isotope Effects.']
    kept=move_references([{'type':'markdown','text':'Sources of error:\n- heat loss'}])
    assert kept[0]['text']=='Sources of error:\n- heat loss' and 'references' not in kept[0]


def test_citation_list_without_heading_moves_and_escapes_are_shown():
    from chemez.answer_policy import move_references, prose
    text='The threshold comes from classic studies:\n\n- Katz & Crespy, *Annu. Rev. Biophys. Bioeng.* **1**, 229–254 (1972).\n- Gilby et al., *Nature* **210**, 112–113 (1966).\n\nAsk more.'
    blocks=move_references([{'type':'markdown','text':text}])
    assert blocks[0]['text']=='The threshold comes from classic studies (see References).\n\nAsk more.'
    assert len(blocks[0]['references'])==2
    steps='- Molar mass of K+ = 39.10 g/mol (2024 table).\n- n = 10 g / 39.10 g/mol'
    assert move_references([{'type':'markdown','text':'Steps:\n'+steps}])[0]['text']=='Steps:\n'+steps
    assert prose('g\\u00b7mol') == 'g·mol'


def test_step_by_step_splits_the_series_it_is_given_into_one_move_per_step():
    import json
    from chemez import stepwise
    series=[{'smiles':'C1=CC=CC=C1','arrows':[{'tail':[0,1],'head':[1]}]},
            {'smiles':'[CH+]1[CH-]C=CC=C1','arrows':[{'tail':[1],'head':[1,2]},{'tail':[2,3],'head':[3]}]},
            {'smiles':'[CH+]1C=C[CH-]C=C1'}]
    raw=json.dumps({'blocks':[{'type':'markdown','text':'Benzene delocalises its π electrons.'},
                              *[{'type':'markdown','text':'**Step 1.** model wording'},{'type':'resonance','caption':'Benzene','contributors':series}]*2,
                              {'type':'markdown','text':'**Answer:** see the steps.'}]})
    blocks=json.loads(stepwise.steps(raw))['blocks']
    pairs=[[c['smiles'] for c in b['contributors']] for b in blocks if b['type']=='resonance']
    assert pairs==[['C1=CC=CC=C1','[CH+]1[CH-]C=CC=C1'],['[CH+]1[CH-]C=CC=C1','[CH+]1C=C[CH-]C=C1']]
    texts=[b['text'] for b in blocks if b['type']=='markdown']
    assert texts[1]=='**Step 1.** The bonding electrons of the C1–C2 bond move onto C2, so C2 becomes negative and C1 positive. Each curved arrow is one electron pair.'
    assert 'model wording' not in ' '.join(texts) and texts[-1]=='**Answer:** see the steps.'
    assert stepwise.wanted(None,'show the moving electrons') and not stepwise.wanted(None,'what is benzene')
