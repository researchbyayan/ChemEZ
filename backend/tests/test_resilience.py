import asyncio
import json
import pytest
from chemez.processing import process_chemistry, ProcessingError
from chemez.styles import answer_system, style_issue
from chemez.app import prepare_answer
from chemez.providers import Provider, ProviderError, SYSTEM


async def test_native_worker_failure_does_not_kill_the_next_answer():
    with pytest.raises(ProcessingError,match='stopped unexpectedly'):
        await process_chemistry('probe',None,timeout=10)
    blocks, failed=await process_chemistry('answer',json.dumps({'blocks':[{'type':'molecule','smiles':'CCO','label':'Ethanol'}]}))
    assert not failed and blocks[0]['formula']=='C2H6O'


async def test_processing_timeout_stops_worker_and_next_request_works():
    with pytest.raises(ProcessingError,match='too long'):
        await process_chemistry('answer','{"blocks":[{"type":"molecule","smiles":"CCO"}]}',timeout=0.001)
    blocks,failed=await process_chemistry('answer','{"blocks":[{"type":"markdown","text":"Still running."}]}')
    assert not failed and blocks[0]['text']=='Still running.'


def test_answer_limits_apply_to_total_native_drawing_work():
    reaction={'type':'reaction','reactants':[{'smiles':'CCO'}]*12,'products':[{'smiles':'CCO'}]*12}
    blocks,failed=prepare_answer(json.dumps({'blocks':[reaction]*4}))
    assert failed and 'too many structures' in blocks[0]['text']


def test_nvidia_bolt_uses_structured_outputs_and_rejects_images_before_sending():
    provider=Provider({'provider':'compatible','model':'nvidia/nemotron-3.5-bolt-e4b','endpoint':'https://integrate.api.nvidia.com/v1'},'NOT-A-REAL-KEY')
    _,_,body=provider.request([{'role':'user','content':'Draw aspirin.'}],answer_system(SYSTEM,'balanced'))
    assert body['response_format']['type']=='json_schema'
    assert body['response_format']['json_schema']['schema']['required']==['blocks']
    assert body['max_tokens']>=8192
    with pytest.raises(ProviderError,match='accepts text only'):
        provider.request([{'role':'user','content':{'text':'Identify','images':[{'mime':'image/png','data':'abc'}]}}])


def test_nvidia_qwen_preserves_image_content_and_uses_documented_controls():
    provider=Provider({'provider':'compatible','model':'qwen/qwen3.5-122b-a10b','endpoint':'https://integrate.api.nvidia.com/v1'},'NOT-A-REAL-KEY')
    assert provider.image_support()=='supported'
    _,_,body=provider.request([{'role':'user','content':{'text':'Identify','images':[{'mime':'image/png','data':'abc'}]}}],answer_system(SYSTEM,'balanced'))
    assert body['messages'][-1]['content'][-1]['image_url']['url']=='data:image/png;base64,abc'
    assert body['chat_template_kwargs']=={'enable_thinking':True}
    assert body['max_tokens']==16384
    assert 'response_format' not in body


def test_answer_modes_are_distinct_and_out_of_mode_responses_are_flagged():
    assert '50–100' in answer_system(SYSTEM,'concise')
    from chemez.styles import STYLES
    assert set(STYLES)=={'balanced','concise','mechanism'}
    verbose=[{'type':'markdown','text':'word '*170}]
    assert style_issue(verbose,'concise','Explain phenol')


def test_live_nvidia_latex_escapes_are_recovered_without_changing_chemistry():
    from chemez.answer_format import decode_answer
    raw=r'{"blocks":[{"type":"markdown","text":"Formula $\ce{C6H6}$ and $\underbrace{x}$."},{"type":"molecule","smiles":"F/C=C\F"}]}'
    result=decode_answer(raw)
    assert result['blocks'][0]['text']==r'Formula $\ce{C6H6}$ and $\underbrace{x}$.'
    assert result['blocks'][1]['smiles']==r'F/C=C\F'
    with pytest.raises(ValueError):
        decode_answer(raw[:-2])


