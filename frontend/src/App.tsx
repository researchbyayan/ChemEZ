import {References} from './References';
import {TypedText} from './TypedText';
import {composerSuggestion,cleanSuggestion} from './suggest';
import {Fragment,lazy,Suspense,useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Logo} from './Logo';
import {Dialog} from './Dialog';
import {COMMAND_NAMES,COMMAND_PLACEHOLDERS,commandQuery,removeCommandQuery} from './commands';
import {UserMessage} from './UserMessage';
import {RenderBoundary} from './RenderBoundary';
import {imageDimensions,MAX_IMAGE_BYTES,MAX_IMAGE_EDGE} from '../../shared/image-input.mjs';
const AnswerBlocks=lazy(()=>import('./Blocks').then(module=>({default:module.AnswerBlocks})));
const About=lazy(()=>import('./About'));
const Settings=lazy(()=>import('./Settings').then(module=>({default:module.Settings})));
const StructureLibrary=lazy(()=>import('./StructureLibrary'));
import {answerText} from './answer';
import {LEVELS,saveLevel,storedLevel,type Level} from './levels';
import {LevelChooser} from './LevelChooser';
import {GlassEdges,storedGlassMode,type GlassMode} from './GlassEdges';
import {Wordmark} from './Wordmark';
import {HeroWord} from './HeroWord';
import {errorMessage} from './errors';
import {applyDiagramPreferences,DiagramPreferences} from './DiagramPreferences';
import type {Block,ConfigState,Conversation,ImageAttachment,Message,UserContent} from './types';

const prompts=[{title:'Draw a molecule',text:'Draw aspirin and explain its functional groups.'},{title:'Explain a reaction',text:'Show the esterification of ethanol with acetic acid, including reagents and conditions.'},{title:'Explore a mechanism',text:'Explain the SN2 mechanism of hydroxide reacting with bromomethane, with electron-pushing arrows.'}];
const userContent=(message:Message):UserContent=>typeof message.content==='string'?{text:message.content,images:[]}:message.content as UserContent;
const historyGroup=(chat:Conversation)=>chat.archived?'Archived':chat.pinned?'Pinned':new Date(chat.updated).toDateString()===new Date().toDateString()?'Today':Date.now()-new Date(chat.updated).getTime()<7*86400000?'Previous 7 days':'Earlier';
const SLASH_COMMANDS:[string,string][]=[['/versus','Compare two compounds or reactions side by side'],['/stepbystep','Numbered steps, one drawing or equation each'],['/synthesis','Route from a starting material to a target'],['/practice','One exam-style question, answer hidden'],['/nomenclature','Name ↔ structure with the naming rules'],['/lab','Procedure, workup and hazards'],['/calc','Worked calculation with units checked'],['/spectra','Predicted IR, NMR and mass spectra']];

