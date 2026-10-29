import json
from xml.etree import ElementTree as ET
import pytest
from chemez.chemistry import molecule_result, formula_only_question, render_block
from chemez.models import Molecule, MechanismBlock, ReactionBlock
from chemez.app import prepare_answer

@pytest.mark.parametrize('smiles,formula',[('CCO','C2H6O'),('c1ccccc1','C6H6'),('[NH4+]','H4N+'),('N[C@@H](C)C(=O)O','C3H7NO2')])
def test_molecule_preserves_formula_and_valid_svg(smiles,formula):
    result=molecule_result(Molecule(smiles=smiles,formula=formula,label='Example'))
    assert result['formula']==formula
    assert ET.fromstring(result['svg']).tag.endswith('svg')
    assert result['encoding']['available']
    assert len(result['encoding']['one_hot_indices'])==result['encoding']['shape'][0]
    if '@' in smiles:
        assert '@' in result['smiles']

@pytest.mark.parametrize('smiles,formula',[('not smiles',None),('CCO','C3H8'),('CO(C)C',None)])
def test_invalid_chemistry_is_not_drawn(smiles,formula):
    with pytest.raises(ValueError):molecule_result(Molecule(smiles=smiles,formula=formula))

@pytest.mark.parametrize('question',['C2H6O','Draw C2H6O','Show the structure of C₂H₆O','Convert C2H6O to SMILES'])
def test_formula_only_never_guesses_isomer(question):
    assert formula_only_question(question)['type']=='clarification'

def test_context_and_isomer_requests_pass_to_model():
    assert formula_only_question('Draw ethanol (C2H6O)') is None
    assert formula_only_question('Show possible isomers of C2H6O') is None
    assert formula_only_question('H2O')['smiles']=='O'

def test_encoding_failure_does_not_prevent_drawing(monkeypatch):
    import seq_encode.smiles
    monkeypatch.setattr(seq_encode.smiles.smiles_coder,'fit',lambda *a,**k:(_ for _ in ()).throw(RuntimeError('unsupported')))
    result=molecule_result(Molecule(smiles='CCO'))
    assert result['svg'] and not result['encoding']['available']

def test_reaction_composes_reagents_and_products():
    block=ReactionBlock(type='reaction',reactants=[Molecule(smiles='CCO'),Molecule(smiles='CC(=O)O')],products=[Molecule(smiles='CCOC(C)=O'),Molecule(smiles='O')],reagents='H2SO4',conditions='Heat',caption='Esterification')
    result=render_block(block)
    assert 'H₂SO₄' in result['svg'] and 'Heat' in result['svg']
    assert len(result['reactants'])==2 and len(result['products'])==2
    ET.fromstring(result['svg'])

def test_names_use_connectivity_and_unknown_names_stay_explicit():
    from chemez.chemistry import enrich_names
    result=molecule_result(Molecule(smiles='Oc1ccccc1',label='Product'))
    assert result['iupac_name']=='phenol' and result['name_source']=='local'
    assert result['formula']=='C6H6O'
    assert molecule_result(Molecule(smiles='CCCO',iupac_name='propan-1-ol'))['iupac_name']=='propan-1-ol'
    assert molecule_result(Molecule(smiles='CCCO'))['iupac_name']==''
    old=enrich_names({'type':'molecule','smiles':'c1ccccc1','label':'Benzene','svg':'<svg/>'})
    assert old['iupac_name']=='benzene' and old['formula']=='C6H6'

def test_text_equation_without_reaction_requests_repair():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'markdown','text':r'Fusion: $\\ce{C6H5SO3Na + 2NaOH -> C6H5ONa + Na2SO3 + H2O}$'}]}))
    assert failed and blocks[-1]['type']=='error'
    assert 'reaction drawing' in blocks[-1]['text']

