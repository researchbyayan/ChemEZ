from .answer_policy import prose as clean_prose, references, condensed, move_references
from . import stepwise
import asyncio
import json
import secrets
import re
import os
from typing import Literal
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from .models import Block, ChatRequest, ProviderConfig, GeminiModelsRequest
from .storage import Store, Credentials
from .providers import Provider, ProviderError, SYSTEM
from .answer_format import decode_answer, readable_fallback,chemistry_markdown
from .chemistry import render_block, expand_resonance, formula_only_question, enrich_names, structure_3d, analyse
from .processing import process_chemistry, ProcessingError
from . import mechanisms, routes, nmr, autopick, drawing
from .vision import interpret_images, VISION_SYSTEM
from .styles import answer_system, style_issue, diagram_issue, split_command, COMMANDS, command_issue
from .followups import suggest_followups, clean_next_question
from .compounds import Lookup, Cache, computed
from . import router

block_adapter = TypeAdapter(Block)

def missing_reaction_drawing(blocks):
    prose='\n'.join(block.get('text','') for block in blocks if isinstance(block,dict) and block.get('type')=='markdown' and isinstance(block.get('text'),str))
    return bool(re.search(r'\\ce\{[^}]*?(?:->|=>|<=>)|\\(?:xrightarrow|rightarrow)\b|→',prose)) and not any(block.get('type') in {'reaction','mechanism','resonance'} for block in blocks)

class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    pinned: bool = False
    archived: bool | None = None

class StructureRequest(BaseModel):
    smiles: str = Field(min_length=1, max_length=2000)

class SuggestRequest(BaseModel):
    mode: Literal['concise','balanced','mechanism']
    command: str = Field('', max_length=20)


class ConversationRewind(BaseModel):
    before_message_id: str = Field(min_length=1,max_length=100)

def account(config):
    return config['provider'] + ':' + config.get('endpoint','')

# Repair rounds for answers whose drawings or chemistry fail validation.
MAX_REPAIRS = 3

def keyless(config):
    # Validation only allows auth_mode 'none' for a loopback compatible gateway.
    return config['provider']=='ollama' or config.get('auth_mode')=='none'

_ESCAPES = {'\t':'t','\x08':'b','\x0c':'f','\r':'r'}

def restore_latex(value):
    """Undo JSON escapes that ate a single LaTeX backslash (\\text -> tab + "ext", \\frac, \\beta, \\rightarrow)."""
    if isinstance(value,str):
        return re.sub(r'[\t\x08\x0c\r](?=[A-Za-z])',lambda m:'\\'+_ESCAPES[m.group(0)],value)
    if isinstance(value,list):
        return [restore_latex(v) for v in value]
    if isinstance(value,dict):
        return {k:restore_latex(v) for k,v in value.items()}
    return value

def prepare_answer(text):
    try:
        data = clean_prose(decode_answer(text))
    except (ValueError, TypeError):
        return [error_block('The model did not return a valid structured answer.')], True
    if not isinstance(data,dict) or not isinstance(data.get('blocks'),list) or not 1 <= len(data['blocks']) <= 50:
        return [error_block('The model returned an invalid answer structure.')], True
    result, failed = [], False
    # Limit total native work as well as individual molecule size. A model can otherwise
    # request hundreds of 250-atom depictions inside one nominally valid answer.
    def structures(value):
        if isinstance(value,dict):
            return ([value['smiles']] if isinstance(value.get('smiles'),str) else []) + [s for k,v in value.items() if k!='smiles' for s in structures(v)]
        if isinstance(value,list):
            return [s for v in value for s in structures(v)]
        return []
    proposed = structures(data['blocks'])
    if len(proposed)>80 or sum(map(len,proposed))>20000:
        return [error_block('This answer contains too many structures to draw at once. Ask for a smaller first batch (up to 20 reaction steps).')], True
    # A Markdown table split into one block per row is joined back into one table.
    joined=[]
    for item in data['blocks']:
        if isinstance(item,dict) and item.get('type')=='markdown' and isinstance(item.get('text'),str) and item['text'].lstrip().startswith('|') and joined and isinstance(joined[-1],dict) and joined[-1].get('type')=='markdown' and joined[-1].get('text','').rstrip().split('\n')[-1].lstrip().startswith('|'):
            joined[-1]={**joined[-1],'text':joined[-1]['text'].rstrip()+'\n'+item['text'].strip()}
        else:
            joined.append(item)
    data['blocks']=joined
    for item in [part for item in data['blocks'] for part in expand_resonance(item)]:
        try:
            if isinstance(item,dict) and item.get('type')=='mechanism' and item.get('name') and isinstance(item.get('reactants'),list):
                # Built-in shortcut: ChemEZ draws the named mechanism from the reactants.
                item=mechanisms.build(item['name'],[r for r in item['reactants'] if isinstance(r,str)])
            # Preserve prose accidentally attached to an otherwise typed diagram.
            # This is a presentation normalization, not a chemistry correction.
            if isinstance(item,dict) and item.get('type') in ('molecule','reaction','mechanism') and isinstance(item.get('text'),str):
                prose=item['text']
                item={k:v for k,v in item.items() if k!='text'}
                if prose.strip():
                    result.append(render_block(block_adapter.validate_python({'type':'markdown','text':restore_latex(prose)})))
            if isinstance(item,dict) and item.get('type')=='mechanism' and isinstance(item.get('caption'),str):
                caption=item['caption']
                item={k:v for k,v in item.items() if k!='caption'}
                if caption.strip():
                    result.append(render_block(block_adapter.validate_python({'type':'markdown','text':restore_latex(caption)})))
            block = block_adapter.validate_python(restore_latex(item))
            if block.type=='markdown':
                block=block.model_copy(update={'text':chemistry_markdown(block.text)})
            try:
                rendered=render_block(block)
            except ValueError:
                if block.type=='mechanism' and (rebuilt:=mechanisms.recognise(item,data['blocks'])):
                    # The model's panels could not be read: draw the named mechanism ChemEZ knows.
                    result.append(render_block(block_adapter.validate_python(rebuilt)))
                    continue
                if block.type!='resonance':
                    raise
                rendered=None
            if block.type=='resonance' and (rendered is None or any(c.get('limitation') for c in rendered['contributors'])):
                # The model's contributors did not check out: draw the series ChemEZ derives itself.
                regenerated=expand_resonance(item,generate=True)
                if len(regenerated)==1 and regenerated[0].get('type')=='resonance':
                    try:
                        replacement=render_block(block_adapter.validate_python(regenerated[0]))
                        if not any(c.get('limitation') for c in replacement['contributors']):
                            rendered=replacement
                    except (ValidationError,ValueError):
                        pass
                if rendered is None:
                    raise ValueError('Resonance contributors must use the same atoms in the same SMILES order and the same connectivity, formula and net charge; only bond orders, charges and lone pairs may change.')
            result.append(rendered)
            if block.type=='resonance' and any(c.get('limitation') for c in rendered['contributors']):
                failed=True
                result.append(error_block('Some resonance electron-flow arrows could not be verified. '+ '; '.join(c['limitation'] for c in rendered['contributors'] if c.get('limitation'))[:400]))
            if block.type=='mechanism' and any(step.get('svg') is None for step in rendered['steps']):
                rebuilt=mechanisms.recognise(item,data['blocks'])
                replacement=render_block(block_adapter.validate_python(rebuilt)) if rebuilt else None
                if replacement and all(step.get('svg') is not None for step in replacement['steps']):
                    result[-1]=replacement
                    continue
                failed=True
                result.append(error_block('One or more mechanism panels could not be verified. '+ '; '.join(step['limitation'] for step in rendered['steps'] if step.get('svg') is None)[:400]))
        except (ValidationError,ValueError,RuntimeError) as exc:
            failed = True
            # Validation errors may contain user/model data but never credentials.
            message = str(exc)[:500] if isinstance(exc,ValueError) and not isinstance(exc,ValidationError) else 'A model answer block did not match the required chemistry format.'
            if isinstance(exc,ValidationError):
                # Field paths and messages only (no input values) so the repair request is actionable.
                details = '; '.join(f"{'.'.join(map(str,e['loc'])) or 'block'}: {e['msg']}" for e in exc.errors(include_input=False,include_url=False)[:6])
                message = f"{message[:-1]} ({item.get('type','unknown') if isinstance(item,dict) else 'unknown'} block — {details})."[:500]
            result.append(error_block(message))
    # A specific structure error already explains the missing drawing.
    if not failed and missing_reaction_drawing(result):
        result.append(error_block('The provider returned a text equation without a validated reaction drawing. Retry this answer to request the missing scheme.'))
        failed=True
    if result and (refs:=references(data.get("references",[]))):
        result[0]["references"]=refs
    return clean_prose(result), failed

