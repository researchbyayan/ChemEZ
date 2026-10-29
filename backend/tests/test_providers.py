import json
import httpx
import pytest
from chemez.providers import Provider,ProviderError

@pytest.mark.parametrize('provider,event,expected_url,key_header',[('openai',{'choices':[{'delta':{'content':'Hello'}}]},'https://api.openai.com/v1/chat/completions','authorization'),('compatible',{'choices':[{'delta':{'content':'Hello'}}]},'https://custom.example/v1/chat/completions','authorization'),('anthropic',{'type':'content_block_delta','delta':{'text':'Hello'}},'https://api.anthropic.com/v1/messages','x-api-key'),('gemini',{'candidates':[{'content':{'parts':[{'text':'Hello'}]}}]},'https://generativelanguage.googleapis.com/v1beta/models/test:streamGenerateContent?alt=sse','x-goog-api-key')])
async def test_native_requests_and_stream(provider,event,expected_url,key_header):
    def handler(request):
        assert str(request.url)==expected_url
        assert 'SECRET' in request.headers[key_header]
        assert 'SECRET' not in str(request.url)
        body=json.loads(request.content)
        assert 'question' in json.dumps(body)
        if provider=='anthropic':assert body['system'] and body['max_tokens']>0
        return httpx.Response(200,text='event: message\ndata: '+json.dumps(event)+'\n\ndata: [DONE]\n\n')
    adapter=Provider({'provider':provider,'model':'test','endpoint':'https://custom.example/v1'},'SECRET',httpx.MockTransport(handler))
    assert ''.join([chunk async for chunk in adapter.stream([{'role':'user','content':'question'}])])=='Hello'

@pytest.mark.parametrize('provider',['openai','compatible','anthropic','gemini','ollama'])
def test_provider_formats_image_input_for_each_api(provider):
    config={'provider':provider,'model':'vision-test','endpoint':'https://custom.example/v1'}
    if provider=='ollama':config['endpoint']='http://127.0.0.1:11434/v1'
    adapter=Provider(config,'SECRET')
    _,_,body=adapter.request([{'role':'user','content':{'text':'Identify this structure','images':[{'mime':'image/png','data':'aGVsbG8=','name':'question.png'}]}}])
    encoded=json.dumps(body)
    assert 'Identify this structure' in encoded and 'aGVsbG8=' in encoded
    if provider=='gemini':assert 'inlineData' in encoded
    elif provider=='anthropic':assert 'media_type' in encoded and 'base64' in encoded
    else:assert 'image_url' in encoded and 'data:image/png;base64' in encoded