def test_benzenesulfonate_fusion_has_drawn_named_participants():
    block=ReactionBlock(type='reaction',reactants=[Molecule(smiles='[Na+].O=S(=O)([O-])c1ccccc1')],products=[Molecule(smiles='[Na+].[O-]c1ccccc1')],reagents='2 NaOH',conditions='Fusion, heat',caption='Alkali fusion')
    result=render_block(block)
    assert result['reactants'][0]['iupac_name']=='sodium benzenesulfonate'
    assert result['products'][0]['iupac_name']=='sodium phenolate'
    assert 'Sodium phenolate' in result['svg']
    assert result['products'][0]['formula']=='C6H5NaO'

def test_mechanism_bond_and_atom_anchors():
    block=MechanismBlock.model_validate({'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'SN2 attack','arrows':[{'tail':[0],'head':[1]},{'tail':[1,2],'head':[2]}]}]})
    result=render_block(block)
    assert 'electron-flow-head' in result['steps'][0]['svg']
    assert 'No following panel' in result['steps'][0]['limitation']

def test_invalid_mechanism_arrow_is_explicit_limitation():
    block=MechanismBlock.model_validate({'type':'mechanism','steps':[{'smiles':'CCO','label':'Invalid anchor','arrows':[{'tail':[0],'head':[99]}]}]})
    step=render_block(block)['steps'][0]
    assert step['svg'] is None and 'not present' in step['limitation']

def test_invalid_block_preserves_valid_neighbors_and_order():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'markdown','text':'Before'},{'type':'molecule','smiles':'bogus'},{'type':'markdown','text':'After'}]}))
    assert failed
    assert [b['type'] for b in blocks]==['markdown','error','markdown']
    assert len({b['id'] for b in blocks})==3

@pytest.mark.parametrize('wrap',[
    lambda text:'```json\n'+text+'\n```',
    lambda text:'Here is the answer:\n```json\n'+text+'\n```\nEnd of answer.',
    lambda text:'\ufeff'+text,
    lambda text:json.dumps(json.loads(text)['blocks']),
])
def test_benzene_answers_survive_presentation_wrappers(wrap):
    raw=json.dumps({'blocks':[{'type':'markdown','text':'Benzene has two equivalent Kekulé contributors.'},{'type':'molecule','smiles':'C1=CC=CC=C1','label':'Benzene','formula':'C6H6'}]})
    blocks,failed=prepare_answer(wrap(raw))
    assert not failed
    assert [block['type'] for block in blocks]==['markdown','molecule']
    assert blocks[1]['formula']=='C6H6' and blocks[1]['svg']

def test_truncated_answer_is_not_silently_accepted():
    blocks,failed=prepare_answer('{"blocks":[{"type":"markdown","text":"Benzene')
    assert failed and blocks[0]['type']=='error'

def test_latex_survives_structured_json_decoding():
    text=r'Benzene is $\ce{C6H6}$. Its bond angles are $120^\circ$.'
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'markdown','text':text}]}))
    assert not failed and blocks[0]['text']==text

def test_kekule_contributors_keep_distinct_bonds_but_same_identity():
    first=molecule_result(Molecule(smiles='C1=CC=CC=C1',formula='C6H6',label='Contributor I'))
    second=molecule_result(Molecule(smiles='C1C=CC=CC=1',formula='C6H6',label='Contributor II'))
    assert first['smiles']==second['smiles']=='c1ccccc1'
    assert first['formula']==second['formula']=='C6H6'
    assert first['svg']!=second['svg']
    assert first['svg'].count('class="bond-')==second['svg'].count('class="bond-')

def test_single_backslash_latex_is_restored_from_json_escapes():
    raw='{"blocks":[{"type":"markdown","text":"$\\text{CH}_3$ \\frac{1}{2} \\beta"},{"type":"reaction","reactants":[{"smiles":"c1ccccc1"}],"products":[{"smiles":"Clc1ccccc1"}],"reagents":"$\\text{AlCl}_3$"}]}'
    blocks,failed=prepare_answer(raw)
    assert not failed
    assert blocks[0]['text']==r'$\text{CH}_3$ \frac{1}{2} \beta'
    assert blocks[1]['reagents']==r'$\text{AlCl}_3$'

