import json
import asyncio
import pytest
from httpx import AsyncClient, ASGITransport
from chemez.app import create_app
from chemez.storage import Store
from chemez.providers import ProviderError
from chemez.vision import interpret_images, VISION_SYSTEM
from test_app import MemoryVault

class SplitProvider:
    calls=[]
    fail=False
    def __init__(self,config,key): self.config,self.key=config,key
    def image_support(self): return 'supported'
    async def models(self):
        type(self).calls.append(('models',self.key))
        return [{'id':'vision','label':'vision'}]
    async def stream(self,messages,system=None):
        type(self).calls.append((self.config['model'],self.key,messages))
        if self.config['model']=='vision':
            assert system==VISION_SYSTEM
            assert messages[0]['content']['images']
            if self.fail: raise ProviderError('Image service unavailable')
            yield 'Visible: ethanol; terminal OH. Stereochemistry not indicated.'
        else:
            assert not any(isinstance(m['content'],dict) and m['content'].get('images') for m in messages)
            yield json.dumps({'blocks':[{'type':'markdown','text':'Ethanol is a primary alcohol, C2H6O.'}]})

@pytest.fixture
async def dual(tmp_path):
    SplitProvider.calls=[];SplitProvider.fail=False
    vault=MemoryVault();app=create_app(tmp_path,'test',vault,SplitProvider)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test'}) as client:
        await client.put('/config',json={'provider':'openai','model':'chat','api_key':'CHAT_SECRET'})
        response=await client.put('/config/vision',json={'provider':'openai','model':'vision','api_key':'VISION_SECRET'})
        assert response.status_code==200
        assert 'SECRET' not in response.text
        yield client,app,vault

async def test_dual_credentials_are_independent_and_not_saved_to_sqlite(dual,tmp_path):
    client,app,vault=dual
    assert vault.values=={'openai:':'CHAT_SECRET','vision:openai:':'VISION_SECRET'}
    state=(await client.get('/config')).json()
    assert state['vision_config']['model']=='vision' and state['vision_has_key']
    assert Store(tmp_path).config(2)['model']=='vision'
    assert 'SECRET' not in json.dumps(Store(tmp_path).config(2))
    await client.post('/config/models',json={'provider':'openai','credential_slot':'vision'})
    assert SplitProvider.calls[-1]==('models','VISION_SECRET')
    state=(await client.delete('/config/vision')).json()
    assert state['vision_config'] is None
    assert vault.values=={'openai:':'CHAT_SECRET'}

async def test_image_routing_followup_cache_and_text_only_question(dual):
    client,app,vault=dual
    image={'name':'test.png','mime':'image/png','data':'YWJj'}
    response=await client.post('/chat',json={'text':'Identify this','images':[image]})
    assert response.status_code==200
    events=[json.loads(line) for line in response.text.splitlines()]
    cid=events[0]['conversation_id']
    assert any(e.get('message')=='Reading your images…' for e in events)
    assert [c[0] for c in SplitProvider.calls]==['vision','chat']
    assert 'Visible: ethanol' in SplitProvider.calls[1][2][0]['content']['text']
    stored=app.state.store.messages(cid)[0]['content']
    assert stored['images'] and stored['image_observations'].startswith('Visible:')
    await client.post('/chat',json={'conversation_id':cid,'text':'Is it an alcohol?'})
    assert [c[0] for c in SplitProvider.calls]==['vision','chat','chat']
    await client.post('/chat',json={'text':'Hello'})
    assert [c[0] for c in SplitProvider.calls]==['vision','chat','chat','chat']

async def test_image_reader_failure_does_not_invoke_text_model(dual):
    client,app,vault=dual
    SplitProvider.fail=True
    response=await client.post('/chat',json={'text':'Identify','images':[{'mime':'image/png','data':'YWJj'}]})
    assert 'Image service unavailable' in response.text
    assert [c[0] for c in SplitProvider.calls]==['vision']
    assert not app.state.busy
    SplitProvider.fail=False
    assert (await client.post('/chat',json={'text':'Hello'})).status_code==200

async def test_image_connection_test_uses_actual_image_content(dual):
    client,_,_=dual
    assert (await client.post('/config/vision/test')).json()=={'ok':True}
    assert SplitProvider.calls[0][0]=='vision'

async def test_empty_and_oversized_observations_are_rejected():
    class Empty:
        def image_support(self): return 'supported'
        async def stream(self,*args,**kwargs): yield ''
    messages=[{'role':'user','content':{'text':'Identify','images':[{'mime':'image/png','data':'YWJj'}]}}]
    with pytest.raises(ProviderError,match='no observations'): await interpret_images(messages,Empty())
    class Huge(Empty):
        async def stream(self,*args,**kwargs): yield 'x'*24001
    with pytest.raises(ProviderError,match='too much text'): await interpret_images(messages,Huge())

async def test_cached_observations_remain_usable_after_reader_is_disabled(dual):
    client,_,_=dual
    response=await client.post('/chat',json={'text':'Identify','images':[{'mime':'image/png','data':'YWJj'}]})
    cid=json.loads(response.text.splitlines()[0])['conversation_id']
    await client.delete('/config/vision')
    response=await client.post('/chat',json={'conversation_id':cid,'text':'Explain the OH group'})
    assert 'Ethanol is a primary alcohol' in response.text
    assert [c[0] for c in SplitProvider.calls]==['vision','chat','chat']

async def test_cancel_stops_image_reader_without_calling_chemistry():
    started=asyncio.Event();stopped=asyncio.Event()
    class Slow:
        def image_support(self): return 'supported'
        async def stream(self,*args,**kwargs):
            started.set()
            try:
                await asyncio.sleep(30)
                yield 'unused'
            finally: stopped.set()
    task=asyncio.create_task(interpret_images([{'role':'user','content':{'images':[{'data':'YWJj','mime':'image/png'}]}}],Slow()))
    await started.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert stopped.is_set()
