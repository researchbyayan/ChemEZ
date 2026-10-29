import {useState,useRef,useEffect,lazy,Suspense,type ReactNode,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import type {Block,Molecule} from './types';
import {displayName,plainChem,chemArrows} from './chemText';
import {RenderBoundary} from './RenderBoundary';
const SmilesExplorer=lazy(()=>import('./SmilesExplorer').then(module=>({default:module.SmilesExplorer})));

export function Markdown({text}:{text:string}) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,strict:'ignore',throwOnError:false,maxExpand:1000,maxSize:20}],rehypeHighlight]} skipHtml components={{a:({children})=><span className="reference-link">{children}</span>}}>{text}</ReactMarkdown></div>;
}
const svgURL=(svg:string)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
// New drawings share one bond length, so their intrinsic size is their true relative scale.
// Answers saved before that change used a fixed 600x340 canvas and keep the old fitted width.
function structureStyle(svg:string):CSSProperties|undefined{
  const match=svg.match(/<svg[^>]*?\swidth=['"]([\d.]+)(?:px)?['"][^>]*?\sheight=['"]([\d.]+)(?:px)?['"]/);
  const width=match?Number(match[1]):0;
  if(!width||(width===600&&Number(match![2])===340))return undefined;
  return {width:`calc(${width}px * var(--structure-scale, 1) * var(--structure-context, 1))`};
}
export function Formula({value}:{value:string}){
  const match=value.match(/^(.*?)([+-]\d*)$/);
  const body=match?match[1]:value;
  return <>{body.split(/(\d+)/).map((part,index)=>/^\d+$/.test(part)?<sub key={index}>{part}</sub>:part)}{match&&<sup>{match[2]}</sup>}</>;
}
export {displayName};
// Reagent text: inline math when the model used it, otherwise subscript formula counts (AlCl3 -> AlCl₃).
function ChemText({text}:{text:string}){
  if(/[$\\]/.test(text))return <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,strict:'ignore',throwOnError:false,maxExpand:1000,maxSize:20}]]} skipHtml components={{p:({children})=><>{children}</>}}>{text}</ReactMarkdown>;
  text=chemArrows(text);
  return <>{text.split(/((?:[A-Z][a-z]?|\))\d+)/).map((part,index)=>{const match=part.match(/^((?:[A-Z][a-z]?|\)))(\d+)$/);return match?<span key={index}>{match[1]}<sub>{match[2]}</sub></span>:part;})}</>;
}
function CopyValue({label,value,children,onError}:{label:string;value:string;children:ReactNode;onError:(text:string)=>void}){
  const [copied,setCopied]=useState(false);
  return <button className="formula copy-value" aria-label={`Copy ${label}`} onClick={()=>void navigator.clipboard.writeText(value).then(()=>setCopied(true)).catch(()=>onError(`Could not copy ${label}.`))}><span>{children}</span><i className={copied?'fas fa-check':'far fa-copy'} aria-hidden="true"/></button>;
}
export async function savePNG(svg:string){
  const image=new Image();image.src=svgURL(svg);await image.decode();
  const canvas=document.createElement('canvas');
  const scale=Math.min(3,4096/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.ceil(image.naturalWidth*scale);canvas.height=Math.ceil(image.naturalHeight*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  await window.chemez.saveImage({format:'png',data:canvas.toDataURL('image/png').split(',')[1]});
}
function StructureMenu({svg,label,name,formula,onExplore,imageStyle,children}:{svg:string;label:string;name?:string;formula?:string;onExplore?:()=>void;imageStyle?:CSSProperties;children?:ReactNode}){
  const [open,setOpen]=useState(false),[error,setError]=useState('');
  const [position,setPosition]=useState({left:0,top:0});
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const cancel=()=>{if(timer.current)clearTimeout(timer.current);};
  const show=()=>{cancel();setOpen(true);};
  const hide=()=>{cancel();timer.current=setTimeout(()=>{if(!trigger.current?.contains(document.activeElement)&&!panel.current?.contains(document.activeElement))setOpen(false);},160);};
  useEffect(()=>()=>cancel(),[]);
  useEffect(()=>{
    if(!open)return;
    const place=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;const height=panel.current?.offsetHeight||150;setPosition({left:Math.max(10,Math.min(r.left,window.innerWidth-230)),top:r.bottom+height+10<window.innerHeight?r.bottom+5:Math.max(10,r.top-height-5)});};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.blur();}};
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);};
  },[open]);
  return <><button ref={trigger} className={children?'scheme-menu-trigger':'structure-trigger'} aria-label={`Details for ${label}`} aria-haspopup="dialog" aria-expanded={open} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}>{children||<img src={svgURL(svg)} alt={label} style={imageStyle} className={imageStyle?undefined:'legacy-structure'}/>}</button>{open&&createPortal(<div ref={panel} className="structure-popover" role="dialog" aria-label={`${label} details`} style={position} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
    {!children&&<><span className="structure-detail-label">IUPAC name</span>{name?<CopyValue label="IUPAC name" value={displayName(name)} onError={setError}><strong>{displayName(name)}</strong></CopyValue>:<span>Unavailable for this structure</span>}<span className="structure-detail-label">Molecular formula</span>{formula?<CopyValue label="molecular formula" value={formula} onError={setError}><Formula value={formula}/></CopyValue>:<span>Unavailable</span>}</>}
    {onExplore&&<button className="structure-save" onClick={()=>{setOpen(false);onExplore();}}><i className="fas fa-project-diagram" aria-hidden="true"/>Explore structure</button>}
    <button className={onExplore?'structure-action':'structure-save'} aria-label="Save PNG" onClick={()=>void savePNG(svg).catch(e=>setError(String(e)))}><i className="fas fa-download" aria-hidden="true"/>Save PNG</button>{error&&<p role="alert">{error}</p>}
  </div>,document.body)}</>;
}
export function Diagram({svg,label,children,menu=true}:{svg:string;label:string;children?:ReactNode;menu?:boolean}){
  return <div className="diagram">{children||<StructureMenu svg={svg} label={label}/ >}{children&&menu&&<StructureMenu svg={svg} label={label}><i className="fas fa-ellipsis-h" aria-hidden="true"/></StructureMenu>}</div>;
}
function StructureFigure({molecule:m,className,changes=false}:{molecule:Molecule;className:string;changes?:boolean}){
  const [exploring,setExploring]=useState(false);
  const name=m.label||m.iupac_name;
  return <div className={'structure '+className}>
    <StructureMenu svg={changes&&m.svg_changes?m.svg_changes:m.svg} label={`${name||m.formula||'Molecule'} molecular structure`} name={m.iupac_name} formula={m.formula} onExplore={()=>setExploring(true)} imageStyle={structureStyle(m.svg)}/>
    <div className="structure-caption">{name&&<span className="structure-name">{displayName(name)}</span>}{m.formula&&<span className="structure-formula"><Formula value={m.formula}/></span>}</div>
    {exploring&&<Suspense fallback={null}><SmilesExplorer molecule={m} onClose={()=>setExploring(false)}/></Suspense>}
  </div>;
}
function MoleculeView({molecule:m}:{molecule:Molecule}){
  // Named-compound cards (looked up locally or on PubChem) add a properties table.
  if(!m.properties)return <figure className="chem-card molecule-card">{m.interpreted&&<p className="compound-interpreted">{m.interpreted}</p>}<StructureFigure molecule={m} className="molecule-structure"/></figure>;
  return <figure className="chem-card molecule-card compound-card">{m.interpreted&&<p className="compound-interpreted">{m.interpreted}</p>}<div className="compound-layout"><StructureFigure molecule={m} className="molecule-structure"/><table className="compound-properties"><tbody>{m.properties.map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{label==='SMILES'?<code>{value}</code>:label==='Formula'?<ChemText text={value}/>:value}</td></tr>)}</tbody></table></div>{m.source&&<p className="compound-source" title={m.source.url}>Data: {m.source.label}</p>}</figure>;
}
function ReactionParticipant({molecule:m,changes}:{molecule:Molecule;changes:boolean}){
  return <StructureFigure molecule={m} className="reaction-participant" changes={changes}/>;
}
function ReactionView({block:b}:{block:Extract<Block,{type:'reaction'}>}){
  const [changes,setChanges]=useState(false);
  const comparable=[...b.reactants,...b.products].some(m=>m.svg_changes);
  return <figure className="chem-card reaction-card"><figcaption><span className="eyebrow">Reaction scheme</span><strong>{b.caption||'Reaction'}</strong><span className="card-tools">{comparable&&<button className="changes-toggle" aria-pressed={changes} aria-label={changes?'Hide changes':'Highlight changes'} title={changes?'Hide changes':'Highlight changes'} onClick={()=>setChanges(!changes)}><i className="fas fa-highlighter" aria-hidden="true"/></button>}<button className="changes-toggle" aria-label="Save PNG" title="Save PNG" onClick={()=>void savePNG(b.svg).catch(()=>undefined)}><i className="fas fa-download" aria-hidden="true"/></button></span></figcaption><Diagram svg={b.svg} label={b.caption||'Reaction scheme'} menu={false}><div className="reaction-layout" role="group" aria-label={b.caption||'Reaction scheme'}><div className="reaction-side">{b.reactants.map((m,index)=><div className="reaction-term" key={'r'+index}>{index>0&&<span className="reaction-plus" aria-hidden="true">+</span>}<ReactionParticipant molecule={m} changes={changes}/></div>)}</div><div className="reaction-side"><div className="reaction-arrow"><span className="reaction-reagents"><ChemText text={b.reagents}/></span><ReactionArrow kind={b.arrow||'forward'}/><span className="reaction-conditions"><ChemText text={b.conditions}/></span></div>{b.products.map((m,index)=><div className="reaction-term" key={'p'+index}>{index>0&&<span className="reaction-plus" aria-hidden="true">+</span>}<ReactionParticipant molecule={m} changes={changes}/></div>)}</div></div></Diagram></figure>;
}
// Reaction arrows (ACS style). Equilibrium: two shafts with half heads on opposite outer
// sides; retrosynthesis: open double-shafted arrow; no reaction: a crossed arrow.
function ReactionArrow({kind}:{kind:'forward'|'equilibrium'|'retrosynthesis'|'no_reaction'}){
  const label={forward:'reacts to form',equilibrium:'is in equilibrium with',retrosynthesis:'can be made from',no_reaction:'does not react to form'}[kind];
  return <svg viewBox="0 0 120 16" aria-label={label} role="img">{
    kind==='equilibrium'?<g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5.5 H116 L107 1"/><path d="M117 10.5 H4 L13 15"/></g>
    :kind==='retrosynthesis'?<g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5 H112 M3 11 H112"/><path d="M106 1 L117 8 L106 15"/></g>
    :<g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 8 H116 M108 3 L117 8 L108 13"/>{kind==='no_reaction'&&<path d="M54 2 L66 14 M66 2 L54 14"/>}</g>
  }</svg>;
}
// Resonance contributors share one layout; the delocalized hybrid stays separate.
// Textbook resonance arrow: a long shaft with a filled head at each end.
function ResonanceArrow(){
  return <svg className="resonance-arrow" viewBox="0 0 64 16" role="img" aria-label="resonance with"><path d="M10 8H54" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M2 8L12 3.2V12.8Z M62 8L52 3.2V12.8Z" fill="currentColor"/></svg>;
}
function ResonanceView({block:b}:{block:Extract<Block,{type:'resonance'}>}){
  const title=b.caption||'Resonance structures';
  return <figure className="chem-card reaction-card resonance-card"><figcaption><span className="eyebrow">Resonance</span><strong>{title}</strong></figcaption>
    <div className="resonance-layout" role="group" aria-label={title}>
      {b.contributors.map((c,index)=><div className="resonance-term" key={index}>{index>0&&<ResonanceArrow/>}<div className="structure reaction-participant"><StructureMenu svg={c.svg} label={c.label||`Contributor ${index+1}`} formula={c.formula} imageStyle={structureStyle(c.svg)}/><div className="structure-caption"><span className="structure-name">{c.label||`Contributor ${index+1}`}</span>{!b.flow_summary&&!!c.bond_changes?.length&&<span className="resonance-bond-changes">{c.bond_changes.map((change,index)=><span key={index}>{change.label}: {change.before} → {change.after}</span>)}</span>}{c.arrows_derived&&<span className="derived-note" title="The model's arrows were missing or did not produce the next structure, so ChemEZ derived and verified them.">Arrows derived by ChemEZ</span>}{c.limitation&&<span className="mechanism-note">{c.limitation}</span>}</div></div></div>)}
    </div>
      {b.flow_summary&&<p className="resonance-flow-summary">{b.flow_summary}</p>}
      {b.hybrid&&<div className="resonance-hybrid"><span className="hybrid-label">Delocalized representation</span><div className="structure reaction-participant"><StructureMenu svg={b.hybrid.svg} label={b.hybrid.label} imageStyle={structureStyle(b.hybrid.svg)}/><div className="structure-caption"><span className="structure-name">{b.hybrid.label}</span></div></div></div>}
  </figure>;
}
export function AnswerBlocks({blocks,onChoice}:{blocks:Block[];onChoice:(text:string)=>void}){
  const result:ReactNode[]=[];
  for(let index=0;index<blocks.length;index++){
    const block=blocks[index];
    if(block.type==='molecule'){
      const molecules=[block];
      while(blocks[index+1]?.type==='molecule')molecules.push(blocks[++index] as typeof block);
      result.push(<div className="molecule-row" key={block.id}>{molecules.map(m=><RenderBoundary key={m.id}><MoleculeView molecule={m}/></RenderBoundary>)}</div>);
    }else result.push(<RenderBoundary key={block.id}><AnswerBlock block={block} onChoice={onChoice}/></RenderBoundary>);
  }
  return <>{result}</>;
}
export function AnswerBlock({block:b,onChoice}:{block:Block;onChoice:(text:string)=>void}){
  if(b.type==='markdown')return <Markdown text={b.text}/>;
  if(b.type==='error')return <div className="notice error" role="alert">{b.text}</div>;
  if(b.type==='molecule')return <MoleculeView molecule={b}/>;
  if(b.type==='clarification')return <div className="clarification"><span className="eyebrow">A little more context</span><p><ChemText text={b.question}/></p><div className="choices">{b.options.map(option=><button key={option} onClick={()=>onChoice(plainChem(option))}><ChemText text={option}/> ↗</button>)}</div></div>;
  if(b.type==='reaction')return <ReactionView block={b}/>;
  if(b.type==='resonance')return <ResonanceView block={b}/>;
  return <section className="mechanism"><h3><span className="eyebrow">Mechanism</span>Step by step</h3><ol className="mechanism-steps">{b.steps.map((s,i)=><li key={i} className="chem-card mechanism-step"><div className="mechanism-step-header"><span className="step-number" aria-hidden="true">{i+1}</span><strong>{s.label}</strong></div>{s.svg&&<StructureMenu svg={s.svg} label={s.label} name={s.iupac_name} formula={s.formula} imageStyle={structureStyle(s.svg)}/>}{!!s.bond_changes?.length&&<div className="bond-change-list" aria-label="Bond changes">{s.bond_changes.map((change,index)=><span key={index} className={'bond-change '+change.action.toLowerCase()}>{change.action==='FORM_BOND'?'Forms':change.action==='BREAK_BOND'?'Breaks':'Changes'} {change.label}{change.action==='CHANGE_BOND'?` (${change.before} → ${change.after})`:''}</span>)}</div>}{s.arrows_derived&&<span className="derived-note" title="The model's arrows were missing or incomplete, so ChemEZ completed and verified them.">Arrows completed by ChemEZ</span>}{s.completed&&<span className="derived-note">{s.completed}</span>}{s.limitation&&<p className="notice mechanism-note">{s.limitation}</p>}</li>)}</ol></section>;
}