def error_block(text):
    return {'id':str(uuid4()), 'type':'error', 'text':clean_prose(text)}

def restored_block(block):
    try:
        if not isinstance(block,dict):
            raise ValueError('Invalid saved block.')
        if block.get('type') in ('markdown','error') and not isinstance(block.get('text'),str):
            raise ValueError('Invalid saved text.')
        if block.get('type')=='reaction':
            # Revalidate legacy identity schemes instead of trusting their cached SVG.
            fields={key:block[key] for key in ('type','reactants','products','reagents','conditions','caption') if key in block}
            for side in ('reactants','products'):
                fields[side]=[{k:v for k,v in item.items() if k in ('smiles','label','formula','iupac_name')} for item in fields.get(side,[])]
            rendered=render_block(block_adapter.validate_python(fields))
            if rendered['type']=='molecule':
                rendered['id']=block.get('id',rendered['id'])
                rendered['references']=references(block.get('references',[]))
                return clean_prose(enrich_names(rendered))
        if block.get('type') in ('mechanism','resonance'):
            if block['type']=='mechanism':
                fields={'type':'mechanism','steps':[{k:v for k,v in step.items() if k in ('smiles','label','iupac_name','arrows','limitation')} for step in block['steps']]}
            else:
                fields={'type':'resonance','caption':block.get('caption',''),'hybrid':bool(block.get('hybrid')),'contributors':[{k:v for k,v in contributor.items() if k in ('smiles','label','arrows')} for contributor in block['contributors']]}
            rendered=render_block(block_adapter.validate_python(fields))
            rendered['id']=block.get('id',rendered['id'])
            rendered['references']=references(block.get('references',[]))
            return clean_prose(enrich_names(rendered))
        return clean_prose(enrich_names(block))
    except (KeyError,TypeError,ValueError,RuntimeError):
        return error_block('This saved diagram could not be displayed. Other parts of your chat are still available.')

def context_content(value):
    if isinstance(value,list):
        return [context_content(v) for v in value]
    if isinstance(value,dict):
        return {k:context_content(v) for k,v in value.items() if k not in ('svg','svg_changes','encoding','id','name_source','atom_charges','validation_notes','references')}
    return value