def test_name_that_contradicts_structure_is_rejected_for_repair():
    raw='{"blocks":[{"type":"reaction","reactants":[{"smiles":"c1ccccc1","iupac_name":"benzene"}],"products":[{"smiles":"CC(C)=O","iupac_name":"4-phenylbutan-2-one"}]}]}'
    blocks,failed=prepare_answer(raw)
    assert failed and 'no an aromatic ring' not in blocks[0]['text'] and 'aromatic ring' in blocks[0]['text']
    ok,failed=prepare_answer('{"blocks":[{"type":"molecule","smiles":"CC(=O)c1ccccc1","iupac_name":"1-phenylethanone"},{"type":"molecule","smiles":"CC(O)C","iupac_name":"propan-2-ol"},{"type":"molecule","smiles":"ClC1CCCCC1","iupac_name":"chlorocyclohexane"}]}')
    assert not failed

def test_common_compound_names_override_wrong_model_smiles():
    raw='{"blocks":[{"type":"reaction","reactants":[{"smiles":"c1ccccc1","iupac_name":"benzene"}],"products":[{"smiles":"CC(C)=O","iupac_name":"benzaldehyde","formula":"C7H6O"}],"reagents":"CO, HCl, AlCl3/CuCl"}]}'
    blocks,failed=prepare_answer(raw)
    assert not failed
    product=blocks[0]['products'][0]
    assert product['formula']=='C7H6O' and product['smiles']=='O=Cc1ccccc1'

def test_structure_3d_returns_conformer_and_properties():
    from chemez.chemistry import structure_3d
    result=structure_3d('CC(=O)Oc1ccccc1C(=O)O')
    assert result['force_field']=='MMFF94' and result['molblock'].count('\n')>20
    assert result['properties']['molar_mass']==180.16 and result['properties']['h_bond_donors']==1
    assert structure_3d('[Na+].[Cl-]')['properties']['formal_charge']==0

def test_export_text_and_teaching_analysis():
    from chemez.chemistry import plain_chem, analyse
    assert plain_chem(r'Dimethyl sulfate, $\text{AlCl}_3$')=='Dimethyl sulfate, AlCl₃'
    groups={g['name']:g['atoms'] for g in analyse('CC(=O)Oc1ccccc1C(=O)O')['groups']}
    assert groups['Ester']==[1,2,3] and 'Carboxylic acid' in groups
    assert analyse('C[C@H](N)C(=O)O')['stereo']==['C2: S']

@pytest.mark.parametrize('symbol,catalyst',[('Br','FeBr3'),('Cl','AlCl3')])
def test_halogenation_catalyst_alone_does_not_supply_halogen(symbol,catalyst):
    with pytest.raises(ValueError,match='actual halogenating reagent'):
        render_block(ReactionBlock(type='reaction',reactants=[Molecule(smiles='c1ccccc1')],products=[Molecule(smiles=symbol+'c1ccccc1')],reagents=catalyst))
    result=render_block(ReactionBlock(type='reaction',reactants=[Molecule(smiles='c1ccccc1')],products=[Molecule(smiles=symbol+'c1ccccc1')],reagents=f'{symbol}2, {catalyst}'))
    assert result['svg']
    explicit=render_block(ReactionBlock(type='reaction',reactants=[Molecule(smiles='c1ccccc1'),Molecule(smiles=symbol+symbol)],products=[Molecule(smiles=symbol+'c1ccccc1')],reagents=catalyst))
    assert explicit['svg']

def test_benzene_resonance_series_with_arrows_and_hybrid():
    raw=json.dumps({'blocks':[{'type':'resonance','caption':'Resonance in benzene','contributors':[
        {'smiles':'C1=CC=CC=C1','label':'Kekulé I'},
        {'smiles':'C1C=CC=CC=1','label':'Kekulé II'}],'hybrid':True}]})
    blocks,failed=prepare_answer(raw)
    assert not failed
    result=blocks[0]
    assert all(c['svg'] and not c['limitation'] for c in result['contributors'])
    assert 'electron-flow-head' in result['contributors'][0]['svg']
    assert '<circle' in result['hybrid']['svg'] or 'circle' in result['hybrid']['svg']

