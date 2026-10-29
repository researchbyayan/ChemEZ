import {lazy,Suspense,useEffect,useState} from 'react';
import type {SavedDiagram} from './types';
import {errorMessage} from './errors';
const AnswerBlock=lazy(()=>import('./Blocks').then(module=>({default:module.AnswerBlock})));

export default function StructureLibrary({onClose,onOpen,onUse,busy,revision}:{onClose:()=>void;onOpen:(id:string)=>void;onUse:(text:string)=>void;busy:boolean;revision:string}){
  const [items,setItems]=useState<SavedDiagram[]>([]);
  const [selected,setSelected]=useState<SavedDiagram|null>(null);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let current=true;void window.chemez.request('listDiagrams').then(data=>{if(current){setItems(data);setSelected(previous=>previous?data.find(item=>item.id===previous.id)||null:null);setError('');}}).catch(e=>{if(current)setError(errorMessage(e));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[revision]);
  const label=(item:SavedDiagram)=>item.block.type==='molecule'?item.block.label:item.block.type==='reaction'?(item.block.caption||'Reaction scheme'):item.block.type==='resonance'?(item.block.caption||'Resonance structures'):'Mechanism';
  const visible=items.filter(item=>(label(item)+' '+item.title+' '+('smiles' in item.block?item.block.smiles:'')).toLowerCase().includes(query.toLowerCase()));
  return <aside className="structure-panel" aria-label="Structure library">
    <header><div><i className="fas fa-atom" aria-hidden="true"/><h2>Structure library</h2></div><button className="icon-action" aria-label="Close structure library" onClick={onClose}><i className="fas fa-times" aria-hidden="true"/></button></header>
    {selected?<div className="structure-panel-content"><button className="library-back" onClick={()=>setSelected(null)}><i className="fas fa-arrow-left" aria-hidden="true"/>All structures</button><h3>{label(selected)}</h3><p className="muted">Saved in {selected.title}</p><Suspense fallback={<p className="muted">Loading diagram…</p>}><AnswerBlock block={selected.block} onChoice={onUse}/></Suspense><button className="library-open-chat" disabled={busy} onClick={()=>onOpen(selected.conversation_id)}><i className="far fa-comment-alt" aria-hidden="true"/>Open conversation</button>{selected.block.type==='molecule'&&<button className="library-open-chat" disabled={busy} onClick={()=>onUse(`Explain this structure and its functional groups: ${'smiles' in selected.block?selected.block.smiles:''}`)}><i className="fas fa-plus" aria-hidden="true"/>Ask about this structure</button>}</div>:<>
      <label className="library-search"><i className="fas fa-search" aria-hidden="true"/><input aria-label="Search saved structures" placeholder="Search names or SMILES" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <div className="structure-panel-content">{error?<p className="notice error" role="alert">{error}</p>:loading?<p className="muted" role="status">Loading structures…</p>:!items.length?<div className="library-empty"><i className="fas fa-atom" aria-hidden="true"/><h3>Your chemistry, collected.</h3><p>Validated molecules, reactions and mechanisms from your chats appear here automatically.</p></div>:!visible.length?<p className="muted">No matching structures.</p>:<div className="structure-grid">{visible.map(item=>{const svg='svg' in item.block?item.block.svg:item.block.type==='mechanism'?item.block.steps.find(step=>step.svg)?.svg:item.block.type==='resonance'?(item.block.hybrid?.svg||item.block.contributors[0]?.svg):null;return <button key={item.id} onClick={()=>setSelected(item)}><div className="library-thumbnail">{svg&&<img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)} alt={label(item)}/>}</div><strong>{label(item)}</strong><small>{item.title}</small></button>;})}</div>}</div>
    </>}
    <footer>Saved on this device · up to 120 recent diagrams</footer>
  </aside>;
}