async def test_provider_errors_do_not_echo_secrets():
    adapter=Provider({'provider':'openai','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(401,text='SECRET')))
    with pytest.raises(ProviderError,match='rejected the API key') as exc:
        _=[x async for x in adapter.stream([{'role':'user','content':'question'}])]
    assert 'SECRET' not in str(exc.value)

async def test_stream_error_event_is_not_silently_ignored():
    adapter=Provider({'provider':'gemini','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(200,text='data: {"error":{"message":"SECRET"}}\n\n')))
    with pytest.raises(ProviderError,match='during generation'):
        _=[x async for x in adapter.stream([{'role':'user','content':'question'}])]

def test_gemini_chemistry_request_enforces_json_schema():
    from chemez.providers import SYSTEM
    adapter=Provider({'provider':'gemini','model':'gemini-3.1-flash-lite'},'SECRET')
    _,_,body=adapter.request([{'role':'user','content':'Benzene, and resonating structures.'}])
    config=body['generationConfig']
    assert config['responseFormat']['text']['mimeType']=='APPLICATION_JSON'
    assert config['responseFormat']['text']['schema']['required']==['blocks']
    variants=config['responseFormat']['text']['schema']['properties']['blocks']['items']['anyOf']
    assert {v['properties']['type']['enum'][0] for v in variants}=={'markdown','molecule','reaction','mechanism','resonance','clarification'}
    assert '$ref' not in json.dumps(config['responseFormat']['text']['schema'])
    assert 'discriminator' not in json.dumps(config['responseFormat']['text']['schema'])
    provider=Provider({'provider':'gemini','model':'gemini-3.5-flash-lite'},'test')
    _,_,styled=provider.request([{'role':'user','content':'Explain ethanol'}],SYSTEM+'\n\nAnswer style: concise')
    assert styled['generationConfig']['responseFormat']['text']['schema']['required']==['blocks']
    _,_,test_body=adapter.request([{'role':'user','content':'Reply OK'}],system='Reply briefly with OK.')
    assert 'generationConfig' not in test_body

async def test_gemini_thoughts_do_not_corrupt_json_answer():
    answer='{"blocks":[{"type":"molecule","smiles":"c1ccccc1","label":"Benzene"}]}'
    events=[{'candidates':[{'content':{'parts':[{'text':'Thinking about benzene', 'thought':True}]}}]}, {'candidates':[{'content':{'parts':[{'text':answer[:30]}]}}]}, {'candidates':[{'content':{'parts':[{'text':answer[30:]}]},'finishReason':'STOP'}]}]
    adapter=Provider({'provider':'gemini','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(200,text=''.join('data: '+json.dumps(e)+'\n\n' for e in events))))
    raw=''.join([chunk async for chunk in adapter.stream([{'role':'user','content':'Benzene'}])])
    assert raw==answer
    from chemez.app import prepare_answer
    blocks,failed=prepare_answer(raw)
    assert not failed and blocks[0]['formula']=='C6H6' and blocks[0]['svg']

@pytest.mark.parametrize('event,message',[
    ({'candidates':[{'finishReason':'MAX_TOKENS'}]},'cut the answer short'),
    ({'candidates':[{'finishReason':'SAFETY'}]},'could not finish'),
    ({'promptFeedback':{'blockReason':'SAFETY'}},'blocked'),
    ({'candidates':[{'content':{'parts':[{'text':'Thought only','thought':True}]},'finishReason':'STOP'}]},'no answer text'),
])
async def test_gemini_incomplete_or_blocked_answers_have_useful_errors(event,message):
    adapter=Provider({'provider':'gemini','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(200,text='data: '+json.dumps(event)+'\n\n')))
    with pytest.raises(ProviderError,match=message):
        _=[chunk async for chunk in adapter.stream([{'role':'user','content':'Benzene'}])]

async def test_gemini_model_discovery_paginates_and_filters():
    def handler(request):
        assert request.headers['x-goog-api-key']=='SECRET'
        assert 'SECRET' not in str(request.url)
        if request.url.params.get('pageToken'):
            return httpx.Response(200,json={'models':[{'name':'models/text-b','supportedGenerationMethods':['generateContent']}]})
        return httpx.Response(200,json={'models':[
            {'name':'models/text-a','displayName':'Text A','supportedGenerationMethods':['generateContent']},
            {'name':'models/embedding','supportedGenerationMethods':['embedContent']},
            {'name':'models/flash-tts','supportedGenerationMethods':['generateContent']}], 'nextPageToken':'page2'})
    adapter=Provider({'provider':'gemini'},'SECRET',httpx.MockTransport(handler))
    assert await adapter.models()==[{'id':'text-a','label':'Text A','free_tier':False},{'id':'text-b','label':'text-b','free_tier':False}]

async def test_gemini_404_actionable_without_echoing_body():
    adapter=Provider({'provider':'gemini','model':'missing'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(404,text='SECRET')))
    with pytest.raises(ProviderError,match='Load available models') as exc:
        _=[x async for x in adapter.stream([])]
    assert 'SECRET' not in str(exc.value)

async def test_schema_rejection_retries_once_in_json_mode():
    bodies=[]
    def handler(request):
        body=json.loads(request.content);bodies.append(body)
        if len(bodies)==1:
            return httpx.Response(400,json={'error':{'message':'Invalid generationConfig.responseFormat schema SECRET'}})
        return httpx.Response(200,text='data: '+json.dumps({'candidates':[{'content':{'parts':[{'text':'{"blocks":[{"type":"markdown","text":"Hello"}]}'}]}}]})+'\n\n')
    adapter=Provider({'provider':'gemini','model':'gemini-3.5-flash'},'SECRET',httpx.MockTransport(handler))
    assert 'Hello' in ''.join([x async for x in adapter.stream([{'role':'user','content':'hello'}])])
    assert len(bodies)==2
    assert bodies[1]['generationConfig']=={'responseMimeType':'application/json','maxOutputTokens':16384}

async def test_invalid_google_key_is_not_retried_or_echoed():
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(400,json={'error':{'message':'API key not valid. SECRET'}})
    adapter=Provider({'provider':'gemini','model':'test'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError,match='invalid or expired') as exc:
        _=[x async for x in adapter.stream([])]
    assert len(calls)==1 and 'SECRET' not in str(exc.value)

async def test_schema_retry_failure_stops_after_two_requests():
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(400,json={'error':{'message':'responseJsonSchema rejected SECRET'}})
    adapter=Provider({'provider':'gemini','model':'test'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError):
        _=[x async for x in adapter.stream([])]
    assert len(calls)==2

@pytest.mark.parametrize('endpoint,read_timeout',[
    ('https://integrate.api.nvidia.com/v1',180),
    ('https://integrate.api.nvidia.com.attacker.example/v1',90),
    ('https://custom.example/v1',90),
])
async def test_timeout_policy_and_no_automatic_retry(endpoint,read_timeout):
    calls=[]
    def handler(request):
        calls.append(request)
        assert request.extensions['timeout']['read']==read_timeout
        assert request.extensions['timeout']['connect']==15
        raise httpx.ReadTimeout('secret internal details',request=request)
    adapter=Provider({'provider':'compatible','endpoint':endpoint,'model':'test'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError,match=f'{read_timeout} seconds') as exc:
        _=[x async for x in adapter.stream([])]
    assert len(calls)==1 and 'secret' not in str(exc.value)

async def test_total_deadline_closes_stream_even_with_reasoning(monkeypatch):
    import asyncio
    import chemez.providers as providers
    monkeypatch.setattr(providers,'NVIDIA_REQUEST_DEADLINE',0.02)
    closed=[]
    class SlowReasoning(httpx.AsyncByteStream):
        async def __aiter__(self):
            while True:
                yield b'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'
                await asyncio.sleep(0.001)
        async def aclose(self):closed.append(True)
    adapter=Provider({'provider':'compatible','endpoint':'https://integrate.api.nvidia.com/v1','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(200,stream=SlowReasoning())))
    with pytest.raises(ProviderError,match='did not finish'):
        _=[x async for x in adapter.stream([])]
    assert closed

async def test_cancel_closes_upstream_without_timeout_conversion():
    import asyncio
    started=asyncio.Event();closed=[]
    class Waiting(httpx.AsyncByteStream):
        async def __aiter__(self):
            started.set()
            await asyncio.Event().wait()
            yield b''
        async def aclose(self):closed.append(True)
    adapter=Provider({'provider':'compatible','endpoint':'https://integrate.api.nvidia.com/v1','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(200,stream=Waiting())))
    async def collect():return [x async for x in adapter.stream([])]
    task=asyncio.create_task(collect());await started.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert closed

async def test_remote_gateway_timeout_is_identified():
    adapter=Provider({'provider':'compatible','endpoint':'https://integrate.api.nvidia.com/v1','model':'test'},'SECRET',httpx.MockTransport(lambda _:httpx.Response(504)))
    with pytest.raises(ProviderError,match='remote service'):
        _=[x async for x in adapter.stream([])]

async def test_local_ollama_has_no_auth_and_excludes_remote_models():
    requests=[]
    def handler(request):
        requests.append(request)
        assert 'authorization' not in request.headers
        if request.url.path=='/api/tags':
            return httpx.Response(200,json={'models':[{'name':'local:small'},{'name':'large:cloud'},{'name':'alias','remote_host':'https://ollama.com'}]})
        body=json.loads(request.content)
        assert body['response_format']=={'type':'json_object'}
        return httpx.Response(200,text='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    adapter=Provider({'provider':'ollama','model':'local:small'},'',httpx.MockTransport(handler))
    assert await adapter.models()==[{'id':'local:small','label':'local:small'}]
    assert ''.join([x async for x in adapter.stream([])])=='Hello'
    assert all(r.url.host=='127.0.0.1' for r in requests)

async def test_local_mode_refuses_remote_alias_before_generation():
    adapter=Provider({'provider':'ollama','model':'alias'},'',httpx.MockTransport(lambda _:httpx.Response(200,json={'models':[{'name':'local'},{'name':'alias','remote_model':'cloud'}]})))
    with pytest.raises(ProviderError,match='installed local'):
        _=[x async for x in adapter.stream([])]

async def test_no_local_service_has_actionable_setup_message():
    def handler(request):raise httpx.ConnectError('internal',request=request)
    adapter=Provider({'provider':'ollama','model':'local'},'',httpx.MockTransport(handler))
    with pytest.raises(ProviderError,match='No API key or cloud billing'):
        await adapter.models()

async def test_free_quota_error_does_not_retry_paid_model():
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(429,json={'error':{'message':'quota exceeded generate_content_free_tier_requests SECRET'}})
    adapter=Provider({'provider':'gemini','model':'gemini-3.5-flash-lite'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError,match='No paid fallback') as exc:
        _=[x async for x in adapter.stream([])]
    assert len(calls)==1 and 'SECRET' not in str(exc.value)

async def test_gateway_discovery_keeps_aliases_and_auth_local():
    requests=[]
    def handler(request):
        requests.append(request)
        assert str(request.url)=='http://127.0.0.1:4000/v1/models'
        assert request.headers['authorization']=='Bearer GATEWAY-SECRET'
        return httpx.Response(200,json={'data':[{'id':'chem-local'},{'id':'chem-local'},{'id':'google/free-alias'},{}]})
    adapter=Provider({'provider':'compatible','endpoint':'http://127.0.0.1:4000/v1'},'GATEWAY-SECRET',httpx.MockTransport(handler))
    assert await adapter.models()==[{'id':'chem-local','label':'chem-local'},{'id':'google/free-alias','label':'google/free-alias'}]
    assert len(requests)==1

async def test_gateway_keyless_discovery_and_request_omit_authorization():
    def handler(request):
        assert 'authorization' not in request.headers
        return httpx.Response(200,json={'data':[{'id':'local'}]})
    adapter=Provider({'provider':'compatible','endpoint':'http://localhost:4000/v1','model':'local','auth_mode':'none'},'',httpx.MockTransport(handler))
    assert await adapter.models()
    url,headers,body=adapter.request([])
    assert url=='http://localhost:4000/v1/chat/completions' and 'Authorization' not in headers
    assert body['model']=='local'

async def test_transient_503_recovers_without_changing_model_or_key(monkeypatch):
    import chemez.providers as providers
    async def no_delay(_):pass
    monkeypatch.setattr(providers.asyncio,'sleep',no_delay)
    requests=[]
    def handler(request):
        requests.append(request)
        if len(requests)<3:return httpx.Response(503,headers={'Retry-After':'0'})
        return httpx.Response(200,text='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    adapter=Provider({'provider':'compatible','endpoint':'https://gateway.example/v1','model':'chem-local'},'GATEWAY-SECRET',httpx.MockTransport(handler))
    assert ''.join([x async for x in adapter.stream([])])=='Hello'
    assert len(requests)==3
    assert len({r.content for r in requests})==1
    assert all(r.headers['authorization']=='Bearer GATEWAY-SECRET' for r in requests)

async def test_transient_retry_stops_at_three_requests(monkeypatch):
    import chemez.providers as providers
    async def no_delay(_):pass
    monkeypatch.setattr(providers.asyncio,'sleep',no_delay)
    calls=[]
    def handler(request):calls.append(request);return httpx.Response(503)
    adapter=Provider({'provider':'compatible','endpoint':'https://gateway.example/v1','model':'local'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError,match='temporarily unavailable'):
        _=[x async for x in adapter.stream([])]
    assert len(calls)==3

async def test_long_retry_after_is_not_ignored():
    calls=[]
    def handler(request):calls.append(request);return httpx.Response(503,headers={'Retry-After':'60'})
    adapter=Provider({'provider':'compatible','endpoint':'https://gateway.example/v1','model':'local'},'SECRET',httpx.MockTransport(handler))
    with pytest.raises(ProviderError):_=[x async for x in adapter.stream([])]
    assert len(calls)==1

async def test_cancel_during_retry_does_not_send_another_request(monkeypatch):
    import asyncio
    import chemez.providers as providers
    waiting=asyncio.Event();calls=[]
    async def wait(_):waiting.set();await asyncio.Event().wait()
    monkeypatch.setattr(providers.asyncio,'sleep',wait)
    def handler(request):calls.append(request);return httpx.Response(503)
    adapter=Provider({'provider':'compatible','endpoint':'https://gateway.example/v1','model':'local'},'SECRET',httpx.MockTransport(handler))
    async def collect():return [x async for x in adapter.stream([])]
    task=asyncio.create_task(collect());await waiting.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert len(calls)==1

async def test_openai_and_anthropic_model_lists_keep_chat_models():
    seen={}
    def handler(request):
        seen[request.url.host]=dict(request.headers)
        if request.url.host=='api.openai.com':
            return httpx.Response(200,json={'data':[{'id':'gpt-x','created':2},{'id':'text-embedding-3-small','created':3},{'id':'gpt-old','created':1}]})
        return httpx.Response(200,json={'data':[{'id':'claude-y','display_name':'Claude Y','created_at':'2026-01-01'}]})
    openai=await Provider({'provider':'openai','model':''},'SECRET',httpx.MockTransport(handler)).models()
    anthropic=await Provider({'provider':'anthropic','model':''},'SECRET',httpx.MockTransport(handler)).models()
    assert [m['id'] for m in openai]==['gpt-x','gpt-old']
    assert anthropic==[{'id':'claude-y','label':'Claude Y'}]
    assert seen['api.openai.com']['authorization']=='Bearer SECRET' and seen['api.anthropic.com']['x-api-key']=='SECRET'
    with pytest.raises(ProviderError) as error:
        await Provider({'provider':'openai','model':''},'SECRET',httpx.MockTransport(lambda _:httpx.Response(401,text='SECRET'))).models()
    assert 'SECRET' not in str(error.value)

@pytest.mark.parametrize('retry_after,expected_calls',[('0',3),('60',1),('',1)])
async def test_nvidia_trial_throttle_respects_retry_after_without_switching_models(retry_after,expected_calls):
    calls=[]
    def handler(request):
        calls.append(request)
        if len(calls)<3:return httpx.Response(429,headers={'Retry-After':retry_after})
        return httpx.Response(200,text='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    adapter=Provider({'provider':'compatible','endpoint':'https://integrate.api.nvidia.com/v1','model':'selected-model'},'SECRET',httpx.MockTransport(handler))
    if expected_calls==3:
        assert ''.join([x async for x in adapter.stream([])])=='Hello'
    else:
        with pytest.raises(ProviderError,match='rate limit'):_=[x async for x in adapter.stream([])]
    assert len(calls)==expected_calls
    assert len({r.content for r in calls})==1