def create_app(directory: Path, token: str, credentials=None, provider_factory=Provider):
    app = FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    store, vault = Store(directory), credentials or Credentials(directory)
    lookup = Lookup(Cache(str(Path(directory)/'compounds.sqlite3')))
    app.state.store, app.state.vault, app.state.busy = store, vault, False
    key_reads={}
    chemistry_slots=asyncio.Semaphore(2)

    async def native_work(operation,payload,timeout=25,wait=5):
        try:
            await asyncio.wait_for(chemistry_slots.acquire(),wait)
        except asyncio.TimeoutError as exc:
            raise ProcessingError('Other structures are still being processed. Wait a moment, then try this view again.') from exc
        try:
            return await process_chemistry(operation,payload,timeout=timeout)
        finally:
            chemistry_slots.release()

    # Names of accounts that have a stored key (never the keys themselves), so the settings
    # dialog can mark services as "Key saved" without reading each saved key.
    def key_marked(name):
        return name in (store.config(3) or [])
    def mark_key(name,present):
        marked=set(store.config(3) or [])
        if (name in marked)!=present:
            store.save_config(sorted(marked|{name} if present else marked-{name}),3)

    STORE_TIMEOUT='Saved keys could not be read in time. Enter your key for this session.'

    async def read_key(name):
        # Reading saved keys runs off the event loop. Keep health,
        # cancellation and the rest of the chat responsive while that happens.
        task=key_reads.get(name)
        if task is None or task.done():
            task=key_reads[name]=asyncio.create_task(asyncio.to_thread(vault.get,name))
        try:
            value = await asyncio.wait_for(asyncio.shield(task),3)
            if value:
                mark_key(name,True)
            # A later successful read means the store is unlocked again.
            if vault.warning==STORE_TIMEOUT:
                vault.warning=''
            return value
        except asyncio.TimeoutError:
            vault.warning=STORE_TIMEOUT
            return None

    @app.middleware('http')
    async def authenticate(request: Request, call_next):
        auth = request.headers.get('authorization','')
        if not secrets.compare_digest(auth.encode(), f'Bearer {token}'.encode()):
            return JSONResponse({'detail':'Unauthorized'}, status_code=401)
        return await call_next(request)

    @app.get('/health')
    async def health():
        # Read the actual schema; SELECT 1 alone would miss a damaged/missing DB.
        try:
            store.db.execute('SELECT id FROM settings LIMIT 1').fetchall()
            store.db.execute('SELECT id FROM conversations LIMIT 1').fetchall()
        except Exception:
            return JSONResponse({'ok':False,'checks':{'database':False}},status_code=503)
        return {'ok':True,'checks':{'database':True}}

    async def get_config_key():
        config = store.config()
        if not config:
            raise HTTPException(400,'Choose an API provider and model in Settings first.')
        if keyless(config):
            return config,''
        key = await read_key(account(config))
        if not key:
            raise HTTPException(400,'Enter an API key in Settings first.')
        return config,key

    @app.get('/config')
    async def config_get():
        config = store.config()
        local = bool(config and keyless(config))
        has_key = bool(config and not local and await read_key(account(config)))
        # Which services already have a stored key, so the settings dialog can show it per card.
        accounts = {'gemini':'gemini:','openai':'openai:','anthropic':'anthropic:','nvidia':'compatible:https://integrate.api.nvidia.com/v1','openrouter':'compatible:https://openrouter.ai/api/v1'}
        if config and config['provider']=='compatible' and config.get('endpoint') not in ('https://integrate.api.nvidia.com/v1','https://openrouter.ai/api/v1'):
            accounts['compatible'] = account(config)
        # Local and keyless modes never read saved keys.
        saved_keys = {} if local else {name:bool(config and value==account(config) and has_key) or key_marked(value) for name,value in accounts.items()}
        vision=store.config(2)
        vision_key=bool(vision and (keyless(vision) or await read_key('vision:'+account(vision))))
        capability=Provider(vision,'').image_support() if vision and vision_key else Provider(config,'').image_support() if config else 'unknown'
        return {'config':config,'has_key':has_key,'ready':local or has_key,'warning':'' if local else vault.warning,'saved_keys':saved_keys,'image_support':capability,'vision_config':vision,'vision_has_key':vision_key}

    async def save_settings(config, slot, prefix, missing_url):
        # Chat model (slot 1) and Image reader (slot 2, keys under 'vision:') save the same way.
        data = config.model_dump(exclude={'api_key'})
        if config.provider == 'compatible' and not config.endpoint:
            raise HTTPException(400,missing_url)
        if data['model']=='auto':
            # Automatic: try the strongest listed models and keep the best that answers.
            key=config.api_key or ('' if keyless(data) else await read_key(prefix+account(data)))
            try:
                best,backups=await autopick.pick(data,key,provider_factory)
            except ProviderError as exc:
                raise HTTPException(400,str(exc)) from exc
            if not best:
                raise HTTPException(400,'None of the models this key lists answered just now. Try again in a minute, or choose a model yourself.')
            data.update(model=best,fallbacks=backups)
        if config.api_key and not keyless(data):
            vault.set(prefix+account(data),config.api_key)
            mark_key(prefix+account(data),True)
        store.save_config(data,slot)
        return await config_get()

    def forget_key(name):
        try:
            vault.delete(name)
            mark_key(name,False)
        except RuntimeError as exc:
            raise HTTPException(503,str(exc)) from exc

    @app.put('/config')
    async def config_put(config: ProviderConfig):
        return await save_settings(config,1,'','A compatible API requires a base URL.')

    @app.put('/config/vision')
    async def vision_put(config: ProviderConfig):
        return await save_settings(config,2,'vision:','An image-reading API requires a base URL.')

    @app.delete('/config/vision')
    async def vision_delete():
        config=store.config(2)
        if config:
            forget_key('vision:'+account(config))
        store.db.execute('DELETE FROM settings WHERE id=2')
        store.db.commit()
        return await config_get()

    async def vision_provider():
        config=store.config(2)
        if not config:
            raise ProviderError('Configure the Image reader first.')
        key='' if keyless(config) else await read_key('vision:'+account(config))
        if not key and not keyless(config):
            raise ProviderError('Enter the image-reading API key in Model & API.')
        return provider_factory(config,key)

    @app.post('/config/vision/test')
    async def vision_test():
        try:
            provider=await vision_provider()
            # Exercise image transport, not merely a text-only ping.
            import base64
            from io import BytesIO
            from PIL import Image
            sample=BytesIO()
            Image.new('RGB',(128,128),'white').save(sample,format='PNG')
            image=base64.b64encode(sample.getvalue()).decode()
            await interpret_images([{'role':'user','content':{'text':'Describe whether this image contains a readable structure.','images':[{'mime':'image/png','data':image}]}}],provider)
            return {'ok':True}
        except ProviderError as exc:
            raise HTTPException(502,str(exc)) from exc

    @app.delete('/credentials')
    async def credentials_delete():
        config = store.config()
        if config:
            forget_key(account(config))
        return await config_get()

    @app.post('/config/models')
    async def available_models(request: GeminiModelsRequest):
        config = {'provider':request.provider,'endpoint':request.endpoint,'auth_mode':request.auth_mode,'model':''}
        no_key = keyless(config)
        key = '' if no_key else request.api_key or await read_key(('vision:' if request.credential_slot=='vision' else '')+account(config))
        if not key and not no_key:
            raise HTTPException(400,'Enter the API or gateway key first, then load models.')
        try:
            return {'models':await provider_factory(config,key).models()}
        except (ProviderError,ProcessingError) as exc:
            raise HTTPException(502,str(exc)) from exc

    @app.post('/config/test')
    async def connection_test():
        config,key = await get_config_key()
        try:
            # Exercise the same schema and validation as chat, not a weaker plain-text ping.
            chunks = []
            async for chunk in provider_factory(config,key).stream([{'role':'user','content':'Say hello in one short markdown block.'}]):
                chunks.append(chunk)
                if sum(map(len,chunks)) > 200000:
                    raise ProviderError('The provider test response exceeded the size limit.')
            blocks,failed = await native_work('answer',''.join(chunks))
            if failed:
                raise ProviderError('The provider connected but did not produce a valid ChemEZ answer. Try a different text model.')
            return {'ok':True}
        except (ProviderError,ProcessingError) as exc:
            raise HTTPException(502,str(exc)) from exc

    @app.get('/conversations')
    async def conversations():
        return store.conversations()

    @app.post('/structure/3d')
    async def structure_three_d(payload: StructureRequest):
        try:
            return await native_work('3d', payload.smiles, timeout=20)
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post('/structure/analysis')
    async def structure_analysis(payload: StructureRequest):
        try:
            return await native_work('analysis', payload.smiles, timeout=15)
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc

    async def restore_many(blocks):
        if not any(isinstance(block,dict) and block.get('type') in ('molecule','reaction','mechanism','resonance') for block in blocks):
            return [restored_block(block) for block in blocks]
        try:
            return await native_work('restore',blocks,timeout=60)
        except ProcessingError:
            return [block if isinstance(block,dict) and block.get('type') in ('markdown','error') else error_block('This saved diagram could not be restored. Retry the answer; your conversation is safe.') for block in blocks]

    @app.get('/diagrams')
    async def diagram_library():
        items=store.diagrams()
        blocks=await restore_many([item['block'] for item in items])
        return [{**item,'block':block} for item,block in zip(items,blocks)]

    @app.get('/conversations/search')
    async def conversation_search(q: str = ''):
        if len(q)>200:
            raise HTTPException(400,'Search is limited to 200 characters.')
        return store.search(q.strip()) if q.strip() else []

    @app.post('/conversations/{cid}/rewind')
    async def conversation_rewind(cid: str, payload: ConversationRewind):
        if app.state.busy:
            raise HTTPException(409,'Stop the current answer before retrying.')
        if not store.exists(cid):
            raise HTTPException(404,'Conversation not found.')
        try:
            store.rewind_to(cid,payload.before_message_id)
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        return {'id':cid,'messages':store.messages(cid)}

    @app.post('/conversations/{cid}/suggest')
    async def conversation_suggest(cid: str, payload: SuggestRequest):
        """One next question for the chosen mode or command, about this conversation's topic."""
        if not store.exists(cid):
            raise HTTPException(404,'Conversation not found.')
        config,key=await get_config_key()
        recent=[]
        for message in store.messages(cid)[-4:]:
            content=message['content']
            text=content.get('text','') if isinstance(content,dict) else ' '.join(b.get('text') or b.get('caption') or b.get('label') or '' for b in content if isinstance(b,dict))
            recent.append(('Learner: ' if message['role']=='user' else 'Tutor: ')+text[:1200])
        style={'concise':'a quick factual question','balanced':'a "why" or "how" question that needs an explanation','mechanism':'a request to show a reaction mechanism'}[payload.mode]
        task=f'a request for the /{payload.command} command ({COMMANDS[payload.command].split(".")[0]})' if payload.command in COMMANDS else style
        try:
            reply=await ask_plain(config,key,'Conversation so far:\n'+'\n'.join(recent)+f'\n\nWrite the single most useful next message the learner could send: {task}, about the same topic. Under 12 words, no quotes, no command prefix. Reply with the message only.')
        except (ProviderError,TimeoutError) as exc:
            raise HTTPException(502,str(exc)) from exc
        return {'question':clean_next_question(reply)}

    @app.get('/conversations/{cid}')
    async def conversation(cid: str):
        if not store.exists(cid):
            raise HTTPException(404,'Conversation not found.')
        messages=store.messages(cid)
        restored=iter(await restore_many([block for message in messages if message['role']=='assistant' for block in message['content']]))
        for message in messages:
            if message['role']=='assistant':
                message['content']=[next(restored) for block in message['content']]
                if missing_reaction_drawing(message['content']) and not any(block.get('type')=='error' for block in message['content']):
                    message['content'].append({'id':'missing-reaction-'+message['id'],'type':'error','text':'This saved answer has a text equation but no drawn reaction scheme. Use Retry answer to request the structures.'})
        return {'id':cid,'messages':messages}

    @app.patch('/conversations/{cid}')
    async def conversation_update(cid: str, payload: ConversationUpdate):
        if not store.exists(cid):
            raise HTTPException(404,'Conversation not found.')
        title = payload.title.strip()
        if not title:
            raise HTTPException(400,'Enter a conversation name.')
        store.update_conversation(cid, title, payload.pinned, payload.archived)
        return {'ok':True}

    @app.delete('/conversations/{cid}')
    async def conversation_delete(cid: str):
        if app.state.busy:
            raise HTTPException(409,'Stop the current answer before deleting a conversation.')
        store.delete(cid)
        return {'ok':True}

    async def ask_model(config,key,level,instruction):
        """A short model answer (markdown text, follow-ups) for routed questions; never structures."""
        provider=provider_factory(config,key)
        chunks=[]
        async for chunk in provider.stream([{'role':'user','content':{'text':instruction,'images':[]}}],system=answer_system(SYSTEM,'concise',level)+'\nFor this request return exactly one markdown block and no diagrams: ChemEZ draws the verified structures itself.'):
            chunks.append(chunk)
        answer=decode_answer(''.join(chunks))
        text=' '.join(b.get('text','') for b in answer.get('blocks',[]) if b.get('type')=='markdown').strip()
        return text,[f for f in answer.get('follow_ups',[]) if isinstance(f,str)][:3]

    def chat_title(reply):
        """A 2-3 word sidebar name from the model's reply, or '' when it is unusable."""
        line=(reply or '').strip().splitlines()[0] if (reply or '').strip() else ''
        words=re.sub(r'[^\w\s()+-]','',line).split()[:3]
        return ' '.join(w if any(c.isupper() or c.isdigit() for c in w) else w[:1].upper()+w[1:] for w in words) if len(words)>=2 else ''

    def decisions():
        return os.environ.get('CHEMEZ_MODEL_DECISIONS')!='0'

    async def ask_plain(config,key,instruction):
        """The model's raw reply to a short decision request (no answer formatting)."""
        chunks=[]
        async with asyncio.timeout(45):
            async for chunk in provider_factory(config,key).stream([{'role':'user','content':{'text':instruction,'images':[]}}],system='Reply exactly as instructed, with nothing else.'):
                chunks.append(chunk)
        return ''.join(chunks)

    async def find(name,config,key,level):
        """Lookup, with the model as a last resort for names the lookup cannot read."""
        found=await asyncio.to_thread(lookup.find,name)
        if found:
            return found
        try:
            guess,_=await ask_model(config,key,level,f'The user typed "{name}" meaning a chemical compound, possibly misspelled or informal. Reply with only its standard English name, or NONE if it is not a compound.')
        except (ProviderError,ValueError,TypeError,AttributeError):
            return None
        guess=guess.strip().strip('.*"\'`')
        if not guess or guess.upper()=='NONE' or len(guess)>80 or guess.lower()==name.lower():
            return None
        found=await asyncio.to_thread(lookup.find,guess)
        if found and 'record' in found:
            found['interpreted']=guess
        return found

    async def compound_answer(text,config,key,level):
        """Blocks for questions in question_map.json, or None to let the model answer."""
        matched=router.match(text)
        if not matched:
            return None
        intent,slots=matched
        if intent['id']=='name' and decisions() and not lookup.known(slots['name']):
            # A short message is only a compound lookup when the model agrees it names one
            # ("what's up" is small talk, even though PubChem has a compound called UP).
            try:
                verdict=await ask_plain(config,key,f'Is "{slots["name"]}" in the message "{text}" the name of a chemical compound or material? Reply YES or NO only.')
            except (ProviderError,ValueError,TypeError,AttributeError,TimeoutError):
                verdict=''
            if not verdict.strip().upper().startswith('YES'):
                return None
        found={}
        for slot,name in slots.items():
            result=await (asyncio.to_thread(lookup.find,name) if intent.get('quiet') else find(name,config,key,level))
            if not result:
                return None
            if 'ambiguous' in result:
                return [router.ambiguous_block(name,result['ambiguous'])],[]
            found[slot]=result
        blocks=[]
        for spec in intent['show']:
            view,slot=spec.split(':')
            blocks.append(router.compound_block(found[slot]['record'],view,found[slot]['interpreted']))
        titles=[found[s]['record'].get('title') or slots[s] for s in slots]
        if intent['ai']=='comparison':
            instruction=f'In 2-4 sentences, compare {titles[0]} and {titles[1]} for a learner: structure, polarity, physical state and main chemical behaviour.'
        else:
            instruction=f'In one sentence, describe {titles[0]} for a learner (what it is and why it matters).'
        try:
            prose,follow_ups=await ask_model(config,key,level,instruction)
        except (ProviderError,ValueError,TypeError,AttributeError):
            prose,follow_ups='',[]
        if prose:
            blocks.insert(0,{'id':str(uuid4()),'type':'markdown','text':prose})
        return blocks,follow_ups

    @app.post('/chat')
    async def chat(payload: ChatRequest, request: Request):
        config,key = await get_config_key()
        if app.state.busy:
            raise HTTPException(409,'An answer is already being generated.')
        if payload.conversation_id and not store.exists(payload.conversation_id):
            raise HTTPException(404,'Conversation not found.')
        cid = payload.conversation_id or store.create(payload.text.strip() or 'Image question')
        history = store.messages(cid)[-24:]
        # Coalesce consecutive turns after cancellation or a failed response.
        messages = []
        for item in history:
            content = item['content']
            if item['role'] == 'assistant':
                content = [b for b in content if b.get('type') != 'error']
                if not content:
                    continue
                content = json.dumps({'blocks':context_content(content)})
            elif not isinstance(content,dict):
                content = {'text':str(content),'images':[]}
            if messages and messages[-1]['role'] == item['role'] and (item['role']=='assistant' or not (content.get('images') or messages[-1]['content'].get('images'))):
                if item['role']=='user':
                    messages[-1]['content']['text'] += '\n\n' + content.get('text','')
                    messages[-1]['content']['images'].extend(content.get('images',[]))
                else: messages[-1]['content'] += '\n\n' + content
            else:
                messages.append({'role':item['role'],'content':content})
        current = {'command':payload.command,'text':payload.text.strip(),'images':[image.model_dump() for image in payload.images]}
        if messages and messages[-1]['role']=='user' and not (current['images'] or messages[-1]['content'].get('images')):
            messages[-1]['content']['text'] += '\n\n' + current['text']
            messages[-1]['content']['images'].extend(current['images'])
        else:
            messages.append({'role':'user','content':current})
        if sum(len(json.dumps(m['content'])) for m in messages)>34_000_000:
            raise HTTPException(400,'This conversation is too long. Start a new conversation.')
        user_id = store.add(cid,'user',current)
        app.state.busy = True

        async def events():
            nonlocal messages
            def event(kind,**values):
                return json.dumps({'type':kind,**values})+'\n'
            task = None
            try:
                yield event('start',conversation_id=cid,user_id=user_id)
                # Formula-only disambiguation applies to a first turn; follow-ups need context.
                pending_observations=[]
                command,question = payload.command,payload.text
                if command:
                    prefix,remainder=split_command(question)
                    if prefix==command:question=remainder
                quick = formula_only_question(payload.text) if not history and not payload.images and not command else None
                shorthand=re.sub(r'(?i)\s+(?:or something close|or similar)\s*[.!?]*$', '', question).strip()
                interpretation=condensed(shorthand) if not payload.images else None
                if interpretation and command in (None,'nomenclature'):
                    smiles,name=interpretation
                    quick=render_block(block_adapter.validate_python({'type':'molecule','smiles':smiles,'label':name,'iupac_name':name}))
                    quick['interpreted']='Interpreted '+shorthand+' as '+name+'.'
                routed = None
                if not quick and not command and not payload.images and router.match(payload.text):
                    yield event('status',message='Looking up the compound…')
                    routed = await compound_answer(payload.text,config,key,payload.level)
                if quick:
                    blocks = [quick]
                elif routed:
                    blocks,routed_follow_ups = routed
                else:
                    image_turns=[m for m in messages if m['role']=='user' and isinstance(m['content'],dict) and m['content'].get('images')]
                    if image_turns and (store.config(2) or all(m['content'].get('image_observations') for m in image_turns)):
                        yield event('status',message='Reading your images…')
                        async def read_images():
                            try:
                                reader=await vision_provider() if any(not m['content'].get('image_observations') for m in image_turns) else None
                                return await interpret_images(messages,reader)
                            except ProviderError as exc:
                                raise ProviderError('Image reader: '+str(exc)) from exc
                        task=asyncio.create_task(read_images())
                        while not task.done():
                            await asyncio.wait({task},timeout=0.25)
                            if await request.is_disconnected():
                                task.cancel()
                                return
                        messages=await task
                        # Keep observations beside the original image for follow-up turns, but only
                        # after an answer succeeds, so Retry can re-read with a different image reader.
                        def keep_observations():
                            for previous in history:
                                if previous['role']=='user' and isinstance(previous['content'],dict) and previous['content'].get('image_observations'):
                                    store.db.execute('UPDATE messages SET content=? WHERE id=?',(json.dumps(previous['content']),previous['id']))
                            store.db.execute('UPDATE messages SET content=? WHERE id=?',(json.dumps(current),user_id))
                            store.db.commit()
                        pending_observations.append(keep_observations)
                    provider = provider_factory(config,key)
                    # Verified structures for compounds the question names (scenarios D and H).
                    named=router.named_structures(payload.text)
                    verified=('\nVerified structures for compounds in this question (formula and molar mass computed by ChemEZ; use these exact values): '+'; '.join(f'{n} = {smi} ({facts["formula"]}, {facts["molar_mass"]} g/mol)' for n,smi in named.items() for facts in [computed(smi)])) if named else ''
                    # SMILES typed in the question: ChemEZ states their formula and mass itself.
                    typed=[token for token in re.findall(r'[A-Za-z0-9@+\-\[\]()=#$/\\%.]{3,}',question) if re.search(r'[()=#\[\]]|[a-z][0-9]|^[CNOS][CNOScnos]',token) and not token.isalpha()]
                    for token in typed:
                        try:
                            facts=computed(token)
                        except Exception:
                            continue
                        verified+=f'\nThe learner\'s SMILES {token} is {facts["formula"]}, {facts["molar_mass"]} g/mol (computed by ChemEZ; use exactly).'
                    if command=='spectra':
                        for smiles_text in [*named.values(),*typed][:2]:
                            described=nmr.facts(smiles_text)
                            if described:
                                verified+=f'\nStructure facts for {smiles_text} from ChemEZ (reason from these; one ¹³C signal per carbon environment, ¹H integrations sum to the H count): '+described['text']+'\nFill in every ? of this table template (keep every row; add IR rows as needed) and return it as one markdown block after the molecule block:\n'+described['template']
                    route=routes.find(question) if command=='synthesis' else None
                    if route:
                        verified+='\nVerified textbook route for this synthesis (draw each step as a reaction block): '+routes.describe(route)
                    notices=[]
                    async def collect(msgs):
                        chunks,size = [],0
                        if command:
                            # Restate the command's contract beside the question itself; small models
                            # follow the user turn more reliably than the system prompt.
                            last=next((i for i in range(len(msgs)-1,-1,-1) if msgs[i]['role']=='user' and isinstance(msgs[i]['content'],dict)),None)
                            if last is not None:
                                content=msgs[last]['content']
                                text=content.get('text','')
                                if text.lstrip().startswith('/'+command):
                                    msgs=[*msgs[:last],{**msgs[last],'content':{**content,'text':split_command(text)[1]+'\n\n'+COMMANDS[command]}},*msgs[last+1:]]
                        def switched(stalled,next_model):
                            # A stalled model hands over to the next working backup; the one that
                            # answers becomes the saved choice so later questions start there.
                            if stalled:
                                notices.append(f'{stalled.split("/")[-1]} is not responding; trying {next_model.split("/")[-1]}…')
                            else:
                                saved=store.config(1) or config
                                store.save_config({**saved,'model':next_model,'fallbacks':[m for m in [saved['model'],*saved.get('fallbacks',[])] if m!=next_model][:4]},1)
                                notices.append(f'Answered by {next_model.split("/")[-1]}; it is now your model.')
                        async for chunk in autopick.stream_with_fallback(config,key,provider_factory,msgs,answer_system(SYSTEM,payload.response_style,payload.level)+(('\n'+COMMANDS[command]) if command else '')+verified,switched):
                            size += len(chunk)
                            if size > 200000:
                                raise ProviderError('The answer exceeded the size limit. Try a narrower question.')
                            chunks.append(chunk)
                        raw=''.join(chunks)
                        # Opt-in evaluation capture: only synthetic test prompts/answers.
                        # Never record config, HTTP headers, or provider credentials.
                        capture=os.environ.get('CHEMEZ_EVAL_CAPTURE')
                        if capture:
                            destination=Path(capture)
                            destination.mkdir(parents=True,exist_ok=True)
                            (destination/(str(uuid4())+'.json')).write_text(json.dumps({'question':payload.text,'mode':payload.response_style,'answer':raw}),encoding='utf8')
                        return raw
                    # Careful mode: drawing and chemistry failures get up to MAX_REPAIRS focused
                    # repair rounds (users would rather wait than see a wrong drawing). Style-only
                    # problems get one. The best attempt wins: valid beats broken; between broken
                    # attempts, more valid parts wins (ties go to the newer attempt).
                    def better(new,old):
                        if new[1]!=old[1]:
                            return not new[1]
                        if new[1]:
                            return sum(b['type']!='error' for b in new[0])>=sum(b['type']!='error' for b in old[0])
                        return True
                    best=None;raws=[]
                    for attempt in range(1+MAX_REPAIRS):
                        yield event('status',message=f'Checking the drawings carefully (round {attempt} of {MAX_REPAIRS})…' if attempt else 'Generating your answer…')
                        task = asyncio.create_task(collect(messages))
                        waited_since = asyncio.get_running_loop().time()
                        next_update = waited_since + 15
                        while not task.done():
                            await asyncio.wait({task}, timeout=0.25)
                            while notices:
                                yield event('status',message=notices.pop(0))
                            now = asyncio.get_running_loop().time()
                            if now >= next_update and not task.done():
                                yield event('status',message=f'Waiting for the provider to finish… {int(now-waited_since)} seconds. You can cancel.')
                                next_update = now + 15
                            if await request.is_disconnected():
                                task.cancel()
                                return
                        raw = await task
                        yield event('status',message='Validating structures and formatting…')
                        if stepwise.wanted(command,payload.text):
                            raw=stepwise.steps(raw)
                        processing = task = asyncio.create_task(native_work('answer', raw, timeout=60, wait=60))
                        while not processing.done():
                            await asyncio.wait({processing},timeout=0.1)
                            if await request.is_disconnected():
                                processing.cancel()
                                await asyncio.gather(processing,return_exceptions=True)
                                return
                        try:
                            blocks,failed = await processing
                        except ProcessingError as exc:
                            # Keep the explanation readable even if the drawings could not be processed.
                            prose = readable_fallback(raw)
                            blocks = ([{'id':str(uuid4()),'type':'markdown','text':prose}] if prose else [])+[error_block(str(exc))]
                            failed = True
                        issue = command_issue(command,blocks) if command else style_issue(blocks,payload.response_style,question)
                        coverage=diagram_issue(blocks,question,payload.response_style)
                        if coverage:
                            blocks.append(error_block(coverage))
                            failed=True
                        raws.append(raw)
                        outcome=(blocks,failed,raw)
                        if best is None or better(outcome,best):
                            best=outcome
                        # Stop when valid, or when a valid answer is in hand and its one style
                        # repair has been tried, or after the last repair round.
                        if (not failed and not issue) or (not best[1] and attempt) or attempt==MAX_REPAIRS:
                            break
                        # Repair with this round's specific problems.
                        messages = [*messages,{'role':'assistant','content':raw},{'role':'user','content':'Repair the answer JSON, chemistry, and selected answer mode. Return the complete answer with valid blocks. Answer the original chemistry question directly; do not mention validation, previous answers, internal retries, or the repair request. Validation issues: '+json.dumps([b['text'] for b in blocks if b['type']=='error']+([issue] if issue else []))}]
                    blocks,failed,raw=best
                    if command in ('spectra','nomenclature') and not any(block['type']=='molecule' for block in blocks):
                        # ChemEZ draws the compound the question names or types when the model did not.
                        known=next(iter(named.values()),None) or (typed[0] if typed else None)
                        if known:
                            drawn,_=await native_work('answer',json.dumps({'blocks':[{'type':'molecule','smiles':known,'label':next(iter(named),'').capitalize()}]}),timeout=60,wait=60)
                            blocks=drawn+[block for block in blocks if block['type'] not in ('reaction','mechanism','error')]
                            failed=False
                    if command=='spectra':
                        # Spectra answers need the compound and its tables, not reactions or resonance.
                        blocks=[block for block in blocks if block['type'] not in ('reaction','mechanism','resonance')]
                    if command=='spectra':
                        drawn=next((block for block in blocks if block['type']=='molecule'),None)
                        section=drawn and nmr.carbon_section(drawn['smiles'])
                        if section:
                            # ¹³C shifts come from measured spectra, not the model's estimate.
                            tables=[block for block in blocks if block['type']=='markdown' and '|' in block['text']]
                            if tables:
                                tables[0]['text']=nmr.replace_carbon_section(tables[0]['text'],section)
                            else:
                                blocks.append({'id':str(uuid4()),'type':'markdown','text':section})
                    if route and not any(block['type']=='reaction' for block in blocks):
                        # The model explained the route without drawing it: ChemEZ draws the verified steps.
                        drawn,_=await native_work('answer',json.dumps({'blocks':routes.blocks(route)}),timeout=60,wait=60)
                        blocks=drawn+[block for block in blocks if block['type']=='markdown']
                        failed=False
                    if not command and decisions():
                        # The drawing follows the answer: the model reads what it wrote and picks
                        # the diagram; ChemEZ draws that choice and keeps the old one if it fails.
                        # The text is ready: it types out while the drawing is chosen and drawn.
                        draft='\n\n'.join(b['text'] for b in blocks if b['type']=='markdown')
                        if draft:
                            yield event('draft',text=clean_prose(draft))
                        yield event('status',message='Choosing the drawing for this answer…')
                        try:
                            reply=await ask_plain(config,key,drawing.prompt(question,blocks))
                            choice=drawing.wanted(drawing.parse(reply))
                        except (ProviderError,ValueError,TypeError,AttributeError,TimeoutError):
                            choice=None
                        if choice==[]:
                            blocks=drawing.apply(blocks,[]);failed=False
                        elif choice:
                            drawn,broken=await native_work('answer',json.dumps({'blocks':choice}),timeout=60,wait=60)
                            if not broken and drawn:
                                blocks=drawing.apply(blocks,drawn);failed=False
                    if attempt and failed and all(block['type']=='error' for block in blocks):
                        recovered = task = asyncio.create_task(native_work('partial',[raws[0],raws[-1]]))
                        recovered = await recovered
                        if recovered:
                            blocks=recovered
                        else:
                            prose = readable_fallback(raws[0]) or readable_fallback(raws[-1])
                            if prose:
                                blocks = [{'id':str(uuid4()),'type':'markdown','text':prose},error_block('Structure diagrams were unavailable for this answer. Please try again.')]
                    if attempt:
                        remaining_style=command_issue(command,blocks) if command else style_issue(blocks,payload.response_style,question)
                        if remaining_style:
                            blocks.append(error_block('The model did not fully follow the selected answer mode. Retry this answer for the requested explanation style.'))
                # Predictive follow-ups (model-proposed first, then built from the drawings),
                # kept beside the answer rather than inside its blocks.
                follow_ups=[]
                if any(block['type'] not in ('error','clarification') for block in blocks):
                    try:
                        proposed=routed_follow_ups if routed else decode_answer(raw).get('follow_ups') if not quick else None
                    except (ValueError,TypeError,AttributeError,NameError):
                        proposed=None
                    follow_ups=suggest_followups(blocks,proposed)
                # Validation messages are written for the model. When the answer still has
                # content, the learner gets one plain note instead of the technical text.
                technical=[block for block in blocks if block['type']=='error' and not block['text'].startswith(('Structure diagrams were unavailable','The model did not fully follow'))]
                if technical and command in ('calc','stepbystep','lab','practice') and any(block['type']=='markdown' for block in blocks):
                    # These answers stand on their text; an optional drawing that failed is left out quietly.
                    blocks=[block for block in blocks if block not in technical]
                    technical=[]
                if technical and payload.response_style=='balanced' and all(re.search(r'mechanism|electron-flow|arrow',block['text'],re.I) for block in technical):
                    # Explain mode does not need mechanism panels: leave out a failed one quietly.
                    blocks=[block for block in blocks if block not in technical]
                    technical=[]
                if technical and any(block['type'] not in ('error','clarification') for block in blocks):
                    blocks=[block for block in blocks if block not in technical]+[error_block('Part of this answer could not be drawn and checked, so it is left out. Retry for a complete answer.')]
                blocks=move_references(clean_prose(blocks))
                follow_ups=clean_prose(follow_ups)
                mid = store.add(cid,'assistant',blocks,response_style=payload.response_style,follow_ups=follow_ups)
                if any(block['type']!='error' for block in blocks):
                    for keep in pending_observations:
                        keep()
                for block in blocks:
                    yield event('block',block=block)
                yield event('done',message_id=mid,response_style=payload.response_style,follow_ups=follow_ups)
                asked=store.questions(cid)
                if decisions() and (asked==1 or asked%5==0) and any(block['type']!='error' for block in blocks):
                    # A short name for the sidebar after the first question, then refreshed every 5 questions.
                    try:
                        asked_texts=[(m['content'].get('text','') if isinstance(m['content'],dict) else str(m['content']))[:160] for m in store.messages(cid) if m['role']=='user']
                        old_title=next((c['title'] for c in store.conversations() if c['id']==cid),'')
                        prompt=('Name this chemistry chat in 2 or 3 words, Title Case, no quotes or punctuation. Cover the whole chat but lean toward the latest questions'
                                +(f'; the current name is "{old_title}", so give a clearly different name that shows where the chat has moved' if asked>1 else '')+'.\n'
                                +(f'Earlier questions:\n'+'\n'.join(asked_texts[:-5])[-1200:]+'\n' if len(asked_texts)>5 else '')
                                +'Latest questions:\n'+'\n'.join(asked_texts[-5:]))
                        title=chat_title(await ask_plain(config,key,prompt))
                        if title:
                            store.auto_title(cid,title)
                    except Exception:
                        pass
            except (ProviderError,ProcessingError) as exc:
                block = error_block(str(exc))
                mid = store.add(cid,'assistant',[block],response_style=payload.response_style)
                yield event('block',block=block)
                yield event('done',message_id=mid)
            except asyncio.CancelledError:
                raise
            except Exception:
                import logging
                logging.getLogger('chemez').exception('Local answer processing failed')
                block = error_block('The local service could not complete this answer. Please retry.')
                store.add(cid,'assistant',[block],response_style=payload.response_style)
                yield event('block',block=block)
                yield event('done')
            finally:
                if task and not task.done():
                    task.cancel()
                app.state.busy = False
        return StreamingResponse(events(),media_type='application/x-ndjson',headers={'Cache-Control':'no-store'})
    return app
