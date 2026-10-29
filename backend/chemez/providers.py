"""Native streaming adapters; no credentials ever reach renderer JavaScript."""
import re
import json
import asyncio
import random
from urllib.parse import urlparse
import httpx
from .answer_format import gemini_answer_schema

FREE_TIER_GEMINI_MODELS = {'gemini-3.5-flash-lite','gemini-3.1-flash-lite'}
REQUEST_DEADLINE = 180
NVIDIA_REQUEST_DEADLINE = 270

class ProviderError(Exception):
    pass

from .prompt import SYSTEM


class Provider:
    def __init__(self, config, key, transport=None):
        self.config,self.key,self.transport = config,key,transport
    @staticmethod
    def _parts(content):
        if isinstance(content,dict):
            return content.get('text',''),content.get('images',[])
        return str(content),[]
    def image_support(self):
        model=self.config.get('model','').lower()
        # NVIDIA's published Bolt model card declares text inputs only. Never silently
        # discard an image or route it to a different model/provider.
        if self.is_nvidia() and 'nemotron-3.5-bolt-e4b' in model:
            return 'unsupported'
        if self.is_nvidia() and model=='qwen/qwen3.5-122b-a10b':
            return 'supported'
        return 'unknown'
    def _openai_messages(self,messages):
        result=[]
        for message in messages:
            text,images=self._parts(message['content'])
            if images:
                content=[{'type':'text','text':text or 'Analyze the attached chemistry image.'},*({'type':'image_url','image_url':{'url':f"data:{image['mime']};base64,{image['data']}"}} for image in images)]
            else: content=text
            result.append({'role':message['role'],'content':content})
        return result
    def _anthropic_messages(self,messages):
        result=[]
        for message in messages:
            text,images=self._parts(message['content'])
            if images:
                content=[*({'type':'image','source':{'type':'base64','media_type':image['mime'],'data':image['data']}} for image in images),{'type':'text','text':text or 'Analyze the attached chemistry image.'}]
            else: content=text
            result.append({'role':message['role'],'content':content})
        return result
    def request(self, messages, system=SYSTEM):
        provider, model = self.config['provider'], self.config['model']
        headers = {'Content-Type':'application/json'}
        if provider == 'ollama':
            return 'http://127.0.0.1:11434/v1/chat/completions',headers,{'model':model,'messages':[{'role':'system','content':system},*self._openai_messages(messages)],'stream':True,'response_format':{'type':'json_object'},'max_tokens':8192}
        if provider in ('openai','compatible'):
            base = self.config.get('endpoint') if provider == 'compatible' else 'https://api.openai.com/v1'
            if not base:
                raise ProviderError('Set the compatible API base URL, including its version path.')
            if self.config.get('auth_mode')!='none':
                headers['Authorization'] = f'Bearer {self.key}'
            if self.image_support()=='unsupported' and any(self._parts(m['content'])[1] for m in messages):
                raise ProviderError('This NVIDIA model accepts text only. Choose a vision-capable model in Model & API to ask about images. Your attachment has been kept; no image was sent.')
            body={'model':model,'messages':[{'role':'system','content':system},*self._openai_messages(messages)],'stream':True}
            if self.is_nvidia() and 'nemotron-3.5-bolt-e4b' in model.lower() and system.startswith(SYSTEM):
                # NVIDIA documents constrained JSON-schema output for this endpoint.
                # Instructions alone produced invalid JSON in the live baseline run.
                body.update(response_format={'type':'json_schema','json_schema':{'name':'ChemEZAnswer','strict':True,'schema':gemini_answer_schema()}},max_tokens=12288)
            elif self.is_nvidia() and model=='qwen/qwen3.5-122b-a10b' and system.startswith(SYSTEM):
                # NVIDIA documents vision content parts and these thinking controls
                # for this model. Reasoning deltas remain outside the final answer.
                body.update(max_tokens=16384,temperature=0.6,top_p=0.95,chat_template_kwargs={'enable_thinking':True})
            return f'{base.rstrip("/")}/chat/completions', headers, body
        if provider == 'anthropic':
            headers.update({'x-api-key':self.key,'anthropic-version':'2023-06-01'})
            return 'https://api.anthropic.com/v1/messages', headers, {'model':model,'max_tokens':8192,'system':system,'messages':self._anthropic_messages(messages),'stream':True}
        if provider == 'gemini':
            from urllib.parse import quote
            headers['x-goog-api-key'] = self.key
            contents=[]
            for message in messages:
                text,images=self._parts(message['content'])
                parts=[{'text':text or 'Analyze the attached chemistry image.'},*({'inlineData':{'mimeType':image['mime'],'data':image['data']}} for image in images)]
                contents.append({'role':'model' if message['role']=='assistant' else 'user','parts':parts})
            body = {'systemInstruction':{'parts':[{'text':system}]},'contents':contents}
            if system.startswith(SYSTEM):
                body['generationConfig'] = {
                    'responseFormat':{'text':{'mimeType':'APPLICATION_JSON','schema':gemini_answer_schema()}},
                    'maxOutputTokens':16384,
                }
            if system.startswith(SYSTEM) and model.startswith('gemini-2'):
                body['generationConfig'].pop('responseFormat')
                body['generationConfig'].update(responseMimeType='application/json',responseJsonSchema=gemini_answer_schema())
            return f'https://generativelanguage.googleapis.com/v1beta/models/{quote(model,safe="")}:streamGenerateContent?alt=sse',headers,body
        raise ProviderError('Unsupported provider.')
    def http_error(self, status):
        if status == 404 and self.config['provider'] == 'gemini':
            return ProviderError('This Gemini model is unavailable for your API key or does not support this API. In Settings, use Load available models and choose a returned model. Retrying the same model will not fix this.')
        if status in (502,503):
            return ProviderError('The selected provider or gateway is temporarily unavailable (HTTP '+str(status)+'). Keep the same key and try later; no model fallback was sent.')
        if status in (408,504):
            return ProviderError('The provider gateway timed out. This timeout came from the remote service. Try again later or choose another model.')
        messages = {400:'The provider rejected this request. Check the model and API configuration.',401:'The provider rejected the API key. Enter a valid key for this provider.',403:'Access denied. Check key restrictions and whether your account or gateway permits this model.',402:'This provider account has insufficient balance. Add credit in the provider’s dashboard.',429:'The provider rate limit or quota was reached. Wait before retrying and check your account’s limits. No paid model fallback was sent.',404:'The model or endpoint was not found. Check the exact model ID and API base URL.'}
        return ProviderError(messages.get(status, f'Provider returned HTTP {status}. Try again later or check provider status.'))

    def error_category(self, data):
        # Inspect upstream data locally, but never echo its text, credentials or prompts.
        error = data.get('error',{}) if isinstance(data,dict) else {}
        text = json.dumps(error).lower()
        if any(term in text for term in ('api_key_invalid','api_key_expired','api key not valid','api key expired','invalid api key')):
            return 'key'
        if any(term in text for term in ('response_json_schema','responsejsonschema','responseschema','response_schema','responseformat','response_format','generation_config.response','generationconfig.response','schema','responsemimetype','response_mime_type')):
            return 'schema'
        if 'user location is not supported' in text:
            return 'region'
        if 'free_tier' in text or 'freetier' in text:
            return 'free_quota'
        if 'billing' in text:
            return 'billing'
        return None

    async def local_models(self):
        try:
            async with httpx.AsyncClient(timeout=10,transport=self.transport) as client:
                response = await client.get('http://127.0.0.1:11434/api/tags')
                response.raise_for_status()
                models = response.json().get('models',[])
                result = [{'id':m['name'],'label':m['name']} for m in models if isinstance(m.get('name'),str) and 'cloud' not in m['name'].lower() and not m.get('remote_host') and not m.get('remote_model')]
        except (httpx.HTTPError,ValueError,AttributeError) as exc:
            raise ProviderError('Local Ollama is not running. Install Ollama, start it, and download a local text model. No API key or cloud billing is needed.') from exc
        if not result:
            raise ProviderError('No downloaded local models were found in Ollama. Download a text model first; cloud models are excluded.')
        return result

    async def gateway_models(self):
        base = self.config.get('endpoint','').rstrip('/')
        if not base:
            raise ProviderError('Set the gateway API base URL first.')
        headers = {} if self.config.get('auth_mode')=='none' else {'Authorization':f'Bearer {self.key}'}
        try:
            async with httpx.AsyncClient(timeout=20,transport=self.transport) as client:
                response=await client.get(base+'/models',headers=headers)
                if response.status_code==404:
                    raise ProviderError('This gateway does not expose /models at this base URL. Check its version path or enter a configured model alias manually.')
                if response.status_code>=400:
                    raise self.http_error(response.status_code)
                data=response.json().get('data',[])
                models=[{'id':m['id'],'label':m['id']} for m in data if isinstance(m,dict) and isinstance(m.get('id'),str) and 0<len(m['id'])<=150]
        except (httpx.HTTPError,ValueError,AttributeError,TypeError) as exc:
            raise ProviderError('Could not load gateway models. Check that the gateway is running, its base URL, and its authentication settings.') from exc
        if not models:
            raise ProviderError('The gateway returned no model aliases. Configure an upstream model in the gateway first.')
        return sorted({m['id']:m for m in models}.values(),key=lambda m:m['id'])

    async def models(self):
        if self.config['provider']=='compatible':
            return await self.gateway_models()
        if self.config['provider']=='ollama':
            return await self.local_models()
        if self.config['provider'] in ('openai','anthropic'):
            return await self.hosted_models()
        if self.config['provider'] != 'gemini':
            raise ProviderError('Model discovery is not available for this provider.')
        result = []
        token = None
        try:
            async with httpx.AsyncClient(timeout=30,transport=self.transport) as client:
                for _ in range(20):
                    params = {'pageSize':1000}
                    if token:
                        params['pageToken'] = token
                    response = await client.get('https://generativelanguage.googleapis.com/v1beta/models',headers={'x-goog-api-key':self.key},params=params)
                    if response.status_code >= 400:
                        raise self.http_error(response.status_code)
                    data = response.json()
                    for model in data.get('models',[]):
                        name = model.get('name','').removeprefix('models/')
                        methods = model.get('supportedGenerationMethods',[])
                        if name and 'generateContent' in methods and not any(part in name.lower() for part in ('tts','image','live','robotics','audio')):
                            result.append({'id':name,'label':model.get('displayName',name),'free_tier':name in FREE_TIER_GEMINI_MODELS})
                    token = data.get('nextPageToken')
                    if not token:
                        break
        except (httpx.HTTPError,ValueError) as exc:
            raise ProviderError('Could not load Gemini models. Check your network and API key.') from exc
        if not result:
            raise ProviderError('Google returned no compatible text models for this key. Check the project’s Gemini API access in Google AI Studio.')
        return sorted({item['id']:item for item in result}.values(),key=lambda item:item['id'])

    async def hosted_models(self):
        """List chat models from OpenAI or Anthropic so users pick instead of typing exact IDs."""
        anthropic = self.config['provider']=='anthropic'
        url = 'https://api.anthropic.com/v1/models?limit=1000' if anthropic else 'https://api.openai.com/v1/models'
        headers = {'x-api-key':self.key,'anthropic-version':'2023-06-01'} if anthropic else {'Authorization':f'Bearer {self.key}'}
        try:
            async with httpx.AsyncClient(timeout=20,transport=self.transport) as client:
                response = await client.get(url,headers=headers)
                if response.status_code >= 400:
                    raise self.http_error(response.status_code)
                data = response.json().get('data',[])
        except (httpx.HTTPError,ValueError,AttributeError) as exc:
            raise ProviderError('Could not load models. Check your network and API key.') from exc
        skip = re.compile(r'embed|whisper|tts|dall-e|davinci|babbage|moderation|audio|realtime|transcribe|image|search|computer-use|codex')
        models = [{'id':m['id'],'label':m.get('display_name') or m['id']} for m in data if isinstance(m,dict) and isinstance(m.get('id'),str) and 0<len(m['id'])<=150 and not skip.search(m['id'])]
        if not models:
            raise ProviderError('This key returned no chat models.')
        # Newest first is how both dashboards present them; keep that order when timestamps exist.
        created = {m['id']:m.get('created') or m.get('created_at') or '' for m in data if isinstance(m,dict)}
        return sorted(models,key=lambda m:str(created.get(m['id'],'')),reverse=True)

    def is_nvidia(self):
        return self.config['provider']=='compatible' and urlparse(self.config.get('endpoint','')).hostname=='integrate.api.nvidia.com'

    async def stream(self, messages, system=SYSTEM):
        # Bound total time even when reasoning tokens/heartbeats keep the socket alive.
        deadline = NVIDIA_REQUEST_DEADLINE if self.is_nvidia() else REQUEST_DEADLINE
        try:
            async with asyncio.timeout(deadline):
                async for text in self._stream(messages,system):
                    yield text
        except TimeoutError as exc:
            raise ProviderError(f'The provider did not finish within {deadline:g} seconds. Cancelled this request. Try a shorter question or another model; no automatic retry was sent.') from exc

    async def open_stream(self, stack, client, url, headers, body):
        for attempt in range(3):
            response=await stack.enter_async_context(client.stream('POST',url,headers=headers,json=body))
            retry_after=response.headers.get('retry-after','')
            short_nvidia_throttle=self.is_nvidia() and response.status_code==429 and retry_after.isdecimal() and float(retry_after)<=10
            if (response.status_code not in (502,503) and not short_nvidia_throttle) or attempt==2:
                return response
            # Retry only explicit transient HTTP rejections, before consuming output.
            # NVIDIA throttling is retried only with its explicit short Retry-After.
            # Never switch endpoint/model or retry a timeout/partial response.
            retry_after=response.headers.get('retry-after','')
            delay=float(retry_after) if retry_after.isdecimal() else (2**attempt)+random.uniform(0,0.25)
            if delay>10:
                return response
            await response.aclose()
            await asyncio.sleep(delay)

    async def _stream(self, messages, system=SYSTEM):
        if self.config['provider']=='ollama':
            installed = await self.local_models()
            if self.config['model'] not in {m['id'] for m in installed}:
                raise ProviderError('Choose an installed local Ollama model from Load available models. Cloud models are excluded.')
        url,headers,body = self.request(messages,system)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(180 if self.is_nvidia() else 90,connect=15,write=30,pool=15),transport=self.transport) as client:
                # A schema rejection may be retried once in JSON mode. Structural and
                # chemistry validation still run locally before any diagram is shown.
                from contextlib import AsyncExitStack
                async with AsyncExitStack() as stack:
                    response = await self.open_stream(stack,client,url,headers,body)
                    if response.status_code >= 400:
                        await response.aread()
                        try:
                            category = self.error_category(response.json())
                        except ValueError:
                            category = None
                        if response.status_code == 400 and self.config['provider']=='gemini' and category=='schema' and 'generationConfig' in body:
                            await response.aclose()
                            body['generationConfig'] = {'responseMimeType':'application/json','maxOutputTokens':16384}
                            response = await self.open_stream(stack,client,url,headers,body)
                            if response.status_code >= 400:
                                raise self.http_error(response.status_code)
                        elif category=='key':
                            raise ProviderError('The selected provider rejected this API key as invalid or expired. Replace it with an active key for this endpoint.')
                        elif category=='region':
                            raise ProviderError('Google’s Gemini API is not available from your current location.')
                        elif category=='free_quota':
                            raise ProviderError('Your Gemini free API quota is exhausted or unavailable for this project/model. Wait for quota to reset, choose a published free-tier model on a Free-tier project, or use local Ollama. No paid fallback was attempted.')
                        elif category=='billing':
                            raise ProviderError('This project/model is not eligible for this request without billing. For free use, choose Gemini Flash-Lite on a Free-tier project, or local Ollama. No paid fallback was attempted.')
                        else:
                            raise self.http_error(response.status_code)
                    received_text = False
                    async for line in response.aiter_lines():
                        if not line.startswith('data:'):
                            continue
                        data = line[5:].strip()
                        if not data or data == '[DONE]':
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError as exc:
                            raise ProviderError('Provider returned malformed streaming data.') from exc
                        if 'error' in event or event.get('type') == 'error':
                            raise ProviderError('Provider reported an error during generation. Check quota and model availability.')
                        if self.config['provider'] in ('openai','compatible','ollama'):
                            choices = event.get('choices',[])
                            if choices and choices[0].get('finish_reason') == 'length':
                                raise ProviderError('The provider cut the answer short. Ask a smaller question or choose a model with a larger output limit.')
                            if choices and choices[0].get('finish_reason') == 'content_filter':
                                raise ProviderError('The provider filtered this response. Try rephrasing your question.')
                            text = choices[0].get('delta',{}).get('content','') if choices else ''
                        elif self.config['provider'] == 'anthropic':
                            if event.get('delta',{}).get('stop_reason') == 'max_tokens':
                                raise ProviderError('The provider cut the answer short. Try a smaller question.')
                            text = event.get('delta',{}).get('text','')
                        else:
                            candidates = event.get('candidates',[])
                            if event.get('promptFeedback',{}).get('blockReason'):
                                raise ProviderError('The provider blocked this response. Try rephrasing your question.')
                            candidate = candidates[0] if candidates else {}
                            reason = candidate.get('finishReason')
                            if reason == 'MAX_TOKENS':
                                raise ProviderError('The provider cut the answer short. Ask a smaller question or choose a model with a larger output limit.')
                            if reason and reason not in ('STOP','FINISH_REASON_UNSPECIFIED'):
                                raise ProviderError('The provider could not finish this response. Try rephrasing your question.')
                            text = ''.join(part.get('text','') for part in candidate.get('content',{}).get('parts',[]) if not part.get('thought'))
                        if isinstance(text,str) and text:
                            received_text = True
                            yield text
                    if not received_text:
                        raise ProviderError('The provider returned no answer text. Check the selected model or try again.')
        except httpx.ConnectTimeout as exc:
            raise ProviderError('Connecting to the provider timed out. Check your network or try again later.') from exc
        except httpx.TimeoutException as exc:
            if self.is_nvidia():
                raise ProviderError('NVIDIA sent no new data for 180 seconds. Its endpoint may be busy or the model stalled. Try again later or choose another model; no automatic retry was sent.') from exc
            raise ProviderError('The provider sent no new data for 90 seconds. Try again later or choose another model.') from exc
        except httpx.HTTPError as exc:
            raise ProviderError('Could not connect to the provider. Check your network and endpoint.') from exc
