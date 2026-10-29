import os
import asyncio
import json
import pytest
from httpx import ASGITransport, AsyncClient
from chemez.app import create_app, MAX_REPAIRS
from chemez.models import ProviderConfig
from chemez.storage import Credentials,Store

class MemoryVault:
    warning='Session only for tests.'
    def __init__(self):self.values={}
    def get(self,account):return self.values.get(account)
    def set(self,account,key):self.values[account]=key
    def delete(self,account):self.values.pop(account,None)

class FakeProvider:
    calls=0
    def __init__(self,*args):pass
    async def stream(self,messages,system=None):
        type(self).last_system=system
        type(self).calls+=1
        text=json.dumps({'blocks':[{'type':'markdown','text':'An alcohol.'},{'type':'molecule','label':'Ethanol','smiles':'CCO','formula':'C2H6O'}]})
        yield text[:20];yield text[20:]

@pytest.fixture
async def client(tmp_path):
    FakeProvider.calls=0
    app=create_app(tmp_path,'test-token',MemoryVault(),FakeProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as client:
        client.app_instance=app
        yield client

async def configure(client):
    response=await client.put('/config',json={'provider':'openai','model':'test','api_key':'SECRET'})
    assert response.status_code==200
    assert 'SECRET' not in response.text

async def test_conversation_names_and_pins_persist(client,tmp_path):
    store=client.app_instance.state.store
    first=store.create('First')
    second=store.create('Second')
    response=await client.patch('/conversations/'+first,json={'title':'  Organic revision  ','pinned':True})
    assert response.status_code==200
    restored=Store(tmp_path)
    chats=restored.conversations()
    assert chats[0]['id']==first
    assert chats[0]['title']=='Organic revision'
    assert chats[0]['pinned'] is True
    assert chats[1]['id']==second
    assert (await client.patch('/conversations/'+first,json={'title':' ','pinned':False})).status_code==400
    assert (await client.patch('/conversations/missing',json={'title':'Name','pinned':False})).status_code==404

async def test_search_archive_restore_and_rewind(client,tmp_path):
    store=client.app_instance.state.store
    cid=store.create('Study notes')
    user=store.add(cid,'user',{'text':'Explain aspirin','images':[{'name':'image.png','mime':'image/png','data':'private-image-marker'}]})
    store.add(cid,'assistant',[{'id':'a','type':'markdown','text':'Acetylsalicylic acid is an ester.'},{'id':'b','type':'molecule','label':'Aspirin','smiles':'CC(=O)Oc1ccccc1C(=O)O','svg':'private-svg-marker'}])
    followup=store.add(cid,'user',{'text':'Compare its acidity','images':[]})
    original=store.messages(cid)
    found=(await client.get('/conversations/search',params={'q':'acetylsalicylic'})).json()
    assert found[0]['id']==cid and 'Acetylsalicylic' in found[0]['snippet']
    assert (await client.get('/conversations/search',params={'q':'private-image-marker'})).json()==[]
    assert (await client.get('/conversations/search',params={'q':'private-svg-marker'})).json()==[]
    assert (await client.get('/conversations/search',params={'q':'%'})).json()==[]
    assert (await client.patch('/conversations/'+cid,json={'title':'Study notes','pinned':True,'archived':True})).status_code==200
    assert (await client.get('/conversations/search',params={'q':'ester'})).json()[0]['archived'] is True
    assert (await client.patch('/conversations/'+cid,json={'title':'Study notes','pinned':True})).status_code==200
    assert store.conversations()[0]['archived'] is True
    assert (await client.post('/conversations/'+cid+'/rewind',json={'before_message_id':'missing'})).status_code==400
    assert (await client.post('/conversations/'+cid+'/rewind',json={'before_message_id':original[1]['id']})).status_code==400
    rewound=(await client.post('/conversations/'+cid+'/rewind',json={'before_message_id':followup})).json()
    # Retry and Edit continue the same chat: the question and later messages are removed in place.
    assert rewound['id']==cid and rewound['messages']==original[:2]
    assert store.messages(cid)==original[:2] and len(store.conversations())==1
    assert (await client.patch('/conversations/'+cid,json={'title':'Study notes','pinned':True,'archived':False})).status_code==200
    assert Store(tmp_path).conversations()[0]['archived'] is False

async def test_structure_library_and_response_styles(client):
    await configure(client)
    assert (await client.get('/diagrams')).json()==[]
    assert (await client.post('/chat',json={'text':'Explain ethanol','response_style':'concise'})).status_code==200
    assert 'Quick answer mode' in FakeProvider.last_system
    # The step-by-step tutor style was removed.
    assert (await client.post('/chat',json={'text':'Explain ethanol','response_style':'tutor'})).status_code==422
    diagrams=(await client.get('/diagrams')).json()
    assert len(diagrams)==1
    assert diagrams[0]['block']['label']=='Ethanol'
    assert diagrams[0]['block']['smiles']=='CCO'
    assert '<svg' in diagrams[0]['block']['svg']
    assert diagrams[0]['conversation_id']
    assert (await client.post('/chat',json={'text':'Explain ethanol','response_style':'concise'})).status_code==200
    assert 'short, not curt' in FakeProvider.last_system
    assert (await client.post('/chat',json={'text':'Hello','response_style':'unsupported'})).status_code==422

def test_existing_conversation_database_migrates(tmp_path):
    import sqlite3
    db=sqlite3.connect(tmp_path/'chemez.sqlite3')
    db.execute('CREATE TABLE conversations (id TEXT PRIMARY KEY,title TEXT NOT NULL,updated TEXT NOT NULL)')
    db.execute('INSERT INTO conversations VALUES (?,?,?)',('old','Existing chat','2026-01-01'))
    db.commit()
    db.close()
    store=Store(tmp_path)
    assert store.conversations()[0]['title']=='Existing chat'
    assert store.conversations()[0]['pinned'] is False
    assert store.create('New chat')

async def test_auth_and_missing_configuration(client):
    assert (await client.get('/health',headers={'Authorization':''})).status_code==401
    assert (await client.post('/chat',json={'text':'Draw ethanol and explain it'})).status_code==400

async def test_chat_restore_delete_and_no_plaintext_secret(client,tmp_path):
    await configure(client)
    response=await client.post('/chat',json={'text':'Draw ethanol and explain it'})
    events=[json.loads(line) for line in response.text.splitlines()]
    assert [e['type'] for e in events if e['type']!='status']==['start','block','block','done']
    assert any(e.get('message')=='Validating structures and formatting…' for e in events)
    cid=events[0]['conversation_id']
    restored=(await client.get('/conversations/'+cid)).json()
    assert restored['messages'][1]['content'][1]['svg']
    assert len((await client.get('/conversations')).json())==1
    assert b'SECRET' not in (tmp_path/'chemez.sqlite3').read_bytes()
    assert (await client.delete('/conversations/'+cid)).status_code==200
    assert (await client.get('/conversations/'+cid)).status_code==404
    await client.delete('/credentials')
    assert not (await client.get('/config')).json()['has_key']

async def test_formula_clarification_without_provider_guess(client):
    await configure(client)
    response=await client.post('/chat',json={'text':'Draw C2H6O'})
    events=[json.loads(line) for line in response.text.splitlines()]
    assert events[1]['block']['type']=='clarification'
    assert FakeProvider.calls==0

async def test_image_question_is_validated_sent_and_restored(tmp_path):
    seen=[]
    class ImageProvider(FakeProvider):
        async def stream(self,messages,system=None):
            seen.append(messages)
            async for chunk in super().stream(messages,system):yield chunk
    app=create_app(tmp_path,'token',MemoryVault(),ImageProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as image_client:
        await configure(image_client)
        payload={'text':'What molecule is shown?','images':[{'name':'question.png','mime':'image/png','data':'aGVsbG8='}]}
        response=await image_client.post('/chat',json=payload)
        assert response.status_code==200
        cid=json.loads(response.text.splitlines()[0])['conversation_id']
        content=(await image_client.get('/conversations/'+cid)).json()['messages'][0]['content']
        assert content=={**payload,"command":None}
        assert seen[0][-1]['content']=={**payload,"command":None}
        assert (await image_client.post('/chat',json={'text':'','images':[]})).status_code==422
        assert (await image_client.post('/chat',json={'text':'look','images':[{'name':'x','mime':'image/png','data':'not base64!'}]})).status_code==422

async def test_repair_rounds_then_explicit_error(client,tmp_path):
    class BrokenProvider(FakeProvider):
        calls=0
        async def stream(self,*args,**kwargs):
            type(self).calls+=1
            yield '{"blocks":[{"type":"markdown","text":"Valid text"},{"type":"molecule","smiles":"bogus"}]}'
    client.app_instance.state.busy=False
    # Build a fresh app with the broken provider using the same local data store.
    app=create_app(tmp_path/'repair','test-token',MemoryVault(),BrokenProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as other:
        await configure(other)
        events=[json.loads(line) for line in (await other.post('/chat',json={'text':'Draw ethanol and explain it'})).text.splitlines()]
        blocks=[e['block'] for e in events if e['type']=='block']
        assert [b['type'] for b in blocks]==['markdown','error']
        assert BrokenProvider.calls==1+MAX_REPAIRS  # careful mode: up to MAX_REPAIRS repair rounds

@pytest.mark.parametrize('endpoint',['http://remote.example/v1','https://user:pass@example.com','https://example.com?key=secret'])
def test_endpoint_rejects_insecure_or_embedded_credentials(endpoint):
    with pytest.raises(ValueError):ProviderConfig(provider='compatible',model='test',endpoint=endpoint)

def test_saved_keys_live_in_a_private_file_and_survive_restart(tmp_path):
    import stat
    vault=Credentials(tmp_path);vault.set('openai:','SECRET')
    path=tmp_path/'credentials.json'
    if os.name != 'nt':
        assert stat.S_IMODE(path.stat().st_mode)==0o600  # Windows uses ACLs, not POSIX mode bits.
    assert Credentials(tmp_path).get('openai:')=='SECRET'
    vault.delete('openai:')
    assert Credentials(tmp_path).get('openai:') is None
    assert not (tmp_path/'chemez.sqlite3').exists() or b'SECRET' not in (tmp_path/'chemez.sqlite3').read_bytes()

def test_unreadable_key_file_falls_back_without_crashing(tmp_path):
    (tmp_path/'credentials.json').write_text('not json')
    vault=Credentials(tmp_path)
    assert vault.get('openai:') is None and vault.warning
    vault.set('openai:','SECRET')
    assert Credentials(tmp_path).get('openai:')=='SECRET'

def test_history_survives_store_restart(tmp_path):
    store=Store(tmp_path);cid=store.create('Example');store.add(cid,'user','Hello');store.db.close()
    restored=Store(tmp_path)
    assert restored.messages(cid)[0]['content']=='Hello'

async def test_cancellation_closes_provider_and_releases_busy_flag(tmp_path):
    cancelled=asyncio.Event()
    class SlowProvider:
        def __init__(self,*args):pass
        async def stream(self,*args,**kwargs):
            try:
                await asyncio.sleep(30)
                yield 'unused'
            finally:
                cancelled.set()
    app=create_app(tmp_path,'token',MemoryVault(),SlowProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        await configure(client)
        endpoint=next(route.endpoint for route in app.routes if route.path=='/chat')
        class Disconnected:
            async def is_disconnected(self):return True
        from chemez.models import ChatRequest
        response=await endpoint(ChatRequest(text='Explain ethanol'),Disconnected())
        stream=response.body_iterator
        assert json.loads(await anext(stream))['type']=='start'
        assert json.loads(await anext(stream))['type']=='status'
        with pytest.raises(StopAsyncIteration):await anext(stream)
        await asyncio.wait_for(cancelled.wait(),1)
        assert not app.state.busy
        cid=app.state.store.conversations()[0]['id']
        assert len(app.state.store.messages(cid))==1

async def test_busy_chat_rejected_without_saving_duplicate_user(client):
    await configure(client)
    client.app_instance.state.busy=True
    assert (await client.post('/chat',json={'text':'Draw ethanol and explain it'})).status_code==409
    assert (await client.get('/conversations')).json()==[]

async def test_provider_failure_becomes_restorable_error(tmp_path):
    from chemez.providers import ProviderError
    class FailedProvider:
        def __init__(self,*args):pass
        async def stream(self,*args,**kwargs):
            raise ProviderError('Provider returned HTTP 429.')
            yield ''
    app=create_app(tmp_path,'token',MemoryVault(),FailedProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        await configure(client)
        events=[json.loads(line) for line in (await client.post('/chat',json={'text':'Draw ethanol and explain it'})).text.splitlines()]
        block=next(e['block'] for e in events if e['type']=='block')
        assert block['type']=='error' and '429' in block['text']
        assert events[-1]['type']=='done'
        assert not app.state.busy

async def test_bad_repair_retains_original_valid_blocks(tmp_path):
    class RepairProvider:
        calls=0
        def __init__(self,*args):pass
        async def stream(self,*args,**kwargs):
            type(self).calls+=1
            if self.calls==1:
                yield '{"blocks":[{"type":"markdown","text":"Keep this explanation"},{"type":"molecule","smiles":"bogus"}]}'
            else:
                yield 'malformed'
    app=create_app(tmp_path,'token',MemoryVault(),RepairProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        await configure(client)
        events=[json.loads(line) for line in (await client.post('/chat',json={'text':'Draw ethanol and explain it'})).text.splitlines()]
        blocks=[event['block'] for event in events if event['type']=='block']
        assert blocks[0]['text']=='Keep this explanation'
        assert blocks[1]['type']=='error'
        assert RepairProvider.calls==1+MAX_REPAIRS  # careful mode: up to MAX_REPAIRS repair rounds

def test_explicit_session_only_never_writes_keys(monkeypatch,tmp_path):
    monkeypatch.setenv('CHEMEZ_SESSION_ONLY','1')
    vault=Credentials(tmp_path);vault.set('test','SECRET')
    assert vault.get('test')=='SECRET'
    assert vault.warning.startswith('Session-only')
    assert not (tmp_path/'credentials.json').exists()

async def test_plain_prose_survives_a_failed_format_repair(tmp_path):
    prose='Benzene has six carbon atoms in a planar ring. Its two Kekulé contributors describe one delocalized aromatic structure.'
    class ProseProvider:
        calls=0
        def __init__(self,*args):pass
        async def stream(self,*args,**kwargs):
            type(self).calls+=1
            yield prose
    app=create_app(tmp_path,'token',MemoryVault(),ProseProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        await configure(client)
        events=[json.loads(line) for line in (await client.post('/chat',json={'text':'Benzene, and resonating structures.'})).text.splitlines()]
        blocks=[event['block'] for event in events if event['type']=='block']
        assert blocks[0]['type']=='markdown' and blocks[0]['text']==prose
        assert blocks[1]['type']=='error' and 'diagrams' in blocks[1]['text']
        assert ProseProvider.calls==1+MAX_REPAIRS  # careful mode: up to MAX_REPAIRS repair rounds
        cid=events[0]['conversation_id']
        assert (await client.get('/conversations/'+cid)).json()['messages'][1]['content']==blocks

async def test_discovery_uses_supplied_or_existing_gemini_key_only(tmp_path):
    seen=[]
    class DiscoveryProvider:
        def __init__(self,config,key):seen.append((config,key))
        async def models(self):return [{'id':'text-model','label':'Text model'}]
    vault=MemoryVault()
    app=create_app(tmp_path,'token',vault,DiscoveryProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        assert (await client.post('/config/models',json={})).status_code==400
        response=await client.post('/config/models',json={'api_key':'NEW-SECRET'})
        assert response.json()=={'models':[{'id':'text-model','label':'Text model'}]}
        assert vault.values=={}
        vault.set('gemini:','SAVED-SECRET')
        assert (await client.post('/config/models',json={})).status_code==200
        assert seen[-1][1]=='SAVED-SECRET'
        assert 'SECRET' not in response.text
        assert (await client.post('/config/models',json={},headers={'Authorization':''})).status_code==401

async def test_connection_checks_real_answer_format(tmp_path):
    seen=[]
    class PlainTextProvider:
        def __init__(self,*args):pass
        async def stream(self,messages,**kwargs):
            seen.append(kwargs)
            yield 'Hello'
    vault=MemoryVault();vault.set('gemini:','SECRET')
    store=Store(tmp_path);store.save_config({'provider':'gemini','model':'test','endpoint':''})
    app=create_app(tmp_path,'token',vault,PlainTextProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        response=await client.post('/config/test')
        assert response.status_code==502
        assert 'did not produce a valid ChemEZ answer' in response.text
        assert seen==[{}]

async def test_local_chat_and_model_discovery_need_no_credentials(tmp_path):
    class NoSecrets:
        def get(self,*args):raise AssertionError('Local mode must not access credentials')
        def set(self,*args):raise AssertionError('Local mode must not save credentials')
    class LocalProvider(FakeProvider):
        def __init__(self,config,key):assert key==''
        async def models(self):return [{'id':'local:small','label':'local:small'}]
    app=create_app(tmp_path,'token',NoSecrets(),LocalProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        result=await client.put('/config',json={'provider':'ollama','model':'local:small'})
        assert result.status_code==200
        assert result.json()['ready'] and not result.json()['has_key']
        assert result.json()['warning']==''
        assert (await client.post('/config/models',json={'provider':'ollama'})).json()['models'][0]['id']=='local:small'
        assert (await client.post('/config/test')).status_code==200
        response=await client.post('/chat',json={'text':'Draw ethanol and explain it'})
        assert response.status_code==200
        assert 'Ethanol' in response.text and '<svg' in response.text

@pytest.mark.parametrize('model,endpoint',[
    ('large:cloud',''),('local','https://ollama.com/v1'),('local','http://127.0.0.1:11434/v1/evil'),
])
def test_local_provider_refuses_cloud_models_and_remote_endpoints(model,endpoint):
    with pytest.raises(ValueError):ProviderConfig(provider='ollama',model=model,endpoint=endpoint)

@pytest.mark.parametrize('endpoint',['https://gateway.example/v1','http://192.168.1.1/v1',''])
def test_keyless_gateway_cannot_target_remote_endpoints(endpoint):
    with pytest.raises(ValueError):ProviderConfig(provider='compatible',model='local',endpoint=endpoint,auth_mode='none')

async def test_keyless_gateway_config_and_discovery_without_vault(tmp_path):
    class NoSecrets:
        def get(self,*args):raise AssertionError('Keyless gateway must not access credentials')
        def set(self,*args):raise AssertionError('Keyless gateway must not save credentials')
    class Gateway(FakeProvider):
        def __init__(self,config,key):assert key=='' and config['endpoint']=='http://localhost:4000/v1'
        async def models(self):return [{'id':'chem-local','label':'chem-local'}]
    app=create_app(tmp_path,'token',NoSecrets(),Gateway)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer token'}) as client:
        config={'provider':'compatible','model':'chem-local','endpoint':'http://localhost:4000/v1','auth_mode':'none'}
        result=await client.put('/config',json=config)
        assert result.status_code==200 and result.json()['ready'] and not result.json()['has_key']
        request={k:v for k,v in config.items() if k!='model'}
        assert (await client.post('/config/models',json=request)).status_code==200
        assert (await client.post('/config/test')).status_code==200

async def test_health_checks_database_and_fails_without_exposing_errors(client):
    response=await client.get('/health')
    assert response.json()['checks']['database'] is True
    client.app_instance.state.store.db.close()
    response=await client.get('/health')
    assert response.status_code==503
    assert response.json()=={'ok':False,'checks':{'database':False}}
    assert 'sqlite' not in response.text.lower()

async def test_saved_key_badges_survive_restart_and_store_warning_clears(tmp_path):
    # Keys saved for several services earlier must show as saved after a restart,
    # not only the active service whose key was read this session.
    vault=MemoryVault();vault.warning=''
    vault.values={'gemini:':'G','openai:':'O'}
    store=Store(tmp_path);store.save_config({'provider':'openai','model':'test','endpoint':''})
    app=create_app(tmp_path,'test-token',vault,FakeProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as client:
        reads=[]
        original=vault.get
        vault.get=lambda name:(reads.append(name),original(name))[1]
        # Gemini's key was saved in an earlier session; ChemEZ remembers that by name only.
        app.state.store.save_config(['gemini:'],3)
        state=(await client.get('/config')).json()
        assert state['saved_keys']['gemini'] and state['saved_keys']['openai'] and not state['saved_keys']['anthropic']
        # Only the active key is read: one Keychain access, so at most one macOS prompt.
        assert reads==['openai:']
        # A timed-out key read leaves a warning; the next successful read clears it.
        vault.warning='Saved keys could not be read in time. Enter your key for this session.'
        assert (await client.get('/config')).json()['warning']==''

async def test_valid_first_answer_survives_a_broken_style_retry(tmp_path):
    class StyleThenBroken:
        calls=0
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            type(self).calls+=1
            if type(self).calls==1:
                # Valid, but far too long for concise mode, which triggers a style repair.
                yield json.dumps({'blocks':[{'type':'markdown','text':'Ethanol is an alcohol. '*120},{'type':'molecule','label':'Ethanol','smiles':'CCO','formula':'C2H6O'}]})
            else:
                # Same number of valid blocks as the first answer, plus one broken structure.
                yield json.dumps({'blocks':[{'type':'markdown','text':'Short.'},{'type':'molecule','label':'Propanol','smiles':'CCCO'},{'type':'molecule','label':'Broken','smiles':'not-a-smiles'}]})
    app=create_app(tmp_path,'test-token',MemoryVault(),StyleThenBroken)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as client:
        await configure(client)
        response=await client.post('/chat',json={'text':'Explain ethanol','response_style':'concise'})
        blocks=[json.loads(line)['block'] for line in response.text.splitlines() if json.loads(line)['type']=='block']
    assert StyleThenBroken.calls==2
    assert any(block['type']=='molecule' and block['label']=='Ethanol' for block in blocks)
    assert not any('Propanol' in json.dumps(block) for block in blocks)

async def test_learner_level_shapes_the_instructions(client):
    await configure(client)
    await client.post('/chat',json={'text':'Explain ethanol','level':'school'})
    assert 'high school' in FakeProvider.last_system and 'define each technical term' in FakeProvider.last_system
    await client.post('/chat',json={'text':'Explain ethanol','level':'graduate'})
    assert 'graduate / professional' in FakeProvider.last_system
    await client.post('/chat',json={'text':'Explain ethanol'})
    assert 'university chemistry' in FakeProvider.last_system and 'undergraduate tutor' not in FakeProvider.last_system
    assert (await client.post('/chat',json={'text':'Explain ethanol','level':'expert'})).status_code==422

def test_followups_prefer_model_suggestions_then_fill_from_drawings():
    from chemez.followups import suggest_followups
    blocks=[{'type':'reaction','caption':'Kolbe–Schmitt','products':[{'iupac_name':'salicylic acid'}]}]
    assert suggest_followups(blocks,['Why is high pressure needed','<script>bad</script>'])==['Why is high pressure needed?','What is the mechanism of Kolbe–Schmitt?','Why are these reagents and conditions needed?']
    assert suggest_followups([{'type':'markdown','text':'Hi'}],None)==[]

async def test_chat_returns_and_stores_followups(client):
    await configure(client)
    events=[json.loads(line) for line in (await client.post('/chat',json={'text':'Draw ethanol and explain it'})).text.splitlines()]
    done=[e for e in events if e['type']=='done'][0]
    assert done['follow_ups'] and all(q.endswith('?') for q in done['follow_ups'])
    assert all(e['block']['type']!='followups' for e in events if e['type']=='block')
    saved=(await client.get('/conversations/'+events[0]['conversation_id'])).json()['messages'][-1]
    assert saved['follow_ups']==done['follow_ups']

async def test_legacy_butane_identity_is_one_molecule_through_restoration_worker(client):
    store=client.app_instance.state.store
    cid=store.create('Draw butane')
    store.add(cid,'user','Draw butane')
    store.add(cid,'assistant',[{'id':'old-butane','type':'reaction','reactants':[{'smiles':'CCCC','label':'Butane','svg':'old'}],'products':[{'smiles':'CCCC','label':'Butane','svg':'old'}],'reagents':'None','conditions':'None','caption':'Structure of Butane','svg':'old arrow'}])
    response=await client.get('/conversations/'+cid)
    assert response.status_code==200
    blocks=response.json()['messages'][1]['content']
    assert len(blocks)==1 and blocks[0]['type']=='molecule'
    assert blocks[0]['id']=='old-butane' and blocks[0]['formula']=='C4H10'
    assert blocks[0]['svg']!='old arrow'

async def chat_blocks(client,text):
    lines=[json.loads(line) for line in (await client.post('/chat',json={'text':text})).text.splitlines()]
    return [line['block'] for line in lines if line['type']=='block'],next(line for line in lines if line['type']=='done')

async def test_named_compound_gets_verified_card_and_model_description(client):
    await configure(client)
    blocks,done=await chat_blocks(client,'phosgene')
    card=next(b for b in blocks if b['type']=='molecule')
    assert card['smiles']=='O=C(Cl)Cl' and ['Formula','CCl2O'] in card['properties']
    assert ['Boiling point','8.2 °C'] in card['properties']
    assert blocks[0]['type']=='markdown'  # the model's one-line description, never a structure

async def test_structure_question_draws_without_properties(client):
    await configure(client)
    blocks,_=await chat_blocks(client,'Phosgene structure')
    card=next(b for b in blocks if b['type']=='molecule')
    assert card['smiles']=='O=C(Cl)Cl' and 'properties' not in card

async def test_misspelled_name_is_corrected_and_said(client):
    await configure(client)
    blocks,_=await chat_blocks(client,'fosgene')
    card=next(b for b in blocks if b['type']=='molecule')
    assert card['smiles']=='O=C(Cl)Cl' and card['interpreted']=='Showing Phosgene'

async def test_comparison_and_ambiguous_names(client):
    await configure(client)
    blocks,_=await chat_blocks(client,'chloroform vs phosgene')
    assert [b['smiles'] for b in blocks if b['type']=='molecule']==['ClC(Cl)Cl','O=C(Cl)Cl']
    blocks,_=await chat_blocks(client,'xylene')
    assert blocks[0]['type']=='clarification' and 'p-xylene' in blocks[0]['options']

async def test_free_question_gets_verified_structures_in_prompt(client):
    await configure(client)
    await chat_blocks(client,'Why does phosgene react with water?')
    assert 'phosgene = ClC(Cl)=O' in FakeProvider.last_system

def test_one_panel_mechanism_is_incomplete():
    from chemez.styles import diagram_issue
    single=[{'type':'mechanism','steps':[{'smiles':'ClCl.[C-]#[O+]','arrows':[{'tail':[0],'head':[0,1]}]}]}]
    assert 'complete' in diagram_issue(single,'What is the mechanism of phosgene synthesis?')
    full=[{'type':'mechanism','steps':[{'smiles':'X','arrows':[{'tail':[0],'head':[1]}]},{'smiles':'Y','arrows':[]}]}]
    assert diagram_issue(full,'What is the mechanism of phosgene synthesis?') is None


def test_mechanism_mode_accepts_resonance_answer():
    from chemez.styles import style_issue
    blocks=[{'type':'markdown','text':'Benzene is delocalized.'},{'type':'resonance','contributors':[]}]
    assert style_issue(blocks,'mechanism','Show me mechanism in detail of resonating structures of benzene step by step') is None


def test_resonance_series_keeps_atom_order():
    from chemez.chemistry import resonance_series
    assert resonance_series('Cc1ccccc1') == ['CC1=CC=CC=C1', 'CC1C=CC=CC=1']
    assert resonance_series('CC(=O)[O-]') == ['CC([O-])=O', 'CC(=O)[O-]']
    assert len(resonance_series('[O-]c1ccccc1')) == 4


def test_benzene_vs_toluene_resonance_splits_into_two_drawn_blocks():
    from chemez.app import prepare_answer
    import json
    arrows=[{'tail':[i,(i+1)%6],'head':[(i+1)%6]} for i in range(6)]
    answer={'blocks':[{'type':'resonance','caption':'Benzene vs toluene','contributors':[{'smiles':'c1ccccc1','label':'Benzene','arrows':arrows},{'smiles':'Cc1ccccc1','label':'Toluene','arrows':arrows}]}]}
    blocks,failed=prepare_answer(json.dumps(answer))
    assert not failed
    assert [b['type'] for b in blocks]==['resonance','resonance']
    assert [b['caption'] for b in blocks]==['Benzene resonance contributors','Resonance in Toluene']
    assert all(not c.get('limitation') for b in blocks for c in b['contributors'])
    assert blocks[1]['contributors'][0]['arrows']


def test_bad_resonance_arrows_and_order_are_regenerated():
    from chemez.app import prepare_answer
    import json
    answer={'blocks':[{'type':'resonance','contributors':[{'smiles':'CC(=O)[O-]','label':'A','arrows':[{'tail':[0],'head':[1]}]},{'smiles':'[O-]C(C)=O','label':'B'}]}]}
    blocks,failed=prepare_answer(json.dumps(answer))
    assert not failed and blocks[0]['type']=='resonance'


def test_named_mechanism_shortcut_draws_verified_panels():
    from chemez.app import prepare_answer
    import json
    for name,reactants in [('SN2',['CC(Br)CC','[OH-]']),('SN1',['CC(C)(C)Br','O']),('E2',['CC(Br)CC','[O-]CC']),('Fischer esterification',['CC(=O)O','CCO'])]:
        blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'mechanism','name':name,'reactants':reactants}]}))
        assert not failed, (name,blocks)
        steps=blocks[0]['steps']
        assert len(steps)>=2 and all(s['svg'] for s in steps) and not steps[-1]['arrows']


def test_unreadable_esterification_panels_are_rebuilt():
    from chemez.app import prepare_answer
    import json
    answer={'blocks':[{'type':'reaction','reactants':[{'smiles':'CC(=O)O','label':'Acetic acid'},{'smiles':'CCO','label':'Ethanol'}],'products':[{'smiles':'CC(=O)OCC','label':'Ethyl acetate'}],'reagents':'H2SO4','caption':'Acid-catalysed esterification'},
        {'type':'mechanism','steps':[{'smiles':'CC(=O)O.CCO.H+','label':'Protonation','arrows':[{'tail':[0,1],'head':[1]}]},{'smiles':'CC(=O+H)O.CCO','label':'Attack','arrows':[]}]}]}
    blocks,failed=prepare_answer(json.dumps(answer))
    assert not failed and blocks[1]['type']=='mechanism' and len(blocks[1]['steps'])==7


def test_mode_drawing_rules():
    from chemez.styles import diagram_issue, style_issue
    long_q='Explain in detail the resonance of phenoxide and how it compares with acetate and with nitrobenzene, and what that means for acidity across these compounds overall please'
    assert diagram_issue([{'type':'markdown','text':'x'}],long_q,'concise') is None
    # Resonance drawings are now chosen after the answer, so the question alone no longer demands one.
    assert diagram_issue([{'type':'markdown','text':'x'}],long_q,'balanced') is None
    assert 'brief' in style_issue([{'type':'markdown','text':'word '*320},{'type':'mechanism','steps':[]}],'mechanism','SN2 mechanism')


def test_named_species_replaces_wrong_resonance_structure():
    from chemez.app import prepare_answer
    import json
    answer={'blocks':[{'type':'resonance','caption':'Resonance in the phenoxide ion','contributors':[{'smiles':'Oc1ccccc1','label':'Phenoxide 1','arrows':[{'tail':[1],'head':[2]}]},{'smiles':'O=c1ccccc1','label':'Phenoxide 2'}]}]}
    blocks,failed=prepare_answer(json.dumps(answer))
    assert not failed and blocks[0]['contributors'][1]['smiles']=='O=C1[CH-]C=CC=C1'


def test_mechanism_rebuilt_from_structures_and_named_reagent():
    from chemez.app import prepare_answer
    import json
    answer={'blocks':[{'type':'mechanism','steps':[{'smiles':'CC(C)(C)Br','label':'tert-butyl bromide','arrows':[]},{'smiles':'CC(C)(C)+ O','label':'carbocation and water','arrows':[{'tail':[0],'head':[1]}]},{'smiles':'CC(C)(C)O','label':'alcohol','arrows':[]}]}]}
    blocks,failed=prepare_answer(json.dumps(answer))
    assert not failed and blocks[0]['steps'][1]['smiles']=='C[C+](C)C.[Br-].O'


def test_versus_command_is_split_from_question():
    from chemez.styles import split_command
    assert split_command('/versus phenol vs ethanol acidity')==('versus','phenol vs ethanol acidity')
    assert split_command('/other thing')==(None,'/other thing')


def test_all_slash_commands_are_known():
    from chemez.styles import split_command, COMMANDS
    assert set(COMMANDS)=={'versus','stepbystep','synthesis','practice','nomenclature','lab','calc','spectra'}
    assert split_command('/calc 2 g NaOH in 250 mL, molarity?')==('calc','2 g NaOH in 250 mL, molarity?')


async def test_each_slash_command_reaches_the_model_and_passes_checks(tmp_path):
    answers={
        'stepbystep':{'blocks':[{'type':'markdown','text':'1. Molar mass of NaOH is 40.00 g/mol.\n2. $n = 10 / 40.00 = 0.25$ mol.\n\n**Answer:** 0.25 mol'}]},
        'synthesis':{'blocks':[{'type':'reaction','reactants':[{'smiles':'c1ccccc1','label':'Benzene'}],'products':[{'smiles':'Cc1ccccc1','label':'Toluene'}],'reagents':'CH3Cl, AlCl3','caption':'Friedel–Crafts methylation'},{'type':'reaction','reactants':[{'smiles':'Cc1ccccc1','label':'Toluene'}],'products':[{'smiles':'OC(=O)c1ccccc1','label':'Benzoic acid'}],'reagents':'KMnO4','conditions':'heat, then H3O+','caption':'Side-chain oxidation'}]},
        'practice':{'blocks':[{'type':'clarification','question':'Which substrate reacts fastest by SN2?','options':['CH3Br','(CH3)3CBr','(CH3)2CHBr','CH3CH2Br']}]},
        'nomenclature':{'blocks':[{'type':'molecule','smiles':'CC(C)CC(=O)O','label':'3-Methylbutanoic acid','formula':'C5H10O2','iupac_name':'3-methylbutanoic acid'},{'type':'markdown','text':'1. Parent: butanoic acid. 2. Methyl at C3.'}]},
        'lab':{'blocks':[{'type':'markdown','text':'**Reagents** salicylic acid, acetic anhydride, H3PO4. **Hazards** acetic anhydride is corrosive.'}]},
        'calc':{'blocks':[{'type':'markdown','text':'1. $[H^+] = 0.01$ M\n2. pH $= -\\log 0.01 = 2.00$'}]},
        'spectra':{'blocks':[{'type':'molecule','smiles':'CCOC(C)=O','label':'Ethyl acetate','formula':'C4H8O2'},{'type':'markdown','text':'**IR**\n\n| cm⁻¹ | Bond |\n|---|---|\n| 1740 | C=O |\n\n**¹H NMR**\n\n| δ | H | m |\n|---|---|---|\n| 4.1 | 2H | q |\n| 2.0 | 3H | s |\n| 1.2 | 3H | t |\n\n**¹³C NMR**\n\n| δ | C |\n|---|---|\n| 171 | C=O |\n| 60 | OCH2 |\n| 21 | CH3 |\n| 14 | CH3 |\n\n**MS**\n\n| m/z | Ion |\n|---|---|\n| 88 | M⁺ |'}]},
    }
    class CommandProvider(FakeProvider):
        async def stream(self,messages,system=None):
            type(self).last_system=system
            command=next(name for name in answers if f'/{name}' in system)
            yield json.dumps(answers[command])
    questions={'stepbystep':'how many moles are in 10 g of NaOH','synthesis':'benzene to benzoic acid','practice':'SN2 reactions','nomenclature':'CC(C)CC(=O)O','lab':'aspirin from salicylic acid','calc':'pH of 0.01 M HCl','spectra':'ethyl acetate'}
    app=create_app(tmp_path,'test-token',MemoryVault(),CommandProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-token'}) as client:
        await configure(client)
        for name,question in questions.items():
            response=await client.post('/chat',json={'text':f'/{name} {question}','command':name,'response_style':'balanced'})
            assert response.status_code==200
            assert f'/{name}' in CommandProvider.last_system
            assert '"type": "error"' not in response.text and '"type":"error"' not in response.text, (name,response.text[-600:])


def test_split_table_rows_are_joined_and_commands_checked():
    from chemez.app import prepare_answer
    from chemez.styles import command_issue
    import json
    blocks,failed=prepare_answer(json.dumps({'blocks':[{'type':'markdown','text':'| A | B |'},{'type':'markdown','text':'|---|---|'},{'type':'markdown','text':'| 1 | 2 |'}]}))
    assert not failed and len(blocks)==1 and blocks[0]['text'].count('\n')==2
    assert 'reaction block' in command_issue('synthesis',[{'type':'markdown','text':'Use KMnO4.'}])
    assert command_issue('spectra',[{'type':'molecule'},{'type':'markdown','text':'| IR | 1740 |'}]) is None


def test_textbook_routes_are_found_and_drawable():
    from chemez import routes
    from chemez.app import prepare_answer
    from chemez.styles import command_issue
    import json
    for question in ['benzene to benzoic acid','ethanol to ethyl acetate','aniline from benzene','toluene into benzoic acid']:
        route=routes.find(question)
        assert route, question
        blocks,failed=prepare_answer(json.dumps({'blocks':routes.blocks(route)}))
        assert not failed and all(b['type']=='reaction' for b in blocks), (question,blocks)
    assert routes.find('benzene to cholesterol') is None
    assert command_issue('stepbystep',[{'type':'markdown','text':'1. M = 40\n5. Calculate the resulting number of moles.'}])
    assert command_issue('stepbystep',[{'type':'markdown','text':'1. M = 40\n\n**Answer:** 0.25 mol'}]) is None


def test_spectra_checked_against_structure_counts():
    from chemez.nmr import facts, issue
    from chemez.styles import command_issue
    f=facts('CCOC(C)=O')
    assert (f['carbons'],f['hydrogens'],f['mass'])==(4,8,88) and 'distinct carbon' in f['text']
    good='**IR**\n\n| cm⁻¹ | Bond |\n|---|---|\n| 1740 | C=O |\n\n**¹H NMR**\n\n| δ | H | m |\n|---|---|---|\n| 4.1 | 2H | q |\n| 2.0 | 3H | s |\n| 1.2 | 3H | t |\n\n**¹³C NMR**\n\n| δ | C |\n|---|---|\n| 171 | C=O |\n| 60 | OCH2 |\n| 21 | CH3 |\n| 14 | CH3 |\n\n**MS**\n\n| m/z | Ion |\n|---|---|\n| 88 | M⁺ |'
    assert issue('CCOC(C)=O',good) is None
    bad=good.replace('| 14 | CH3 |\n','').replace('| 1.2 | 3H | t |','| 1.2 | 2H | t |').replace('| 88 | M⁺','| 102 | M⁺')
    message=issue('CCOC(C)=O',bad)
    assert '3 signals' in message and '7 H' in message and 'must be 88' in message
    assert command_issue('spectra',[{'type':'molecule','smiles':'CCOC(C)=O'},{'type':'markdown','text':bad}])
    assert '294 is impossible' in issue('CC(C)=O','**IR**\n| 1715 | C=O |\n\n**¹H NMR**\n\n| 2.1 | 6H | s |\n\n**¹³C NMR**\n\n| 209 | C=O |\n| 294 | CH3 |\n\n**MS**\n| 58 | M⁺ |')
    assert '¹³C NMR table is missing' in issue('CC(=O)O','**IR** x **¹H NMR** x **MS** x')


def test_c13_predictions_from_measured_data():
    import pytest
    from chemez import c13, nmr
    if not c13.available():
        pytest.skip('¹³C table not built')
    shifts=lambda smiles:sorted(d for _,_,d,_,_ in c13.predict(smiles))
    for smiles,expected in [('CCC(=O)O',[8.9,27.6,181.5]),('CCOC(C)=O',[14.2,21.0,60.5,171.1]),('CC(C)=O',[30.8,206.7])]:
        assert all(abs(a-b)<=3 for a,b in zip(shifts(smiles),expected)),(smiles,shifts(smiles))
    section=nmr.carbon_section('CCC(=O)O')
    replaced=nmr.replace_carbon_section('**IR**\n\n| 1715 | C=O |\n\n**¹³C NMR**\n\n| 120 | C=O |\n\n**MS**\n\n| 74 | M⁺ |',section)
    assert '| 120 |' not in replaced and 'NMRShiftDB2' in replaced and '**MS**' in replaced


def test_rank_prefers_strong_chat_models():
    from chemez.autopick import rank
    ids=['nvidia/nemotron-3.5-bolt-e4b','nvidia/nv-embedqa-e5-v5','z-ai/glm-5.3','nvidia/nemotron-3-ultra-550b-a55b','meta/llama-3.2-11b-vision-instruct','google/diffusiongemma-26b-a4b-it']
    ranked=rank(ids)
    assert ranked[0]=='nvidia/nemotron-3-ultra-550b-a55b' and ranked[1]=='z-ai/glm-5.3'
    assert 'nvidia/nv-embedqa-e5-v5' not in ranked and 'google/diffusiongemma-26b-a4b-it' not in ranked


async def test_autopick_and_fallback_skip_silent_models(monkeypatch):
    import asyncio
    from chemez import autopick
    monkeypatch.setattr(autopick,'STALL_SECONDS',0.2)
    monkeypatch.setattr(autopick,'PROBE_SECONDS',0.2)
    class Fake:
        def __init__(self,config,key):self.model=config['model']
        async def models(self):return [{'id':m} for m in ['nvidia/nemotron-3-ultra-550b-a55b','z-ai/glm-5.3','nvidia/nemotron-3.5-bolt-e4b']]
        async def stream(self,messages,system=None):
            if 'ultra' in self.model:
                await asyncio.sleep(5)
            yield 'ok from '+self.model
    best,backups=await autopick.pick({'provider':'compatible','model':'auto'},'k',Fake)
    assert best=='z-ai/glm-5.3' and backups==['nvidia/nemotron-3.5-bolt-e4b']
    switches=[]
    chunks=[c async for c in autopick.stream_with_fallback({'provider':'compatible','model':'nvidia/nemotron-3-ultra-550b-a55b','fallbacks':['z-ai/glm-5.3']},'k',Fake,[],'s',lambda a,b:switches.append((a,b)))]
    assert chunks==['ok from z-ai/glm-5.3'] and switches==[('nvidia/nemotron-3-ultra-550b-a55b','z-ai/glm-5.3'),(None,'z-ai/glm-5.3')]


async def test_drawing_follows_the_answer(tmp_path,monkeypatch):
    monkeypatch.setenv('CHEMEZ_MODEL_DECISIONS','1')
    class DecidingProvider:
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            text=messages[-1]['content']['text']
            if text.startswith('A chemistry tutor answered'):
                yield json.dumps({'draw':'molecules','molecules':[{'name':'phenoxide','smiles':'[O-]c1ccccc1'}]})
            else:
                yield json.dumps({'blocks':[{'type':'markdown','text':'The major contributor has the charge on oxygen.'},
                                            {'type':'resonance','caption':'Phenoxide','contributors':[{'smiles':'[O-]c1ccccc1','label':'Phenoxide'}],'hybrid':True}]})
    app=create_app(tmp_path,'t',MemoryVault(),DecidingProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer t'}) as client:
        await configure(client)
        lines=[json.loads(l) for l in (await client.post('/chat',json={'text':'Which phenoxide resonance contributor matters most?'})).text.splitlines()]
    blocks=[l['block'] for l in lines if l['type']=='block']
    assert [b['type'] for b in blocks]==['markdown','molecule']


async def test_small_talk_is_not_a_compound_lookup(tmp_path,monkeypatch):
    monkeypatch.setenv('CHEMEZ_MODEL_DECISIONS','1')
    class Provider:
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            text=messages[-1]['content']['text']
            if text.startswith('Is "'):
                yield 'NO'
            elif text.startswith('A chemistry tutor answered'):
                yield '{"draw":"none"}'
            else:
                yield json.dumps({'blocks':[{'type':'markdown','text':'Not much! Ask me any chemistry question.'}]})
    app=create_app(tmp_path,'t',MemoryVault(),Provider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer t'}) as client:
        await configure(client)
        lines=[json.loads(l) for l in (await client.post('/chat',json={'text':"what's up?"})).text.splitlines()]
    assert [l['block']['type'] for l in lines if l['type']=='block']==['markdown']


async def test_chat_gets_a_short_title_unless_renamed(tmp_path,monkeypatch):
    monkeypatch.setenv('CHEMEZ_MODEL_DECISIONS','1')
    class Provider:
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            text=messages[-1]['content']['text']
            if text.startswith('Name this chemistry chat'):
                yield '"water pH, explained."'
            elif text.startswith('A chemistry tutor answered'):
                yield '{"draw":"none"}'
            else:
                yield json.dumps({'blocks':[{'type':'markdown','text':'Pure water at 25 °C has pH 7.'}]})
    app=create_app(tmp_path,'t',MemoryVault(),Provider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer t'}) as client:
        await configure(client)
        lines=[json.loads(l) for l in (await client.post('/chat',json={'text':'What is the pH of water? give a reference'})).text.splitlines()]
        cid=lines[0]['conversation_id']
        assert (await client.get('/conversations')).json()[0]['title']=='Water pH Explained'
        await client.patch(f'/conversations/{cid}',json={'title':'My water notes','pinned':False})
        app.state.store.auto_title(cid,'Something Else')
        assert (await client.get('/conversations')).json()[0]['title']=='My water notes'


async def test_suggestion_follows_mode_and_command(tmp_path):
    seen=[]
    class Provider:
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            seen.append(messages[-1]['content']['text'])
            yield '"/versus Grignard vs organolithium reagents"'
    app=create_app(tmp_path,'t',MemoryVault(),Provider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer t'}) as client:
        await configure(client)
        store=app.state.store
        cid=store.create('Grignard')
        store.add(cid,'user',{'text':'Grignard reaction?','images':[]})
        store.add(cid,'assistant',[{'id':'a','type':'markdown','text':'A Grignard reagent attacks carbonyls.'}])
        answer=(await client.post(f'/conversations/{cid}/suggest',json={'mode':'concise','command':'versus'})).json()
    assert answer['question']=='Grignard vs organolithium reagents'
    assert '/versus' in seen[-1] and 'Grignard reagent attacks' in seen[-1]

@pytest.mark.parametrize('text',['{"blocks":[{"type":"reaction","caption":"Grignard"}]}','{"blocks":[','["What next?"]','<b>What next?</b>','```json\n{}\n```','x'*141])
def test_next_question_rejects_serialized_answers(text):
    from chemez.followups import clean_next_question
    assert clean_next_question(text)==''


def test_next_question_preserves_claude_command_and_plain_question_behavior():
    from chemez.followups import clean_next_question
    assert clean_next_question('"/versus Grignard vs organolithium reagents"')=='Grignard vs organolithium reagents'
    assert clean_next_question('{"question":"Why does acetone react?"}')=='Why does acetone react?'
    assert clean_next_question('Why is [NH4+] acidic?')=='Why is [NH4+] acidic?'


@pytest.mark.parametrize('selected',[None,'practice'])
async def test_command_contract_requires_explicit_selection(tmp_path,monkeypatch,selected):
    monkeypatch.setenv('CHEMEZ_MODEL_DECISIONS','0')
    seen=[]
    class Provider:
        def __init__(self,*args):pass
        async def stream(self,messages,system=None):
            seen.append(system)
            block={'type':'clarification','question':'Which statement describes entropy?','options':['A','B','C','D']} if '/practice. Do not answer' in system else {'type':'markdown','text':'Entropy describes the number of accessible microscopic states.'}
            yield json.dumps({'blocks':[block]})
    app=create_app(tmp_path,'t',MemoryVault(),Provider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer t'}) as client:
        await configure(client)
        response=await client.post('/chat',json={'text':'/practice entropy','command':selected})
        assert response.status_code==200
    assert bool(any('/practice. Do not answer' in system for system in seen))==bool(selected)

async def test_condensed_nomenclature_is_single_molecule(client):
    await configure(client)
    response=await client.post('/chat',json={'text':'/nomenclature ch2=chch2cooh or something close','command':'nomenclature'})
    events=[json.loads(line) for line in response.text.splitlines()]
    blocks=[e['block'] for e in events if e['type']=='block']
    assert len(blocks)==1 and blocks[0]['type']=='molecule'
    assert blocks[0]['formula']=='C4H6O2'
    assert blocks[0]['iupac_name']=='but-3-enoic acid'
    assert blocks[0]['interpreted']
    assert FakeProvider.calls==0

async def test_general_question_reaches_provider_with_inclusive_policy(client):
    await configure(client)
    await client.post('/chat',json={'text':'how many bones in human body'})
    assert FakeProvider.calls>=1
    assert 'never refuse merely because a question is not chemistry' in FakeProvider.last_system
    assert 'Never use an em dash' in FakeProvider.last_system
