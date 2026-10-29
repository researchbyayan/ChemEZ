import {useEffect,useRef,useState} from 'react';
import {LEVELS,type Level} from './levels';
import type {Config,ConfigState,ProviderName} from './types';
import {errorMessage as friendly} from './errors';
type Choice={id:string;label:string;free_tier?:boolean};
type Service='openrouter'|'gemini'|'openai'|'anthropic'|'nvidia'|'ollama'|'compatible';
const geminiModel='gemini-3.5-flash-lite';
const nvidiaURL='https://integrate.api.nvidia.com/v1';
const openrouterURL='https://openrouter.ai/api/v1';
// Fixed-endpoint services that run on the OpenAI-compatible protocol.
const hosted:Partial<Record<Service,string>>={nvidia:nvidiaURL,openrouter:openrouterURL};
// A pasted key's prefix tells which service issued it.
const keyService=(value:string):Service|null=>/^nvapi-/.test(value)?'nvidia':/^sk-ant-/.test(value)?'anthropic':/^sk-or-/.test(value)?'openrouter':/^sk-/.test(value)?'openai':/^AIza/.test(value)?'gemini':null;
const services:Record<Service,{name:string;icon:string;blurb:string;keyHint?:string;keySource?:string;note:string}>={
  openrouter:{name:'OpenRouter',icon:'fas fa-route',blurb:'Sign in, no key to copy',keyHint:'Or paste an OpenRouter key (sk-or-…)',keySource:'openrouter.ai',note:'Sign in with your OpenRouter account and ChemEZ receives a key automatically. Free models are available; paid models use your OpenRouter credits.'},
  gemini:{name:'Google Gemini',icon:'fab fa-google',blurb:'Free tier available',keyHint:'Paste your Google AI Studio key',keySource:'aistudio.google.com',note:'Flash-Lite has a free tier on eligible Free-tier projects; paid projects are billed.'},
  openai:{name:'OpenAI',icon:'fas fa-bolt',blurb:'GPT models',keyHint:'Paste your OpenAI API key (sk-…)',keySource:'platform.openai.com',note:'API usage is billed separately from a ChatGPT subscription.'},
  anthropic:{name:'Anthropic',icon:'fas fa-feather-alt',blurb:'Claude models',keyHint:'Paste your Anthropic API key (sk-ant-…)',keySource:'console.anthropic.com',note:'API usage is billed separately from a Claude subscription.'},
  nvidia:{name:'NVIDIA',icon:'fas fa-microchip',blurb:'Hosted open models',keyHint:'Paste your NVIDIA API key (nvapi-…)',keySource:'build.nvidia.com',note:'Free hosted prototyping is available through the NVIDIA Developer Program. Your account’s model access and rate limits apply.'},
  ollama:{name:'Ollama',icon:'fas fa-laptop',blurb:'Runs on this Mac, no key',note:'Start Ollama and download a text model first. Larger models need more memory.'},
  compatible:{name:'Custom',icon:'fas fa-plug',blurb:'OpenAI-compatible URL',keyHint:'Gateway or provider key',note:'Any OpenAI-compatible endpoint or local gateway (LiteLLM, Routerly). Its own billing applies.'},
};
const order:Service[]=['openrouter','gemini','nvidia','openai','anthropic','ollama','compatible'];
const serviceOf=(config:Config|null):Service=>!config?'openrouter':config.provider==='compatible'?(config.endpoint===nvidiaURL?'nvidia':config.endpoint===openrouterURL?'openrouter':'compatible'):config.provider;
const isLoopback=(url:string)=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);}catch{return false;}};