def test_resonance_rejects_contributors_that_move_atoms_or_hydrogens():
    for second in ['C1=CCCCC1','C1=CC=CC=C1C']:
        blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'resonance','contributors':[{'smiles':'C1=CC=CC=C1'},{'smiles':second}]}]}))
        # The non-contributor is never drawn; ChemEZ draws benzene's own series instead.
        assert not failed and [c['smiles'] for c in blocks[0]['contributors']]==['C1=CC=CC=C1','C1C=CC=CC=1']

def test_named_parent_does_not_erase_a_resonance_contributor():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'molecule','smiles':'[CH+]1[CH-]C=CC=C1','iupac_name':'benzene'}]}))
    assert not failed and '+' in blocks[0]['smiles'] and '-' in blocks[0]['smiles']
    # A different compound under a common name is still corrected.
    blocks,_=prepare_answer(json.dumps({'blocks':[{'type':'molecule','smiles':'C1=CCCCC1','iupac_name':'benzene'}]}))
    assert blocks[0]['formula']=='C6H6'


def test_identity_structure_is_a_molecule_not_a_reaction():
    raw={'type':'reaction','reactants':[{'smiles':'CCCCO','label':'1-Butanol','iupac_name':'butan-1-ol'}],'products':[{'smiles':'CCCCO','label':'1-Butanol'}],'caption':'Structure of 1-butanol'}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed and blocks[0]['type']=='molecule'
    assert blocks[0]['formula']=='C4H10O' and blocks[0]['iupac_name']=='butan-1-ol'


def test_duplicate_benzene_is_two_contributors_with_three_electron_pairs():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'resonance','contributors':[{'smiles':'C1=CC=CC=C1'}]*4}]}))
    assert not failed
    result=blocks[0]
    assert len(result['contributors'])==2
    first=result['contributors'][0]
    assert len(first['arrows'])==3
    assert all(a['electrons']==2 and len(a['tail'])==len(a['head'])==2 for a in first['arrows'])
    assert first['svg'].count('class="electron-flow"')==3
    assert first['svg'].count('class="electron-pair-dot"')==6
    assert first['smiles']!=result['contributors'][1]['smiles']


