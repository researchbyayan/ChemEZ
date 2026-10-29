import {useState} from 'react';
import {Dialog} from './Dialog';
import type {Block} from './types';
type Source={title:string;url?:string;provenance:string};
export function collectReferences(value:unknown):Source[]{
  const found=new Map<string,Source>();
  function visit(v:unknown){
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v)){v.forEach(visit);return;}
    const item=v as Record<string,unknown>;
    if(typeof item.title==='string'&&item.provenance==='model'&&item.url===undefined){found.set('title:'+item.title,{title:item.title,provenance:'Suggested by model, not retrieved by ChemEZ'});return;}
    if(typeof item.url==='string'&&typeof (item.title||item.label)==='string'){
      try{const u=new URL(item.url);if(u.protocol==='https:'&&!u.username&&!u.password)found.set(u.href,{title:String(item.title||item.label),url:u.href,provenance:item.provenance==='model'?'Suggested by model, not retrieved by ChemEZ':'Compound lookup source'});}catch{/* Ignore malformed saved sources. */}
    }
    Object.entries(item).filter(([k])=>!['svg','svg_changes','encoding'].includes(k)).forEach(([,v])=>visit(v));
  }
  visit(value);return [...found.values()];
}
export function References({blocks}:{blocks:Block[]}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState('');
  const sources=collectReferences(blocks);
  return <><button className="answer-references" onClick={()=>setOpen(true)} title="View answer references"><i className="icon icon-book-open" aria-hidden="true"/> References{sources.length?` (${sources.length})`:''}</button>{open&&<Dialog title="References" onClose={()=>setOpen(false)} className="references-dialog"><p className="references-note">Sources attached to this answer. Model suggestions are not independently verified. Structure validation uses local chemistry calculations.</p>{sources.length?<><ol>{sources.map(s=><li key={s.url||s.title}>{s.url?<button className="reference-link" onClick={()=>void window.chemez.openReference?.(s.url!).catch(()=>setStatus('Could not open this source.'))}>{s.title}<i className="icon icon-external-link-alt" aria-hidden="true"/></button>:<span className="reference-title">{s.title}</span>}<small>{s.provenance}</small>{s.url&&<span>{s.url}</span>}</li>)}</ol><button onClick={()=>void navigator.clipboard.writeText(sources.map(s=>[s.title,s.url,s.provenance].filter(Boolean).join('\n')).join('\n\n')).then(()=>setStatus('Copied references.'),()=>setStatus('Could not copy. Try again.'))}><i className="icon icon-copy" aria-hidden="true"/> Copy references</button></>:<p>No external references were attached to this answer. ChemEZ cannot list the model’s training sources.</p>}{status&&<p role="status">{status}</p>}</Dialog>}</>;
}