function ConnectionSettings({initial,onClose,onSave,vision=false,onSwitch,level,onLevel}:{initial:ConfigState;onClose:()=>void;onSave:(state:ConfigState)=>void;vision?:boolean;onSwitch:(vision:boolean)=>void;level:Level;onLevel:(level:Level)=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const rootState=initial;
  initial=vision?{...initial,config:initial.vision_config||null,has_key:!!initial.vision_has_key,ready:!!initial.vision_has_key,saved_keys:{}}:initial;
  const active=initial.config?serviceOf(initial.config):null;
  const [state,setState]=useState(initial);
  const [service,setService]=useState<Service>(active||(vision&&rootState.config?serviceOf(rootState.config):'openrouter'));
  const [key,setKey]=useState('');
  const [showKey,setShowKey]=useState(false);
  const [endpoint,setEndpoint]=useState(active==='compatible'?initial.config!.endpoint:'');
  const [authMode,setAuthMode]=useState<'api_key'|'none'>(active==='compatible'?initial.config!.auth_mode||'api_key':'api_key');
  const [model,setModel]=useState(active?initial.config!.model:'auto');
  const [models,setModels]=useState<Choice[]>([]);
  const [freeOnly,setFreeOnly]=useState(true);
  const [manual,setManual]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState<{kind:'info'|'ok'|'error';text:string}|null>(null);
  const keyless=service==='ollama'||(service==='compatible'&&authMode==='none');
  const savedKey=!keyless&&(!!state.saved_keys?.[service]||(service===active&&state.has_key));
  const canDiscover=keyless||savedKey||key.trim().length>=8;
  const choices=service==='gemini'&&freeOnly?models.filter(m=>m.free_tier):models;
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  // Any change after a successful check needs a new Save & connect.
  useEffect(()=>{setStatus(current=>current?.kind==='ok'?null:current);},[service,endpoint,authMode,model]);

  async function discover(apiKey=key.trim()){
    if(service==='compatible'&&!endpoint)return;
    if(service==='compatible'&&authMode==='none'&&!isLoopback(endpoint)){setStatus({kind:'error',text:'No-key access is only allowed for a gateway on this computer (localhost). Add a key for remote endpoints.'});return;}
    // A model list that arrives after a successful save must not undo "Connected".
    setLoading(true);setStatus(current=>current?.kind==='ok'?current:null);
    try{
      const provider=hosted[service]?'compatible':service;
      const result=await window.chemez.request('loadModels',{credential_slot:vision?'vision':'chat',provider:provider as 'gemini'|'ollama'|'compatible'|'openai'|'anthropic',...(hosted[service]?{endpoint:hosted[service]}:service==='compatible'?{endpoint,auth_mode:authMode}:{}),...(!keyless&&apiKey?{api_key:apiKey}:{})});
      const found=service==='nvidia'?result.models.filter(m=>!/(embed|rerank|guard|reward|safety|qwen-image|stable-diffusion|\/flux)/i.test(m.id)):result.models;
      setModels(found);
      if(!found.length){setManual(true);setStatus({kind:'info',text:'No models were listed. Type the model ID instead.'});return;}
      setManual(false);
      const pool=service==='gemini'&&freeOnly&&found.some(m=>m.free_tier)?found.filter(m=>m.free_tier):found;
      if(model!=='auto'&&!pool.some(m=>m.id===model))setModel((vision?pool.find(m=>/vision|(?:^|[-/])vl(?:[-/]|$)|qwen3\.5/i.test(m.id))?.id:undefined)||pool.find(m=>m.id===geminiModel)?.id||(!vision?pool.find(m=>m.id==='meta/llama-3.1-8b-instruct')?.id:undefined)||pool[0].id);
    }catch(e){setManual(true);setStatus({kind:'error',text:friendly(e)});}finally{setLoading(false);}
  }
  // Load models as soon as the service can be asked: saved key, keyless mode, or a pasted key.
  useEffect(()=>{if(keyless||savedKey)void discover();},[service,authMode]);
  // A typed URL is checked once typing pauses, not on every keystroke.
  useEffect(()=>{if(service!=='compatible'||!endpoint||!(keyless||savedKey))return;const timer=setTimeout(()=>void discover(),700);return()=>clearTimeout(timer);},[endpoint]);
  useEffect(()=>{if(!key.trim()||keyless)return;const timer=setTimeout(()=>{if(key.trim().length>=8)void discover(key.trim());},700);return()=>clearTimeout(timer);},[key]);

  function choose(value:Service){
    if(value===service)return;
    setService(value);setKey('');setShowKey(false);setModels([]);setManual(false);setStatus(null);
    setModel(value===active?initial.config!.model:value==='ollama'?'':'auto');
    setEndpoint(value==='compatible'&&active==='compatible'?initial.config!.endpoint:'');
    setAuthMode(value==='compatible'&&active==='compatible'?initial.config!.auth_mode||'api_key':'api_key');
  }
  async function connect(){
    if(!keyless&&!key.trim()&&!savedKey){setStatus({kind:'error',text:'Paste your API key first.'});return;}
    if(service==='compatible'&&!endpoint){setStatus({kind:'error',text:'Enter the API base URL.'});return;}
    if(service==='compatible'&&authMode==='none'&&!isLoopback(endpoint)){setStatus({kind:'error',text:'No-key access is only allowed for a gateway on this computer (localhost). Add a key for remote endpoints.'});return;}
    if(!model.trim()){setStatus({kind:'error',text:'Choose a model first.'});return;}
    setBusy(true);setStatus({kind:'info',text:model==='auto'?'Finding the best model that answers this key… (up to 30 seconds)':'Saving and checking with a short test answer…'});
    try{
      const config:Config={provider:(hosted[service]?'compatible':service) as ProviderName,endpoint:hosted[service]||(service==='compatible'?endpoint:service==='ollama'?'http://127.0.0.1:11434/v1':''),model:model.trim(),...(service==='compatible'?{auth_mode:authMode}:{}),...(!keyless&&key.trim()?{api_key:key.trim()}:{})};
      const result=await window.chemez.request(vision?'saveVisionConfig':'saveConfig',config);
      setState(vision?{...result,config:result.vision_config||null,has_key:!!result.vision_has_key,ready:!!result.vision_has_key,saved_keys:{}}:result);onSave(result);
      await window.chemez.request(vision?'testVisionConnection':'testConnection');
      const chosen=(vision?result.vision_config:result.config)?.model;
      setModel(chosen||model);
      setStatus({kind:'ok',text:(model==='auto'&&chosen?`Picked ${chosen.split('/').pop()}${(vision?result.vision_config:result.config)?.fallbacks?.length?`, with ${(vision?result.vision_config:result.config)!.fallbacks!.length} working backups if it stalls`:''}. `:'')+(vision?'Image reader connected. Image input was accepted; accuracy still depends on the model.':'Connected. You’re ready to chat.')});
    }catch(e){setStatus({kind:'error',text:friendly(e)});}finally{setBusy(false);}
  }
  async function signIn(){
    setBusy(true);setStatus({kind:'info',text:'Approve ChemEZ in your browser. Then it picks the best free model that answers…'});
    try{const result=await window.chemez.signInOpenRouter!();setState(result);onSave(result);setModel(result.config?.model||'auto');setStatus({kind:'ok',text:`Signed in. Using ${result.config?.model.split('/').pop()}${result.config?.fallbacks?.length?`, with ${result.config.fallbacks.length} working backups`:''}.`});}
    catch(e){setStatus({kind:'error',text:friendly(e)});}finally{setBusy(false);}
  }
  async function removeKey(){
    setBusy(true);
    try{const result=await window.chemez.request(vision?'deleteVisionConfig':'deleteKey');setState(vision?{...result,config:result.vision_config||null,has_key:!!result.vision_has_key,ready:!!result.vision_has_key,saved_keys:{}}:result);onSave(result);setKey('');setModels([]);setStatus({kind:'info',text:'Saved key removed.'});}
    catch(e){setStatus({kind:'error',text:friendly(e)});}finally{setBusy(false);}
  }
  const info=services[service];
  return <dialog ref={dialog} className="settings api-settings" aria-labelledby="connect-title" onCancel={onClose}>
    <div className="settings-header"><h2 id="connect-title">Model &amp; API</h2><button aria-label="Close settings" onClick={onClose}><i className="fas fa-times" aria-hidden="true"/></button></div>
    <label className="settings-level">Answer level<select aria-label="Chemistry level" value={level} onChange={e=>onLevel(e.target.value as Level)}>{(Object.keys(LEVELS) as Level[]).map(value=><option key={value} value={value}>{LEVELS[value].label}</option>)}</select></label>
    <p className={'connection-summary'+(state.config&&(state.ready??state.has_key)?' live':'')}>{state.config&&(state.ready??state.has_key)?<><span className="dot" aria-hidden="true"/>{vision?'Reading images with':'Using'} {services[serviceOf(state.config)].name} · <strong>{state.config.model}</strong></>:vision?'Image reader not set up. It’s optional: your chat model reads images it supports.':'Not connected yet. Pick a service to start.'}</p>
    <div className="connection-tabs" role="tablist" aria-label="Model role"><button type="button" role="tab" aria-selected={!vision} disabled={busy} onClick={()=>onSwitch(false)}>Chat model</button><button type="button" role="tab" aria-selected={vision} disabled={busy} onClick={()=>onSwitch(true)}>Image reader <span>Optional</span></button></div>
    <p className="storage-note">{vision?'Choose an image-understanding chat model, not an image generator such as qwen-image. Images go to this service; extracted observations go to your chat model. Each service’s usage limits apply.':rootState.vision_config?'Images → image reader → chat model. Text questions use only this chat model.':'Your chat model handles text and images it supports. Add an optional Image reader to use a separate vision API.'}</p>
    {vision&&rootState.vision_config&&<button type="button" className="text-action" disabled={busy} onClick={()=>void removeKey()}>Disable image reader and remove its key</button>}
    <form onSubmit={e=>{e.preventDefault();void connect();}}>
      <div className="service-grid" role="radiogroup" aria-label="Service">{order.map(id=><button key={id} type="button" role="radio" aria-checked={service===id} disabled={busy} className="service-card" onClick={()=>choose(id)}>
        <i className={services[id].icon} aria-hidden="true"/><span className="service-name">{services[id].name}</span><span className="service-blurb">{services[id].blurb}</span>
        {(id===active||state.saved_keys?.[id])&&<span className="service-badge">{id===active?'Active':'Key saved'}</span>}
      </button>)}</div>
      <p className="storage-note">{info.note}</p>
      {service==='compatible'&&<div className="field-row">
        <label>Preset<select aria-label="Gateway preset" value={endpoint==='http://127.0.0.1:4000/v1'?'litellm':endpoint==='http://127.0.0.1:3000/v1'?'routerly':'custom'} disabled={busy} onChange={e=>{const value=e.target.value==='litellm'?'http://127.0.0.1:4000/v1':e.target.value==='routerly'?'http://127.0.0.1:3000/v1':'';setEndpoint(value);setModels([]);setModel('auto');}}><option value="custom">Custom URL</option><option value="litellm">Local LiteLLM</option><option value="routerly">Local Routerly</option></select></label>
        <label className="grow">API base URL<input aria-label="API base URL" type="url" required value={endpoint} disabled={busy} onChange={e=>setEndpoint(e.target.value)} placeholder="https://your-provider.example/v1"/></label>
        <label>Authentication<select aria-label="Authentication" value={authMode} disabled={busy} onChange={e=>setAuthMode(e.target.value as 'api_key'|'none')}><option value="api_key">API key</option><option value="none">No key (localhost only)</option></select></label>
      </div>}
      {service==='openrouter'&&!vision&&window.chemez.signInOpenRouter&&<button type="button" className="signin-button" disabled={busy} onClick={()=>void signIn()}><i className="fas fa-sign-in-alt" aria-hidden="true"/> Sign in with OpenRouter</button>}
      {!keyless&&<label>API key<span className="key-field"><input aria-label="API key" type={showKey?'text':'password'} autoComplete="off" spellCheck={false} disabled={busy} value={key} onChange={e=>{const value=e.target.value.trim();const detected=keyService(value);if(detected&&detected!==service&&!vision){choose(detected);setStatus({kind:'info',text:`That looks like ${/^[AEIOU]/.test(services[detected].name)?"an":"a"} ${services[detected].name} key, so ${services[detected].name} is selected.`});}setKey(e.target.value);if(status?.kind==='ok')setStatus(null);}} placeholder={savedKey?'Saved key will be used. Paste a new one to replace it.':info.keyHint}/><button type="button" className="key-visibility" aria-label={showKey?'Hide API key':'Show API key'} onClick={()=>setShowKey(!showKey)}><i className={showKey?'far fa-eye-slash':'far fa-eye'} aria-hidden="true"/></button></span>
        <span className="field-help">{info.keySource&&<>Get a key at {info.keySource}. </>}{state.warning?'This key is kept only until you close the app.':'Saved in ChemEZ’s private data folder on this Mac, readable only by your user account. Never in chats.'}{savedKey&&service===active&&<> <button type="button" className="text-action" disabled={busy} onClick={()=>void removeKey()}>Remove saved key</button></>}</span></label>}
      <div className="model-field">
        <div className="model-label"><span id="model-label">Model</span>{loading?<span className="model-loading"><i className="fas fa-circle-notch fa-spin" aria-hidden="true"/> Loading models…</span>:canDiscover&&<button type="button" className="text-action" disabled={busy} onClick={()=>void discover()}><i className="fas fa-sync-alt" aria-hidden="true"/> Refresh list</button>}</div>
        {service!=='ollama'&&!manual&&models.length===0&&<select aria-label="Model" value="auto" disabled={busy} onChange={()=>{}}><option value="auto">Automatic: best model that answers</option></select>}
        {models.length>0&&!manual?<select aria-label="Model" value={model==='auto'||choices.some(m=>m.id===model)?model:''} disabled={busy} onChange={e=>setModel(e.target.value)}>{service!=='ollama'&&<option value="auto">Automatic: best model that answers</option>}{model!=='auto'&&!choices.some(m=>m.id===model)&&<option value="" disabled>Choose a model</option>}{choices.map(m=><option key={m.id} value={m.id}>{m.label===m.id?m.id:`${m.label} — ${m.id}`}</option>)}</select>
          :(manual||service==='ollama')&&<input aria-label="Model ID" value={model} disabled={busy} maxLength={150} onChange={e=>setModel(e.target.value)} placeholder={canDiscover?'Type the exact model ID':'Add your key to list available models'}/>}
        <span className="field-help">
          {service==='gemini'&&models.length>0&&!manual&&<label className="inline-check"><input type="checkbox" checked={freeOnly} onChange={e=>setFreeOnly(e.target.checked)}/>Free-tier models only</label>}
          {models.length>0&&<button type="button" className="text-action" onClick={()=>setManual(!manual)}>{manual?'Pick from the list':'Type a model ID instead'}</button>}
        </span>
      </div>
      {status&&<p className={'notice '+(status.kind==='ok'?'connected':status.kind==='error'?'error':'')} role="status">{status.text}</p>}
      <div className="settings-buttons"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><span/>{status?.kind==='ok'?<button type="button" className="primary" onClick={onClose}>Start chatting <i className="fas fa-arrow-right" aria-hidden="true"/></button>:<button type="submit" className="primary" disabled={busy||loading}>{busy?'Connecting…':<>Save &amp; connect <i className="fas fa-plug" aria-hidden="true"/></>}</button>}</div>
    </form>
  </dialog>;
}

export function Settings(props:{level:Level;onLevel:(level:Level)=>void;initial:ConfigState;onClose:()=>void;onSave:(state:ConfigState)=>void}){
  const [vision,setVision]=useState(false);
  const [state,setState]=useState(props.initial);
  return <ConnectionSettings level={props.level} onLevel={props.onLevel} key={vision?'vision':'chat'} initial={state} vision={vision} onSwitch={setVision} onClose={props.onClose} onSave={value=>{setState(value);props.onSave(value);}}/>;
}
