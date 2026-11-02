import {useState,useEffect,useMemo,useRef} from 'react';
import {Dialog} from './Dialog';
import {sharedRead} from './sharedRead';
import {proseLinks} from './sourceLinks';
import type {Block} from './types';

// Recover explicit bibliographic citations in saved prose without inventing a URL.
export function inlineCitations(text:string){
  const prose=text.slice(0,60000).replace(/```[\s\S]*?```|`[^`\n]*`/g,'');
  return [...prose.matchAll(/\(([^()\n]{0,180}[“"][^”"\n]{12,220}[”"][^()\n]{0,180})\)/g)]
    .map(match=>match[1].replace(/[*_]/g,'').trim())
    .filter(citation=>/et al\.|\b[A-Z][a-z]+\s+[A-Z]\./.test(citation)&&/(?:\b(?:18|19|20)\d{2}\b|\b\d+\s*:\s*\d+)/.test(citation)).slice(0,12);
}
type Source={title:string;url?:string;provenance:string};
export function collectReferences(value:unknown):Source[]{
  const found=new Map<string,Source>();
  function visit(v:unknown){
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v)){v.forEach(visit);return;}
    const item=v as Record<string,unknown>;
    if(item.type==='markdown'&&typeof item.text==='string'){
      for(const link of proseLinks(item.text)){
        if(!found.has(link.url))found.set(link.url,{...link,provenance:'Link in the answer, not retrieved or verified by ChemEZ'});
      }
      const bibliographic=item.text.split(/\n\s*\n/).map(part=>part.replace(/[*_]/g,'').trim()).filter(part=>/^[A-Z][a-z]+,?\s+(?:[A-Z]\.\s*){1,3}\(?\d{4}\)?/.test(part));
      for(const citation of [...inlineCitations(item.text),...bibliographic]){
        const doi=[...found.values()].find(source=>source.url?.startsWith('https://doi.org/'));
        if(doi&&bibliographic.includes(citation)){doi.title=citation;continue;}
        if(![...found.values()].some(source=>source.title===citation))found.set('title:'+citation,{title:citation,provenance:'Citation in the answer, not retrieved or verified by ChemEZ'});
      }
    }
    if(typeof item.title==='string'&&item.provenance==='model'&&item.url==null){found.set('title:'+item.title,{title:item.title,provenance:'Suggested by model, not retrieved by ChemEZ'});return;}
    if(typeof item.url==='string'&&typeof (item.title||item.label)==='string'){
      try{const u=new URL(item.url);if(u.protocol==='https:'&&!u.username&&!u.password)found.set(u.href,{title:String(item.title||item.label),url:u.href,provenance:item.provenance==='model'?'Suggested by model, not retrieved by ChemEZ':'Compound lookup source'});}catch{/* Ignore malformed saved sources. */}
    }
    Object.entries(item).filter(([k])=>!['svg','svg_changes','encoding'].includes(k)).forEach(([,v])=>visit(v));
  }
  visit(value);return [...found.values()];
}
type Match={status:'matched'|'unmatched'|'unavailable'|'loading';title?:string;url?:string;citation?:string;provenance?:string};
const resolvedCache=new Map<string,Match>();
export function References({blocks}:{blocks:Block[]}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState(''),[copied,setCopied]=useState('');
  const [matches,setMatches]=useState<Record<string,Match>>({});const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const sources=useMemo(()=>collectReferences(blocks),[blocks]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    if(!open)return;let active=true;
    for(const source of sources.filter(source=>!source.url).slice(0,12)){
      const cached=resolvedCache.get(source.title);
      if(cached){setMatches(previous=>({...previous,[source.title]:cached}));continue;}
      setMatches(previous=>({...previous,[source.title]:{status:'loading'}}));
      void sharedRead('citation:'+source.title,()=>window.chemez.request('resolveCitation',{citation:source.title.slice(0,600)})).then(match=>{
        if(match.status==='matched'){resolvedCache.set(source.title,match);while(resolvedCache.size>128)resolvedCache.delete(resolvedCache.keys().next().value!);}
        if(active)setMatches(previous=>({...previous,[source.title]:match}));
      }).catch(()=>{if(active)setMatches(previous=>({...previous,[source.title]:{status:'unavailable'}}));});
    }
    return()=>{active=false;};
  },[open,sources]);
  const details=(source:Source)=>{const match=matches[source.title];return match?.status==='matched'&&match.url?{title:match.title||source.title,url:match.url,citation:match.citation||source.title,provenance:match.provenance||'Publication metadata matched via Crossref.'}:{...source,citation:source.title};};
  const copy=async(id:string,text:string)=>{try{await navigator.clipboard.writeText(text);setCopied(id);setStatus('');clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(''),2000);}catch{setStatus('Could not copy. Please try again.');}};
  const visit=async(url:string)=>{try{if(!window.chemez.openReference)throw new Error();await window.chemez.openReference(url);}catch{setStatus('Could not open this link. You can copy the reference instead.');}};
  return <><button className="answer-references" onClick={()=>{setOpen(true);setStatus('');}} title="View answer references"><i className="icon icon-book-open" aria-hidden="true"/> References{sources.length?` (${sources.length})`:''}</button>{open&&<Dialog title="References" onClose={()=>setOpen(false)} className="references-dialog"><p className="references-note">Missing publication links are looked up when this panel opens. A matched source does not verify the answer’s claims.</p>{sources.length?<><ol className="reference-list">{sources.map((source,index)=>{const item=details(source),match=matches[source.title];return <li key={source.url||source.title}><div className="reference-heading"><span className="reference-number">{index+1}</span>{item.url?<button className="reference-link" onClick={()=>void visit(item.url!)}>{item.title}<i className="fas fa-external-link-alt" aria-hidden="true"/></button>:<strong className="reference-title">{item.title}</strong>}</div><p className="reference-citation">{item.citation}</p><p className="reference-provenance">{!source.url&&match?.status==='loading'?'Finding publication link…':!item.url?'No confident publication match. Search the title below.':item.provenance}</p><div className="reference-actions">{item.url?<button className="compact-action" onClick={()=>void visit(item.url!)}><i className="fas fa-external-link-alt" aria-hidden="true"/>Open source</button>:<button className="compact-action" onClick={()=>void visit('https://search.crossref.org/?q='+encodeURIComponent(querySourceTitle(source.title)))}><i className="fas fa-search" aria-hidden="true"/>Search publication</button>}<button className="compact-action" onClick={()=>void copy(String(index),[item.citation,item.url].filter(Boolean).join('\n'))}><i className={copied===String(index)?'fas fa-check':'far fa-copy'} aria-hidden="true"/>{copied===String(index)?'Copied':'Copy citation'}</button></div></li>;})}</ol><div className="references-footer"><button className="compact-action" onClick={()=>void copy('all',sources.map(source=>{const item=details(source);return [item.citation,item.url,item.provenance].filter(Boolean).join('\n');}).join('\n\n'))}><i className={copied==='all'?'fas fa-check':'far fa-copy'} aria-hidden="true"/>{copied==='all'?'Copied':'Copy all references'}</button><small>Only citation text is sent to Crossref, not your chat or API key.</small></div></>:<p>No external references were attached to this answer. ChemEZ cannot list the model’s training sources.</p>}{status&&<p role="status">{status}</p>}</Dialog>}</>;
}
function querySourceTitle(citation:string){return citation.match(/[“"]([^”"]+)[”"]/)?.[1]||citation;}