def test_common_reference_corrects_formula_but_preserves_enantiomers():
    from chemez.chemistry import molecule_result
    from chemez.models import Molecule
    result=molecule_result(Molecule(smiles='Brc1ccccc1',label='Bromobenzene',formula='C6H6Br'))
    assert result['formula']=='C6H5Br' and result['validation_notes']
    first=molecule_result(Molecule(smiles='C[C@H](O)C(=O)O',label='Lactic acid'))
    second=molecule_result(Molecule(smiles='C[C@@H](O)C(=O)O',label='Lactic acid'))
    assert first['smiles']!=second['smiles'] and '@' in first['smiles'] and '@' in second['smiles']
    named=molecule_result(Molecule(smiles='C[C@H](O)C(=O)O',label='Lactic acid',iupac_name='(2R)-2-hydroxypropanoic acid'))
    assert named['smiles']==first['smiles']
    with pytest.raises(ValueError,match='different compounds'):
        molecule_result(Molecule(smiles='CCO',label='Ethanol',iupac_name='Methanol'))


async def test_corrupt_saved_text_is_isolated_and_health_still_responds(tmp_path):
    from chemez.app import create_app
    from chemez.storage import Store
    from httpx import AsyncClient,ASGITransport
    app=create_app(tmp_path,'test-token')
    store=app.state.store
    cid=store.create('Corrupt saved text')
    store.add(cid,'assistant',[{'id':'broken','type':'markdown','text':{'not':'text'}},{'id':'good','type':'markdown','text':'Still readable.'}])
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as client:
        response=await client.get('/conversations/'+cid)
        assert response.status_code==200
        blocks=response.json()['messages'][0]['content']
        assert blocks[0]['type']=='error' and blocks[1]['text']=='Still readable.'
        assert (await client.get('/health')).json()['ok']


def test_unassigned_enantiomer_names_and_atom_creating_mechanisms_are_rejected():
    from chemez.chemistry import molecule_result,render_block
    from chemez.models import Molecule,MechanismBlock
    with pytest.raises(ValueError,match='stereochemistry'):
        molecule_result(Molecule(smiles='CC(O)C(=O)O',label='(R)-2-hydroxypropanoic acid'))
    mechanism=MechanismBlock.model_validate({'type':'mechanism','steps':[{'smiles':'[OH-].CBr','label':'Reactants'},{'smiles':'CCO.[Br-]','label':'Products: methanol and bromide'}]})
    result=render_block(mechanism)
    assert result['steps'][0]['svg'] is None and result['steps'][1]['svg'] is None
    assert 'arrows' in result['steps'][0]['limitation']
    assert 'atom inventory' in result['steps'][1]['limitation']


def test_missing_carbon_source_and_missing_synthesis_diagram_are_flagged():
    from chemez.models import ReactionBlock
    from chemez.chemistry import render_block
    from chemez.styles import diagram_issue
    reaction=ReactionBlock.model_validate({'type':'reaction','reactants':[{'smiles':'CCO'}],'products':[{'smiles':'CCOC(C)=O'}],'reagents':'H2SO4'})
    with pytest.raises(ValueError,match='creates carbon'):
        render_block(reaction)
    assert diagram_issue([{'type':'markdown','text':'Sulfonation followed by alkali fusion gives phenol.'}],'Show a multistep benzene-to-phenol synthesis.')


def test_standalone_chemistry_macros_render_without_changing_code_or_existing_math():
    from chemez.answer_format import chemistry_markdown
    text=r'Use \ce{NaOH}, $\ce{H2O}$, and literal `\ce{CO2}`.'
    assert chemistry_markdown(text)==r'Use $\ce{NaOH}$, $\ce{H2O}$, and literal `\ce{CO2}`.'


def test_reference_lookup_normalizes_e_z_aliases_before_stereo_validation():
    from chemez.chemistry import molecule_result
    from chemez.models import Molecule
    cis=molecule_result(Molecule(smiles='C1=C(C)C(C)1',label='cis-but-2-ene',iupac_name='(Z)-but-2-ene',formula='C4H8'))
    trans=molecule_result(Molecule(smiles='C1=C(C)C(C)1',label='trans-but-2-ene',iupac_name='(E)-but-2-ene',formula='C4H8'))
    assert cis['formula']==trans['formula']=='C4H8'
    assert cis['smiles']!=trans['smiles']


async def test_partial_recovery_keeps_complete_blocks_and_discloses_missing_parts():
    raw='{"blocks":[{"type":"markdown","text":"A complete explanation."}},{"type":"molecule","smiles":"CCO","label":"Ethanol"}]} '
    blocks=await process_chemistry('partial',[raw])
    assert [b['type'] for b in blocks]==['markdown','molecule','error']
    assert blocks[1]['formula']=='C2H6O' and 'Only complete' in blocks[-1]['text']