export default function App(){
  const [config,setConfig]=useState<ConfigState>({config:null,has_key:false,warning:''});
  const [settings,setSettings]=useState(false);
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [cid,setCid]=useState<string|null>(null);
  const cidRef=useRef<string|null>(null);
  const activity=useRef(0);
  const submission=useRef<UserContent|null>(null);
  const submissionStarted=useRef(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [input,setInput]=useState(()=>localStorage.getItem('chemez-draft')||'');
  const [images,setImages]=useState<ImageAttachment[]>([]);
  const [busy,setBusy]=useState(false);
  // The chat whose answer is generating; other chats stay open to browse and start meanwhile.
  const [runCid,setRunCid]=useState<string|null>(null);
  const runActivity=useRef(0);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [copied,setCopied]=useState('');
  const end=useRef<HTMLDivElement>(null);
  const composer=useRef<HTMLTextAreaElement>(null);
  const scroll=useRef<HTMLDivElement>(null);
  const follows=useRef(true);
  const [showJump,setShowJump]=useState(false);
  const [search,setSearch]=useState('');
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('chemez-sidebar')==='collapsed');
  const [chatMenu,setChatMenu]=useState<string|null>(null);
  const [chatMenuPlace,setChatMenuPlace]=useState<CSSProperties>({});
  const chatMenuRef=useRef<HTMLDivElement>(null);
  // The chat list scrolls and the sidebar footer sits on top of it, so the actions menu is
  // drawn above everything at the trigger's position, opening upwards when space runs out.
  function openChatMenu(id:string,trigger:HTMLElement){
    if(chatMenu===id){setChatMenu(null);return;}
    const r=trigger.getBoundingClientRect(),height=190,left=Math.max(8,Math.min(r.right-190,window.innerWidth-198));
    setChatMenuPlace(r.bottom+height+8<window.innerHeight?{left,top:r.bottom+4}:{left,bottom:window.innerHeight-r.top+4});
    setChatMenu(id);
  }
  const [renaming,setRenaming]=useState<Conversation|null>(null);
  const [deleting,setDeleting]=useState<Conversation|null>(null);
  const [renameTitle,setRenameTitle]=useState('');
  // Background opacity 50–100%; older saved values are clamped into range.
  const [glass,setGlass]=useState(()=>Math.min(100,Math.max(50,Number(localStorage.getItem('chemez-glass')||85))));
  const [appearance,setAppearance]=useState(false);
  const [settingsTab,setSettingsTab]=useState<'general'|'appearance'|'diagrams'|'model'|'about'>('general');
  const [followupHints,setFollowupHints]=useState(()=>localStorage.getItem('chemez-followup-hints')!=='off');
  const [reducedTransparency,setReducedTransparency]=useState(false);
  const [archived,setArchived]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [results,setResults]=useState<Conversation[]>([]);
  const [searching,setSearching]=useState(false);
  const [searchError,setSearchError]=useState('');
  const [help,setHelp]=useState(false);
  const [preview,setPreview]=useState<ImageAttachment|null>(null);
  const [library,setLibrary]=useState(false);
  // A previously chosen "Step-by-step tutor" style (removed) falls back to Explain.
  const [answerStyle,setAnswerStyle]=useState<'balanced'|'concise'|'mechanism'>(()=>{const value=localStorage.getItem('chemez-answer-style');return value==='balanced'||value==='mechanism'?value:'concise';});
  const [zoom,setZoom]=useState(100);
  const [editing,setEditing]=useState<Message|null>(null);
  const [toast,setToast]=useState<{text:string;undo?:()=>void}|null>(null);
  const drafts=useRef(new Map<string,UserContent>());
  const menuRef=useRef<HTMLElement>(null);
  const visibleChats=conversations.filter(chat=>!!chat.archived===archived);
  const refresh=useCallback(async()=>setConversations(await window.chemez.request('listConversations')),[]);
  useEffect(()=>{document.documentElement.dataset.theme='dark';applyDiagramPreferences();},[]);
  useEffect(()=>{void window.chemez?.appearance?.().then(state=>setReducedTransparency(state.reducedTransparency));},[]);
  useEffect(()=>{localStorage.setItem('chemez-draft',input);drafts.current.set(cid||'new',{text:input,images});},[input,images,cid]);
  useEffect(()=>{localStorage.setItem('chemez-sidebar',collapsed?'collapsed':'expanded');},[collapsed]);
  // The most likely next question, shown faded in the empty composer (Tab accepts it).
  const last=messages[messages.length-1];
  useEffect(()=>{localStorage.setItem('chemez-answer-style',answerStyle);},[answerStyle]);
  const [level,setLevel]=useState<Level|null>(storedLevel);
  const [glassMode,setGlassMode]=useState<GlassMode>(storedGlassMode);
  useEffect(()=>{try{localStorage.setItem('chemez-glass-effects',glassMode);}catch{/* per session */}document.documentElement.dataset.glass=glassMode;},[glassMode]);
  const [levelOpen,setLevelOpen]=useState(()=>storedLevel()===null);
  const chooseLevel=(value:Level)=>{setLevel(value);saveLevel(value);setLevelOpen(false);};
  // Repaint after big view changes so the transparent window drops stale pixels (ghosted
  // welcome text). Two frames later, once React and the compositor have committed the change.
  const showingWelcome=messages.length===0;
  useEffect(()=>{let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>void window.chemez.windowAction('repaint').catch(()=>{}));});return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};},[showingWelcome,cid,settings,levelOpen,appearance]);
  useEffect(()=>{document.documentElement.style.setProperty('--glass-opacity',String(glass/100));document.documentElement.style.setProperty('--glass-blur',`${Math.round(8+(glass-50)*0.48)}px`);localStorage.setItem('chemez-glass',String(glass));},[glass]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='o'){event.preventDefault();newChat();}if(event.key==='Escape'){setChatMenu(null);setAppearance(false);}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(true);}if((event.metaKey||event.ctrlKey)&&event.key==='/'){event.preventDefault();setHelp(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy]);
  useEffect(()=>{if(!chatMenu)return;const close=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node)&&!chatMenuRef.current?.contains(event.target as Node))setChatMenu(null);};const dismiss=()=>setChatMenu(null);document.addEventListener('pointerdown',close);window.addEventListener('resize',dismiss);document.querySelector('.sidebar nav')?.addEventListener('scroll',dismiss);return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',dismiss);document.querySelector('.sidebar nav')?.removeEventListener('scroll',dismiss);};},[chatMenu]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!searchOpen)return;let current=true;
    if(!search.trim()){setResults([]);setSearching(false);setSearchError('');return;}
    setSearching(true);setSearchError('');
    const timer=setTimeout(()=>{void window.chemez.request('searchConversations',search.trim()).then(items=>{if(current)setResults(items);}).catch(e=>{if(current)setSearchError(errorMessage(e));}).finally(()=>{if(current)setSearching(false);});},180);
    return()=>{current=false;clearTimeout(timer);};
  },[search,searchOpen]);
  useEffect(()=>{
    if(!window.chemez){setError('Open ChemEZ in Electron with npm run dev. The browser preview cannot access desktop services.');return;}
    const initialActivity=activity.current;
    const saved=localStorage.getItem('chemez-active-chat');
    void Promise.all([window.chemez.request('getConfig').then(setConfig),refresh()]).then(async()=>{
      if(saved&&activity.current===initialActivity){
        const data=await window.chemez.request('getConversation',saved);
        if(activity.current===initialActivity){cidRef.current=saved;setCid(saved);setMessages(data.messages);}
      }
    }).catch(e=>setError(errorMessage(e)));
    return window.chemez.onEvent(event=>{
      if(event.type==='start'){
        submissionStarted.current=true;
        setRunCid(event.conversation_id!);
        if(activity.current===runActivity.current){cidRef.current=event.conversation_id!;setCid(event.conversation_id!);setMessages(items=>items.map(m=>m.id==='pending-user'?{...m,id:event.user_id!}:m));}
      }else if(event.type==='status')setStatus(event.message||'');
      else if(event.type==='draft'&&event.text)setMessages(items=>items.map(m=>m.id==='pending-assistant'?{...m,draft:event.text}:m));
      else if(event.type==='block'&&event.block)setMessages(items=>items.map(m=>m.id==='pending-assistant'?{...m,draft:undefined,content:[...(m.content as Block[]),event.block!]}:m));
      else if(event.type==='done')setMessages(items=>items.map(message=>message.id==='pending-assistant'?{...message,id:event.message_id||message.id,...(event.follow_ups?.length?{follow_ups:event.follow_ups}:{})}:message));
      else if(event.type==='error')setError(event.message||'The request failed.');
      else if(event.type==='finished'){
        setRunCid(null);
        if(!submissionStarted.current&&submission.current&&activity.current===runActivity.current){const draft=submission.current;setInput(current=>current||draft.text);setImages(current=>current.length?current:draft.images);setMessages(items=>items.filter(message=>!message.id.startsWith('pending-')));}
        submission.current=null;
        setBusy(false);setStatus('');
        void refresh().catch(e=>setError(errorMessage(e)));
        const completedId=cidRef.current;
        const completedActivity=activity.current;
        if(completedId)void window.chemez.request('getConversation',completedId).then(data=>{if(cidRef.current===completedId&&activity.current===completedActivity)setMessages(data.messages);}).catch(e=>setError(errorMessage(e)));
      }
    });
  },[refresh]);
  useEffect(()=>{if(cid)localStorage.setItem('chemez-active-chat',cid);else localStorage.removeItem('chemez-active-chat');},[cid]);
  useEffect(()=>{if(follows.current)end.current?.scrollIntoView({behavior:'auto'});},[messages,status]);
  useEffect(()=>{if(!scroll.current)return;const observer=new ResizeObserver(()=>{if(follows.current)end.current?.scrollIntoView({behavior:'auto'});});observer.observe(scroll.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{const element=composer.current;if(element){element.style.height='0px';element.style.height=Math.min(180,Math.max(44,element.scrollHeight))+'px';}},[input]);
  async function send(text=input,attached=images,branchQuestion=editing){
    if(busy||(!text.trim()&&!attached.length))return;
    // A chosen slash command travels with the question but is never typed into it.
    const fromComposer=text===input;
    // A command typed in full at the start ("/stepbystep benzene") counts the same as one picked from the menu.
    const typed=/^\/\w+/.exec(text.trim())?.[0].toLowerCase();
    const selected=fromComposer&&slash?slash:typed&&COMMAND_NAMES[typed]?typed:'';
    if(selected)text=selected+' '+text.trim().replace(/^\/\w+\s*/,'');
    if(attached.length&&config.image_support==='unsupported'){setError('This model accepts text only. Add an Image reader or choose a vision-capable chat model in Model & API. Your attachments are still here.');return;}
    if(!(config.ready??config.has_key)||!config.config){setSettings(true);return;}
    if(fromComposer&&selected)setSlash('');
    activity.current++;
    runActivity.current=activity.current;setRunCid(cidRef.current);
    setBusy(true);setError('');setStatus('Preparing your answer…');follows.current=true;
    const userContent:UserContent={text:text.trim(),images:attached,command:selected?selected.slice(1):null};
    submission.current=userContent;submissionStarted.current=false;
    // A suggested follow-up is sent as-is; only clear the composer when sending its own draft.
    if(fromComposer&&attached===images){setInput('');setImages([]);setEditing(null);drafts.current.set(cid||'new',{text:'',images:[]});}
    try{
      let previous=messages;
      if(branchQuestion&&cidRef.current){const rewound=await window.chemez.request('rewindConversation',{id:cidRef.current,before_message_id:branchQuestion.id});previous=rewound.messages;}
      setMessages([...previous,{id:'pending-user',role:'user',content:userContent},{id:'pending-assistant',role:'assistant',content:[],response_style:answerStyle}]);
      await window.chemez.chat({text:text.trim(),images:attached.map(({name,mime,data})=>({name,mime,data})),conversation_id:cidRef.current,response_style:answerStyle,level:level||'undergraduate',command:selected?selected.slice(1):null});
    }catch(e){setError(errorMessage(e));setBusy(false);setStatus('');submission.current=null;setInput(current=>current||text);setImages(current=>current.length?current:attached);setMessages(items=>items.filter(m=>!m.id.startsWith('pending-')));}
  }
  async function open(id:string){const requested=++activity.current;try{const data=await window.chemez.request('getConversation',id);if(requested!==activity.current)return;const draft=drafts.current.get(id);cidRef.current=id;setCid(id);setArchived(!!conversations.find(chat=>chat.id===id)?.archived);setMessages(data.messages);setInput(draft?.text||'');setImages(draft?.images||[]);setEditing(null);setError('');setChatMenu(null);setSearchOpen(false);setSearch('');follows.current=true;}catch(e){setError(errorMessage(e));}}
  async function remove(id:string){setDeleting(null);try{await window.chemez.request('deleteConversation',id);if(cid===id)newChat();await refresh();}catch(e){setError(errorMessage(e));}}
  function newChat(){activity.current++;setSearch('');setArchived(false);setSearchOpen(false);setEditing(null);setChatMenu(null);const draft=drafts.current.get('new');cidRef.current=null;setCid(null);setMessages([]);setError('');setInput(draft?.text||'');setImages(draft?.images||[]);composer.current?.focus();}
  async function pickImage(){
    if(images.length>=4){setError('You can attach up to four images.');return;}
    try{const image=await window.chemez.pickImage();if(image){setImages(items=>[...items,image]);setError('');composer.current?.focus();}}catch(e){setError(errorMessage(e));}
  }
  async function intakeFiles(files:File[]){
    if(busy)return;
    if(files.length+images.length>4){setError('You can attach up to four images.');return;}
    try{
      const attachments:ImageAttachment[]=[];
      for(const file of files){
        if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use PNG, JPEG or WebP images.');
        if(file.size>MAX_IMAGE_BYTES)throw new Error('Choose an image smaller than 15 MB.');
        const dimensions=imageDimensions(await file.arrayBuffer());
        const resize=Math.min(1,MAX_IMAGE_EDGE/Math.max(dimensions.width,dimensions.height));
        const bitmap=await createImageBitmap(file,{resizeWidth:Math.max(1,Math.round(dimensions.width*resize)),resizeHeight:Math.max(1,Math.round(dimensions.height*resize)),resizeQuality:'high'});
        const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Image processing is unavailable.');}
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        const dataUrl=canvas.toDataURL('image/png');const data=dataUrl.split(',')[1];
        if(data.length>8_000_000)throw new Error('The processed image is too large. Try a smaller image.');
        attachments.push({name:file.name||'Pasted image.png',mime:'image/png',data,dataUrl});
      }
      setImages(items=>[...items,...attachments].slice(0,4));setError('');composer.current?.focus();
    }catch(e){setError(errorMessage(e));}
  }
  async function copy(message:Message){try{await navigator.clipboard.writeText(answerText(message.content as Block[]));setCopied(message.id);setTimeout(()=>setCopied(''),1600);}catch{setError('Clipboard access failed. Select and copy the answer text.');}}
  async function updateChat(chat:Conversation,title=chat.title,pinned=!!chat.pinned,archive=!!chat.archived){try{await window.chemez.request('updateConversation',{id:chat.id,title,pinned,archived:archive});await refresh();setChatMenu(null);setRenaming(null);return true;}catch(e){setError(errorMessage(e));return false;}}
  async function archiveChat(chat:Conversation){if(!await updateChat(chat,chat.title,!!chat.pinned,!chat.archived))return;setToast({text:chat.archived?'Chat restored':'Chat archived',undo:()=>void updateChat(chat,chat.title,!!chat.pinned,!!chat.archived)});}
  function editQuestion(message:Message){reuse(message);setEditing(message);}
  function retryAnswer(index:number){const previous=messages.slice(0,index).reverse().find(message=>message.role==='user');if(previous){const content=userContent(previous);void send(content.text,content.images,previous);}}
  function reuse(message:Message){const content=typeof message.content==='string'?{text:message.content,images:[]}:message.content as UserContent;setInput(content.text);setImages(content.images||[]);composer.current?.focus();}
  async function exportChat(){try{await window.chemez.saveText(messages.map(message=>`## ${message.role==='user'?'You':'ChemEZ'}\n\n${message.role==='assistant'?answerText(message.content as Block[]):typeof message.content==='string'?message.content:(message.content as UserContent).text}`).join('\n\n---\n\n'));}catch(e){setError(errorMessage(e));}}
  const [slash,setSlash]=useState('');
  const [caret,setCaret]=useState(0),[menuDismissed,setMenuDismissed]=useState(false);
  const query=!menuDismissed?commandQuery(input,caret):undefined;
  // Switching mode or command asks the model for a fitting next question about this chat;
  // the built-in template shows until it arrives.
  const [live,setLive]=useState<{key:string;question:string}|null>(null);
  const liveKey=cid&&last?.role==='assistant'?`${cid}|${last.id}|${answerStyle}|${slash}`:'';
  useEffect(()=>{
    if(!followupHints||busy||!liveKey||!cid||live?.key===liveKey)return;
    let current=true;
    window.chemez.request('suggestQuestion',{id:cid,mode:answerStyle,command:slash.replace('/','')}).then(result=>{const question=cleanSuggestion(result.question);if(current&&question)setLive({key:liveKey,question});}).catch(()=>undefined);
    return()=>{current=false;};
  },[liveKey,busy,followupHints]);
  // True when the answer being generated belongs to the chat on screen.
  const here=busy&&runCid===cid;
  const suggestion=followupHints&&!busy&&last?.role==='assistant'?(live?.key===liveKey?live.question:composerSuggestion(messages,answerStyle,slash)):undefined;
  const chooseSlash=(name:string)=>{if(!query)return;setSlash(name);setInput(removeCommandQuery(input,query));setMenuDismissed(true);requestAnimationFrame(()=>{composer.current?.focus();composer.current?.setSelectionRange(query.start,query.start);});};
  const slashMatches=query?SLASH_COMMANDS.filter(([name])=>name.slice(1).startsWith(query.query)):[];
  const choose=(text:string)=>{setInput(text);composer.current?.focus();};
  return <>
    <div className="ambient" aria-hidden="true"/>
    <GlassEdges mode={glassMode}/>
    <div className={'app-shell'+(collapsed?' sidebar-collapsed':'')}>
      <aside className="sidebar" ref={menuRef}>
        <a className="brand" href="#" aria-label="ChemEZ home" onClick={event=>{event.preventDefault();newChat();}}>
          <Logo mini/><Wordmark/>
        </a>
        <button className="new-chat" aria-label="New conversation" title="New conversation" onClick={newChat}><i className="fas fa-plus" aria-hidden="true"/><span className="new-chat-label">New conversation</span></button>
        <button className="navigation-action" aria-label="Search all chats" title="Search messages and structures · ⌘/Ctrl K" onClick={()=>setSearchOpen(true)}><i className="fas fa-search" aria-hidden="true"/><span>Search chats</span><kbd>⌘ K</kbd></button>
        <button className="navigation-action" aria-pressed={library} onClick={()=>setLibrary(!library)} title="Browse saved chemistry diagrams"><i className="fas fa-atom" aria-hidden="true"/><span>Structure library</span></button>
        <nav aria-label="Conversation history" className="history">
          {visibleChats.map((conversation,index)=><Fragment key={conversation.id}>{(index===0||historyGroup(visibleChats[index-1])!==historyGroup(conversation))&&<h2>{historyGroup(conversation)}</h2>}<div className={'history-item '+(cid===conversation.id?'selected':'')}>
            <button onClick={()=>void open(conversation.id)} title={conversation.title}><span>{conversation.pinned&&<i className="fas fa-thumbtack" aria-label="Pinned"/>}{busy&&conversation.id===runCid&&<span className="running-dot" role="status" aria-label="Answer in progress"/>}{conversation.title}</span></button>
            <button className="chat-menu-trigger" aria-label={`Actions for ${conversation.title}`} aria-expanded={chatMenu===conversation.id} onClick={event=>openChatMenu(conversation.id,event.currentTarget)}><i className="fas fa-ellipsis-h" aria-hidden="true"/></button>
            {chatMenu===conversation.id&&createPortal(<div ref={chatMenuRef} className="chat-menu floating" style={chatMenuPlace} role="menu" aria-label="Chat actions"><button role="menuitem" onClick={()=>{setRenaming(conversation);setRenameTitle(conversation.title);setChatMenu(null);}}><i className="fas fa-pen" aria-hidden="true"/>Rename</button><button role="menuitem" onClick={()=>void updateChat(conversation,conversation.title,!conversation.pinned)}><i className="fas fa-thumbtack" aria-hidden="true"/>{conversation.pinned?'Unpin':'Pin'}</button><button role="menuitem" disabled={busy} onClick={()=>void archiveChat(conversation)}><i className={'fas '+(conversation.archived?'fa-undo':'fa-archive')} aria-hidden="true"/>{conversation.archived?'Restore':'Archive'}</button><button role="menuitem" className="danger-action" aria-label={`Delete ${conversation.title}`} disabled={busy} onClick={()=>setDeleting(conversation)}><i className="fas fa-trash-alt" aria-hidden="true"/>Delete</button></div>,document.querySelector('.app-shell')||document.body)}
          </div></Fragment>)}
          {conversations.length===0&&<p className="history-empty">Your conversations will appear here.</p>}
          {conversations.length>0&&visibleChats.length===0&&<p className="history-empty">{search?'No matching chats.':archived?'No archived chats.':'No recent chats. Check Archived chats below.'}</p>}
        </nav>
        <button className="navigation-action" aria-pressed={archived} onClick={()=>{setArchived(!archived);setSearch('');setChatMenu(null);}}><i className="fas fa-archive" aria-hidden="true"/><span>{archived?'Back to chats':'Archived chats'}</span></button>
        <button className="navigation-action" onClick={()=>setHelp(true)} title="Keyboard shortcuts"><i className="far fa-keyboard" aria-hidden="true"/><span>Keyboard shortcuts</span></button>
        <button className="appearance-trigger" onClick={()=>setAppearance(true)}><i className="fas fa-cog" aria-hidden="true"/>Settings</button>

      </aside>
      <main>
        <header className="topbar">
          <button className="sidebar-toggle" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>setCollapsed(!collapsed)}><i className="fas fa-columns" aria-hidden="true"/></button>
          <span className="conversation-title">{conversations.find(conversation=>conversation.id===cid)?.title||'New conversation'}</span>
          <button className="mobile-search icon-action" aria-label="Find a chat" onClick={()=>setSearchOpen(true)}><i className="fas fa-search" aria-hidden="true"/></button>
          {messages.length>0&&<button className="export-chat" aria-label="Export conversation" title="Export conversation as Markdown" disabled={busy} onClick={()=>void exportChat()}><i className="fas fa-file-export" aria-hidden="true"/></button>}
          <button className="settings-trigger" aria-label="Model settings" title={config.config?`${config.config.model} · Manage model and API`:'Connect your API'} disabled={busy} onClick={()=>setSettings(true)}>
            <span>{config.config?.model.split('/').pop()||'Choose a model'}</span>
            <i className="fas fa-chevron-down" aria-hidden="true"/>
          </button>
          <div className="window-controls" aria-label="Window controls">
            <button aria-label="Minimize window" title="Minimize" onClick={()=>void window.chemez.windowAction('minimize')}><i className="fas fa-minus" aria-hidden="true"/></button>
            <button aria-label="Maximize or restore window" title="Maximize or restore" onClick={()=>void window.chemez.windowAction('toggle-maximize')}><i className="far fa-square" aria-hidden="true"/></button>
            <button className="window-close" aria-label="Close window" title="Close" onClick={()=>void window.chemez.windowAction('close')}><i className="fas fa-times" aria-hidden="true"/></button>
          </div>
        </header>
        <div ref={scroll} className="conversation-scroll" onLoadCapture={()=>{if(follows.current)end.current?.scrollIntoView({behavior:'auto'});}} onScroll={()=>{const element=scroll.current!;follows.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;setShowJump(!follows.current);}}>
          {messages.length===0?<section className="welcome">
            <div className="hero-mark"><Logo/></div>
            <h1 aria-label="Chemistry, clearer.">Chemistry, <HeroWord/></h1>
            <p>Structures, reactions, and step-by-step explanations.</p>
          </section>:<div className="messages">
            {messages.map((message,messageIndex)=><article key={message.id} className={'message '+message.role}>
              <div className="message-body">
                {message.role==='user'?<UserMessage message={message} busy={busy} onEdit={()=>editQuestion(message)} onPreview={image=>{setPreview(image);setZoom(100);}}/>:<>
                  <RenderBoundary key={message.id}><Suspense fallback={<div className="generating" role="status">Preparing answer…</div>}><div className="answer-flow">
                    {message.draft&&!(message.content as Block[]).length&&<TypedText text={message.draft}/>}
                    <AnswerBlocks blocks={(message.content as Block[]).map(block=>block.type==='error'?{...block,text:errorMessage(block.text)}:block)} onChoice={choose}/>
                  </div></Suspense></RenderBoundary>
                  {!busy&&(message.content as Block[]).length>0&&(message.content as Block[]).every(block=>block.type==='error')&&<div className="error-actions"><button onClick={()=>setSettings(true)}>Model settings</button><button onClick={()=>{const previous=messages.slice(0,messageIndex).reverse().find(m=>m.role==='user');if(previous)editQuestion(previous);}}>Edit question</button><button onClick={()=>retryAnswer(messageIndex)}><i className="fas fa-redo" aria-hidden="true"/>Retry answer</button></div>}
                  {(message.content as Block[]).some(block=>block.type!=='error')&&<div className="answer-actions"><button className="copy-answer" aria-label="Copy answer" title={copied===message.id?'Copied':'Copy answer'} onClick={()=>void copy(message)}><i className={'far '+(copied===message.id?'fas fa-check':'fa-copy')} aria-hidden="true"/></button>{!busy&&<button aria-label="Retry answer" title="Generate another answer" onClick={()=>retryAnswer(messageIndex)}><i className="fas fa-redo" aria-hidden="true"/></button>}{message.response_style&&<span className="answer-mode" title="Answer style for this reply">{{balanced:'Explain',concise:'Quick answer',tutor:'Step-by-step',mechanism:'Mechanism'}[message.response_style]}</span>}<References blocks={message.content as Block[]}/></div>}
                </>}
                {message.id==='pending-assistant'&&busy&&<p className="answer-status" role="status">{status||'Working…'}</p>}
              </div>
            </article>)}
            <div ref={end}/>
          </div>}
        </div>
        <div className="composer-area">
          {showJump&&messages.length>0&&<button className="jump" aria-label="Scroll to latest message" title="Latest message" onClick={()=>{follows.current=true;end.current?.scrollIntoView();setShowJump(false);}}><i className="fas fa-arrow-down" aria-hidden="true"/></button>}
          {error&&<div className="notice error" role="alert">{error}</div>}
          <form className="composer" onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();void intakeFiles(Array.from(event.dataTransfer.files));}} onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();void intakeFiles(files);}}} onSubmit={event=>{event.preventDefault();void send();}}>
            <label className="sr-only" htmlFor="question">Chemistry question</label>
            {editing&&<div className="branch-banner"><i className="fas fa-pen" aria-hidden="true"/><span>Editing an earlier question. Sending replaces it and the answers after it.</span><button type="button" aria-label="Cancel editing" onClick={()=>{setEditing(null);setInput('');setImages([]);}}><i className="fas fa-times" aria-hidden="true"/></button></div>}
            {images.length>0&&<div className="attachment-strip" aria-label="Attached images">{images.map((image,index)=><div className="attachment" key={`${image.name}-${index}`}><img src={image.dataUrl||`data:${image.mime};base64,${image.data}`} alt=""/><span>{image.name}</span><button type="button" aria-label={`Remove ${image.name}`} onClick={()=>setImages(items=>items.filter((_,itemIndex)=>itemIndex!==index))}><i className="fas fa-times" aria-hidden="true"/></button></div>)}</div>}
            {images.length>0&&config.image_support==='unsupported'&&<p className="image-capability-note">This model is text-only. <button type="button" onClick={()=>setSettings(true)}>Set up image reading</button> to use these images.</p>}
            {slashMatches.length>0&&<div className="slash-menu" role="listbox" aria-label="Commands">{slashMatches.map(([name,about])=><button type="button" key={name} className="slash-command" onMouseDown={event=>event.preventDefault()} onClick={()=>chooseSlash(name)}><b>{name}</b><span>{about}</span></button>)}</div>}
            {slash&&<span className="slash-chip">{COMMAND_NAMES[slash]}<button type="button" aria-label={`Remove ${COMMAND_NAMES[slash]}`} onClick={()=>{setSlash('');composer.current?.focus();}}><i className="fas fa-times" aria-hidden="true"/></button></span>}
            <textarea ref={composer} id="question" value={input} maxLength={12000} onChange={event=>{setInput(event.target.value);setCaret(event.target.selectionStart);setMenuDismissed(false);}} onSelect={event=>{const next=event.currentTarget.selectionStart;if(next!==caret){setCaret(next);setMenuDismissed(false);}}} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&(event.metaKey||event.ctrlKey||!event.shiftKey)){event.preventDefault();void send();}if(event.key==='ArrowUp'&&!input&&!busy){const previous=messages.slice().reverse().find(message=>message.role==='user');if(previous){event.preventDefault();editQuestion(previous);}}if(event.key==='Escape'&&slashMatches.length){event.preventDefault();setMenuDismissed(true);}if(event.key==='Backspace'&&!input&&slash){event.preventDefault();setSlash('');}if((event.key==='Tab'||event.key==='ArrowRight')&&!input&&suggestion){event.preventDefault();setInput(suggestion);}}} placeholder={busy?'Draft your next question while the answer finishes…':suggestion?suggestion+'   ⇥ Tab':slash?(COMMAND_PLACEHOLDERS[slash]||'Enter your chemistry question…'):'Ask anything chemistry…'} aria-description={suggestion?'Suggested next question: '+suggestion+'. Press Tab to use it.':undefined} rows={2}/>
            <div className="composer-footer">
              <div className="composer-tools"><button className="attach-button" type="button" disabled={busy||images.length>=4} onClick={()=>void pickImage()} aria-label="Attach chemistry image" title="Attach image · PNG, JPEG or WebP, up to 4"><i className="fas fa-plus" aria-hidden="true"/></button><select className="answer-style" aria-label="Answer style" title="Choose how the next answer is explained" disabled={busy} value={answerStyle} onChange={event=>setAnswerStyle(event.target.value as typeof answerStyle)}><option value="concise">Quick answer</option><option value="balanced">Explain</option><option value="mechanism">Mechanism</option></select></div>
              {busy&&!here?<button className="send-button" type="button" disabled title="Another chat is still answering. You can send when it finishes." aria-label="Send question (waiting for the other chat)"><i className="fas fa-arrow-up" aria-hidden="true"/></button>:busy?<button className="send-button stop" type="button" onClick={()=>void window.chemez.cancel()} aria-label="Stop generation"><i className="fas fa-stop" aria-hidden="true"/></button>:<button className="send-button" type="submit" disabled={!input.trim()&&!images.length} aria-label="Send question"><i className="fas fa-arrow-up" aria-hidden="true"/></button>}
            </div>
          </form>
          <div className="composer-caption"><span title={config.config?.model}>{config.config?.model||'Choose a model to begin'}</span><span>AI chemistry can be wrong. Check important details.</span></div>
          {messages.length===0&&<div className="suggestions">{prompts.map((prompt,index)=><button key={prompt.title} onClick={()=>choose(prompt.text)}><i className={'fas '+['fa-atom','fa-exchange-alt','fa-project-diagram'][index]} aria-hidden="true"/>{prompt.title}</button>)}</div>}
        </div>
      </main>
      {library&&<Suspense fallback={null}><StructureLibrary onClose={()=>setLibrary(false)} onOpen={id=>{void open(id);if(window.innerWidth<1200)setLibrary(false);}} onUse={text=>{choose(text);if(window.innerWidth<1200)setLibrary(false);}} busy={busy} revision={`${busy}-${messages.length}-${conversations.map(chat=>chat.id+chat.updated).join(',')}`}/></Suspense>}
      {appearance&&<Dialog title="Settings" className="settings-window" onClose={()=>setAppearance(false)}><div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">{([['general','General','fa-graduation-cap'],['appearance','Appearance','fa-adjust'],['diagrams','Diagrams','fa-project-diagram'],['model','Model & API','fa-key'],['about','About','fa-info-circle']] as const).map(([id,label,icon])=><button type="button" key={id} aria-current={settingsTab===id?'page':undefined} onClick={()=>setSettingsTab(id)}><i className={'fas '+icon} aria-hidden="true"/>{label}</button>)}</nav>
        <div className="settings-pane">
          {settingsTab==='general'&&<section aria-label="General"><div className="setting-row"><div><b>Chemistry level</b><small>Sets vocabulary and depth of every answer.</small></div><button type="button" className="setting-value" onClick={()=>setLevelOpen(true)}>{LEVELS[level||'undergraduate'].short}<i className="fas fa-chevron-right" aria-hidden="true"/></button></div><div className="setting-row"><div><b id="followup-hints-label">Follow Up</b><small>Suggest a likely next question in the message box (Tab to use it).</small></div><button type="button" role="switch" aria-checked={followupHints} aria-labelledby="followup-hints-label" className="toggle-switch" onClick={()=>{const next=!followupHints;setFollowupHints(next);localStorage.setItem('chemez-followup-hints',next?'on':'off');}}><span className="toggle-knob"/><span className="toggle-text">{followupHints?'On':'Off'}</span></button></div></section>}
          {settingsTab==='appearance'&&<section aria-label="Appearance"><div className="setting-row"><div><b id="glass-effects-label">Glass effects</b><small>Glass edges and highlights on cards and panels.</small></div><button type="button" role="switch" aria-checked={glassMode==='on'} aria-labelledby="glass-effects-label" className="toggle-switch" onClick={()=>setGlassMode(glassMode==='on'?'off':'on')}><span className="toggle-knob"/><span className="toggle-text">{glassMode==='on'?'On':'Off'}</span></button></div><div className="setting-row stacked"><label htmlFor="glass"><b>Background opacity</b><span>{glass}%</span></label><input id="glass" type="range" min="50" max="100" value={glass} onChange={event=>setGlass(Number(event.target.value))}/><small>{reducedTransparency?'System Reduce Transparency is enabled. Translucency works; desktop blur is disabled.':'Desktop blur uses your system’s transparency settings.'}</small></div></section>}
          {settingsTab==='diagrams'&&<section aria-label="Diagrams"><DiagramPreferences inline/></section>}
          {settingsTab==='model'&&<section aria-label="Model and API"><div className="setting-row"><div><b>Model</b><small>{config.config?config.config.model:'Not connected'}</small></div><button type="button" className="setting-value" disabled={busy} onClick={()=>{setAppearance(false);setSettings(true);}}>Manage model &amp; API key<i className="fas fa-chevron-right" aria-hidden="true"/></button></div></section>}
          {settingsTab==='about'&&<Suspense fallback={<p role="status">Loading About…</p>}><About/></Suspense>}
        </div>
      </div></Dialog>}
      {settings&&<Suspense fallback={null}><Settings level={level||'undergraduate'} onLevel={chooseLevel} initial={config} onClose={()=>setSettings(false)} onSave={setConfig}/></Suspense>}
      {renaming&&<Dialog title="Rename conversation" onClose={()=>setRenaming(null)}><form className="rename-form" onSubmit={event=>{event.preventDefault();void updateChat(renaming,renameTitle.trim());}}><input autoFocus aria-label="Conversation name" maxLength={80} value={renameTitle} onChange={event=>setRenameTitle(event.target.value)}/><div><button type="button" onClick={()=>setRenaming(null)}>Cancel</button><button type="submit" disabled={!renameTitle.trim()}>Save</button></div></form></Dialog>}
      {deleting&&<Dialog title="Delete chat?" className="confirm-dialog" onClose={()=>setDeleting(null)}><p className="confirm-text">“{deleting.title}” and its saved diagrams will be removed from this Mac. This can’t be undone.</p><div className="confirm-actions"><button type="button" autoFocus onClick={()=>setDeleting(null)}>Cancel</button><button type="button" className="danger" onClick={()=>void remove(deleting.id)}>Delete</button></div></Dialog>}
      {searchOpen&&<Dialog title="Search chats" className="search-dialog" onClose={()=>{setSearchOpen(false);setSearch('');}}><label className="search-field"><i className="fas fa-search" aria-hidden="true"/><input autoFocus aria-label="Search messages and structures" maxLength={200} placeholder="Find explanations, molecules, or SMILES…" value={search} onChange={event=>setSearch(event.target.value)}/></label><p className="muted">Search includes messages, structures and archived conversations.</p><div className="search-results" aria-busy={searching}>{searchError?<p role="alert">{searchError}</p>:searching?<p role="status">Searching…</p>:search.trim()&&results.length===0?<p>No matching messages.</p>:(search.trim()?results:conversations.slice(0,12)).map(chat=><button key={chat.id} disabled={busy} onClick={()=>void open(chat.id)}><i className={'fas '+(chat.archived?'fa-archive':'fa-comment-alt')} aria-hidden="true"/><span><strong>{chat.title}</strong><small>{chat.snippet||new Date(chat.updated).toLocaleDateString()}</small></span>{chat.archived&&<em>Archived</em>}</button>)}</div></Dialog>}
      {levelOpen&&<LevelChooser current={level} onChoose={chooseLevel} onClose={()=>{if(!level)chooseLevel('undergraduate');else setLevelOpen(false);}}/>}
      {help&&<Dialog title="Keyboard shortcuts" onClose={()=>setHelp(false)}><dl className="shortcut-list">{[['Search all chats','⌘ / Ctrl + K'],['New conversation','⌘ / Ctrl + Shift + O'],['Keyboard shortcuts','⌘ / Ctrl + /'],['Send question','Enter'],['New line','Shift + Enter'],['Edit last question','↑ in an empty composer'],['Close a dialog or menu','Esc']].map(([action,key])=><div key={action}><dt>{action}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl><p className="muted">Paste or drop PNG, JPEG and WebP images into the composer.</p></Dialog>}
      {preview&&<Dialog title={preview.name} className="image-dialog" onClose={()=>setPreview(null)}><div className="image-viewer"><img style={{width:`${zoom}%`}} src={preview.dataUrl||`data:${preview.mime};base64,${preview.data}`} alt={preview.name}/></div><label className="zoom-control">Zoom <input type="range" aria-label="Image zoom" min="50" max="200" step="10" value={zoom} onChange={event=>setZoom(Number(event.target.value))}/><span>{zoom}%</span></label></Dialog>}
      {toast&&<div className="toast" role="status"><span>{toast.text}</span>{toast.undo&&<button onClick={()=>{toast.undo?.();setToast(null);}}>Undo</button>}<button aria-label="Dismiss notification" onClick={()=>setToast(null)}><i className="fas fa-times" aria-hidden="true"/></button></div>}
    </div>
  </>;
}