def test_wrong_resonance_arrows_are_replaced_by_derived_ones():
    raw={'type':'resonance','contributors':[{'smiles':'CC(=O)[O-]','arrows':[{'tail':[2],'head':[1,2]}]},{'smiles':'CC([O-])=O'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    first=blocks[0]['contributors'][0]
    assert not failed and first['arrows_derived'] and 'electron-flow-head' in first['svg']
    # The derived arrows are the textbook pair: O⁻ lone pair forms C=O, the C=O π bond moves onto O.
    assert sorted((tuple(a['tail']),tuple(a['head'])) for a in first['arrows'])==[((1,2),(2,)),((3,),(1,3))]

def test_unreachable_resonance_step_still_fails_verification():
    # Four bond changes need more than three electron-pair arrows: not derivable, so it is reported.
    raw={'type':'resonance','contributors':[{'smiles':'C=CC=CC=CC=C','arrows':[{'tail':[0,1],'head':[1]}]},{'smiles':'[CH2+]C=CC=CC=C[CH2-]'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert failed and any('do not produce' in b.get('text','') for b in blocks)

@pytest.mark.parametrize('smiles,pairs',[('O',2),('[OH-]',3),('N',1),('[NH4+]',0),('[OH3+]',1),('C',0),('C#N',1),('[CH3-]',1)])
def test_lewis_pair_count_respects_valence_and_charge(smiles,pairs):
    from chemez.chemistry import lewis_drawing,molecule
    mol,_=molecule(smiles)
    for explicit in [False,True]:
        svg=lewis_drawing(mol,explicit)
        root=ET.fromstring(svg)
        dots=[e for e in root.iter() if e.get('class')=='lone-pair-electron']
        assert len(dots)==2*pairs and root.get('data-lone-pairs')==str(pairs)
        assert 'viewBox' in root.attrib


def test_explicit_hydrogens_cannot_exceed_the_structure_limit():
    from chemez.chemistry import lewis_drawing,molecule
    mol,_=molecule('C'*90)
    assert lewis_drawing(mol,True) is None
    assert lewis_drawing(mol,False)

@pytest.mark.parametrize('placeholder',['None','none','NULL','N/A','Not applicable','—'])
def test_butane_identity_with_absent_annotation_strings_is_one_structure(placeholder):
    raw={'type':'reaction','reactants':[{'smiles':'CCCC','label':'Butane'}],'products':[{'smiles':'CCCC','label':'Butane'}],'reagents':placeholder,'conditions':placeholder,'caption':'Structure of Butane'}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed and len(blocks)==1
    assert blocks[0]['type']=='molecule' and blocks[0]['formula']=='C4H10'
    assert blocks[0]['smiles']=='CCCC'


def test_saved_butane_identity_card_is_restored_as_one_molecule():
    from chemez.app import restored_block
    raw={'id':'saved-butane','type':'reaction','reactants':[{'smiles':'CCCC','label':'Butane','svg':'old'}],'products':[{'smiles':'CCCC','label':'Butane','svg':'old'}],'reagents':'None','conditions':'None','caption':'Structure of Butane','svg':'old reaction'}
    restored=restored_block(raw)
    assert restored['id']=='saved-butane' and restored['type']=='molecule'
    assert restored['formula']=='C4H10' and restored['svg']!='old reaction'


def test_pair_step_tracks_sn2_bond_formation_and_breaking():
    raw={'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'Attack and departure','arrows':[{'tail':[0],'head':[1]},{'tail':[1,2],'head':[2]}]},{'smiles':'CO.[Br-]','label':'Products','limitation':'Final products.'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed
    step=blocks[0]['steps'][0]
    assert step['svg'] and 'lone-pair-electron' in step['svg']
    assert {change['action'] for change in step['bond_changes']}=={'FORM_BOND','BREAK_BOND'}
    assert step['svg'].count('class="electron-flow"')==2


def test_wrong_pair_step_arrows_are_replaced_not_kept():
    # O⁻ attacking Br is wrong: ChemEZ replaces it with the verified SN2 pair and says so.
    raw={'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'Incorrect attack','arrows':[{'tail':[0],'head':[2]}]},{'smiles':'CO.[Br-]','label':'Products','limitation':'Final products.'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    first=blocks[0]['steps'][0]
    assert not failed and first['arrows_derived'] and first['svg']
    assert {(tuple(a['tail']),tuple(a['head'])) for a in first['arrows']}=={((0,),(0,1)),((1,2),(2,))}


def test_resonance_displays_lone_pairs():
    raw={'type':'resonance','contributors':[{'smiles':'CC(=O)[O-]','arrows':[{'tail':[3],'head':[1,3]},{'tail':[1,2],'head':[2]}]},{'smiles':'CC([O-])=O'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed
    assert all('lone-pair-electron' in c['svg'] for c in blocks[0]['contributors'])


def test_identity_scheme_never_becomes_a_fake_transformation_even_with_labels():
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'reaction','reactants':[{'smiles':'CCCC','label':'Butane'}],'products':[{'smiles':'CCCC','label':'Butane'}],'reagents':'not needed','conditions':'room temperature'}]}))
    assert not failed and blocks[0]['type']=='molecule'

@pytest.mark.parametrize('source,target,arrows',[
 ('CBr','[CH3+].[Br-]',[{'tail':[0,1],'head':[1]}]),
 ('[OH-].CC=O','CC(O)[O-]',[{'tail':[0],'head':[2]},{'tail':[2,3],'head':[3]}]),
 ('[OH-].[H]OC','O.C[O-]',[{'tail':[0],'head':[1]},{'tail':[1,2],'head':[2]}]),
])
def test_heterolysis_carbonyl_addition_and_explicit_proton_transfer(source,target,arrows):
    raw={'type':'mechanism','steps':[{'smiles':source,'label':'Electron-pair movement','arrows':arrows},{'smiles':target,'label':'Result','limitation':'Final products.'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed,blocks
    assert blocks[0]['steps'][0]['bond_changes']
    assert blocks[0]['steps'][0]['svg']


def test_old_resonance_drawings_gain_lone_pairs_when_restored():
    from chemez.app import restored_block
    raw={'id':'old-acetate','type':'resonance','caption':'Acetate','hybrid':None,'contributors':[{'smiles':'CC(=O)[O-]','arrows':[{'tail':[3],'head':[1,3]},{'tail':[1,2],'head':[2]}],'svg':'old'},{'smiles':'CC([O-])=O','svg':'old'}]}
    result=restored_block(raw)
    assert result['type']=='resonance' and result['id']=='old-acetate'
    assert all('lone-pair-electron' in c['svg'] for c in result['contributors'])


def test_final_product_panel_does_not_need_an_arrow_warning():
    raw={'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'SN2','arrows':[{'tail':[0],'head':[1]},{'tail':[1,2],'head':[2]}]},{'smiles':'CO.[Br-]','label':'Products'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed and not blocks[0]['steps'][-1]['limitation']


def test_benzene_pi_flow_uses_aligned_ring_layout_and_pair_summary():
    raw={'type':'resonance','contributors':[{'smiles':'c1ccccc1'},{'smiles':'c1ccccc1'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed
    result=blocks[0]
    first,second=[ET.fromstring(c['svg']) for c in result['contributors']]
    assert first.get('viewBox')==second.get('viewBox')
    assert first.get('width')==second.get('width')
    paths=[el for el in first.iter() if el.get('class')=='electron-flow']
    assert len(paths)==3 and all(p.get('data-layout')=='ring' and p.get('data-electrons')=='2' for p in paths)
    assert result['contributors'][0]['svg'].count('class="electron-pair-dot"')==6
    assert 'σ-bond framework stays intact' in result['flow_summary']


def test_acetone_resonance_keeps_standard_carbonyl_arrow_and_lone_pairs():
    raw={'type':'resonance','contributors':[{'smiles':'CC(=O)C','arrows':[{'tail':[1,2],'head':[2]}]},{'smiles':'C[C+]([O-])C'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert not failed,blocks
    result=blocks[0]
    assert not result.get('flow_summary')
    first=ET.fromstring(result['contributors'][0]['svg'])
    paths=[el for el in first.iter() if el.get('class')=='electron-flow']
    assert len(paths)==1 and paths[0].get('data-layout')=='standard'
    assert all('lone-pair-electron' in c['svg'] for c in result['contributors'])

def test_full_benzene_series_passes_electron_flow_and_always_gets_hybrid():
    series=[{'smiles':'C1=CC=CC=C1','arrows':[{'tail':[0,1],'head':[1]}]},
        {'smiles':'[CH+]1[CH-]C=CC=C1','arrows':[{'tail':[1],'head':[1,2]},{'tail':[2,3],'head':[3]}]},
        {'smiles':'[CH+]1C=C[CH-]C=C1','arrows':[{'tail':[3],'head':[3,4]},{'tail':[4,5],'head':[5]}]},
        {'smiles':'[CH+]1C=CC=C[CH-]1','arrows':[{'tail':[5],'head':[5,0]}]},
        {'smiles':'C1C=CC=CC=1'}]
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'resonance','contributors':series,'hybrid':False}]}))
    assert not failed and not any(c.get('limitation') for c in blocks[0]['contributors'])
    assert blocks[0]['hybrid'] and 'circle' in blocks[0]['hybrid']['svg']

def test_sn2_with_missing_arrow_and_forgotten_bromide_is_completed():
    raw={'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'Reactants','arrows':[{'tail':[0],'head':[1]}]},{'smiles':'CO','label':'Products'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    first,second=blocks[0]['steps']
    assert not failed and first['svg'] and first['arrows_derived']
    assert {(tuple(a['tail']),tuple(a['head'])) for a in first['arrows']}=={((0,),(1,)),((1,2),(2,))}
    assert second['smiles']=='CO.[Br-]' and 'bromide' in second['completed']

def test_impossible_mechanism_step_gets_a_plain_language_error():
    raw={'type':'mechanism','steps':[{'smiles':'[OH-].CBr','arrows':[{'tail':[0],'head':[1]}]},{'smiles':'OCC(O)O'}]}
    blocks,failed=prepare_answer(json.dumps({'blocks':[raw]}))
    assert failed and 'Explicit valence' not in json.dumps(blocks)


def test_condensed_formula_written_as_smiles_is_drawn():
    from chemez.models import ReactionBlock
    result = render_block(ReactionBlock(type='reaction', reactants=[{'smiles': 'CHCl3'}, {'smiles': 'O=O'}], products=[{'smiles': 'COCl2'}, {'smiles': 'HCl'}]))
    assert [m['formula'] for m in result['products']] == ['CCl2O', 'HCl']


def test_fishhook_homolysis_and_radical_coupling_are_verified():
    from chemez.models import MechanismBlock
    from chemez.chemistry import render_block
    homolysis={'type':'mechanism','steps':[{'smiles':'ClCl','label':'Homolysis','arrows':[{'tail':[0,1],'head':[0],'electrons':1},{'tail':[0,1],'head':[1],'electrons':1}],'limitation':''},{'smiles':'[Cl].[Cl]','label':'Chlorine radicals','arrows':[],'limitation':''}]}
    step=render_block(MechanismBlock(**homolysis))['steps'][0]
    assert step['svg'] and step['bond_changes'][0]['action']=='BREAK_BOND' and 'single-electron' not in step['limitation'].lower()
    assert step['svg'].count('class="electron-flow-head"')==2
    coupling={'type':'mechanism','steps':[{'smiles':'[CH3].[Cl]','label':'Coupling','arrows':[{'tail':[0],'head':[0,1],'electrons':1},{'tail':[1],'head':[0,1],'electrons':1}],'limitation':''},{'smiles':'CCl','label':'Chloromethane','arrows':[],'limitation':''}]}
    assert render_block(MechanismBlock(**coupling))['steps'][0]['bond_changes'][0]['action']=='FORM_BOND'


def test_bond_electrons_only_move_to_an_adjacent_bond_or_own_atom():
    from rdkit import Chem
    from chemez.electron_flow import verify_pair_step
    from chemez.models import Arrow
    mol=Chem.MolFromSmiles('C=CC=C')
    try:
        verify_pair_step(mol,Chem.MolFromSmiles('C=CC=C'),[Arrow(tail=[0,1],head=[2,3])])
        assert False
    except ValueError as problem:
        assert 'shares one of its atoms' in str(problem)


def test_unbracketed_charges_and_structure_checks():
    from rdkit import Chem
    from chemez.chemistry import molecule, structure_check
    assert Chem.MolToSmiles(molecule('c1ccc(C+)cc1')[0])=='[CH2+]c1ccccc1'
    assert Chem.MolToSmiles(molecule('CC(=O)O-')[0])=='CC(=O)[O-]'
    for smiles,name in [('C*','x'),('[13CH4]','methane'),('[CH3]','methane'),('CC(=O)O[Na]','sodium acetate')]:
        try:
            structure_check(Chem.MolFromSmiles(smiles),name);assert False,smiles
        except ValueError:
            pass
    structure_check(Chem.MolFromSmiles('[CH3]'),'methyl radical')
    structure_check(Chem.MolFromSmiles('CC(=O)[O-].[Na+]'),'sodium acetate')


def test_reaction_arrow_kinds():
    from chemez.models import ReactionBlock
    base={'type':'reaction','reactants':[{'smiles':'CC(=O)O','label':'Acetic acid'}],'products':[{'smiles':'CC(=O)OCC','label':'Ethyl acetate'}]}
    assert ReactionBlock(**base).arrow=='forward'
    assert ReactionBlock(**base,arrow='reversible').arrow=='equilibrium'
    assert ReactionBlock(**base,arrow='retrosynthesis').arrow=='retrosynthesis'
