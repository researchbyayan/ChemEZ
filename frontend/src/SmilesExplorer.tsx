import {useEffect,useRef,useState} from 'react';
import {Dialog} from './Dialog';
import {displayName,Formula,savePNG} from './Blocks';
import type {Molecule,Structure3D,StructureAnalysis} from './types';
import {SoftwareModel} from './SoftwareModel';

const webglAvailable=(()=>{try{const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');gl?.getExtension('WEBGL_lose_context')?.loseContext();return !!gl;}catch{return false;}})();

// Same atom pattern XSMILES uses, so per-atom scores line up with its SMILES tokens.
export const smilesAtomCount=(smiles:string)=>Array.from(smiles.matchAll(/(Cl?|Br?|[NOSPFIbcnosp*]|[[^]]+])/g)).length;

// XSMILES and RDKit run in a sandboxed iframe (opaque origin, no app bridge) because RDKit
// MinimalLib needs eval, which the app's own CSP rightly forbids.
function SmilesView({molecule:m}:{molecule:Molecule}){
  const frame=useRef<HTMLIFrameElement>(null);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [height,setHeight]=useState(360);
  const charges=m.atom_charges??[];
  const usable=charges.length>0&&charges.length===smilesAtomCount(m.smiles);
  useEffect(()=>{
    let live=true;
    const receive=async(event:MessageEvent)=>{
      if(!live||event.source!==frame.current?.contentWindow)return;
      const data=event.data as {type?:string;height?:number};
      if(data.type==='loaded'){
        try{
          const assets=await import('./xsmilesAssets');
          const scores=usable?charges:new Array(smilesAtomCount(m.smiles)).fill(0);
          const limit=Math.max(0.25,...scores.map(Math.abs));
          const setup={molecule:{string:m.smiles,method:{name:usable?'Gasteiger partial charge':'Structure',scores,attributes:{}},attributes:{}},gradientConfig:{palette:'PiYG_5',colorDomain:[-limit,0,limit],highlight:false,thresholds:[]},drawerType:'RDKitDrawer',width:540,height:300,hideBarChart:!usable,hideAttributesTable:true,showScoresOnStructure:false};
          if(live)frame.current?.contentWindow?.postMessage({type:'render',rdkit:assets.rdkit,xsmiles:assets.xsmiles,wasm:assets.wasm,setup},'*');
        }catch{if(live)setState('error');}
      }
      else if(data.type==='ready')setState('ready');
      else if(data.type==='error')setState('error');
      else if(data.type==='size'&&typeof data.height==='number')setHeight(Math.min(900,Math.max(120,data.height)));
    };
    window.addEventListener('message',receive);
    return()=>{live=false;window.removeEventListener('message',receive);};
  },[m.smiles]);
  const title=m.iupac_name||m.label||m.formula||'Structure';
  return <>
    <p className="smiles-explorer-help">Hover an atom in the structure or a character in the SMILES string to see how they correspond.{usable&&<> Colours show Gasteiger partial charge: <span className="charge-negative">pink is more negative</span>, <span className="charge-positive">green is more positive</span>.</>}</p>
    <iframe ref={frame} className="smiles-explorer-view" title={`Interactive SMILES view of ${title}`} src={new URL('xsmiles-viewer.html',document.baseURI).href} sandbox="allow-scripts" style={{height,visibility:state==='ready'?'visible':'hidden',position:state==='ready'?'static':'absolute'}}/>
    {state==='loading'&&<p className="smiles-explorer-status" role="status">Loading the SMILES viewer…</p>}
    {state==='error'&&<p className="notice error" role="alert">The interactive SMILES viewer could not load. The structure drawing is still accurate.</p>}
    <code className="smiles-explorer-string">{m.smiles}</code>
    <p className="smiles-explorer-credit">Interactive view by XSMILES (Bayer, BSD-3) with RDKit. Partial charges are an empirical estimate, not a measurement.</p>
  </>;
}

type Style='stick'|'ballstick'|'sphere';
const styles:Record<Style,object>={stick:{stick:{radius:0.15}},ballstick:{stick:{radius:0.1},sphere:{scale:0.25}},sphere:{sphere:{scale:1}}};
// 3Dmol.js (BSD-3) renders an RDKit ETKDG + MMFF conformer; idea from chem-skill and ChemClaw.
function ModelView({data}:{data:Structure3D}){
  const host=useRef<HTMLDivElement>(null);
  const viewer=useRef<{setStyle(a:object,b:object):void;render():void;spin(axis:string|boolean):void;zoomTo():void;clear():void}|null>(null);
  const [style,setStyle]=useState<Style>('ballstick');
  const [spinning,setSpinning]=useState(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let live=true;
    if(!webglAvailable)return;
    import('3dmol').then(($3Dmol)=>{
      if(!live||!host.current||!data.molblock)return;
      const v=$3Dmol.createViewer(host.current,{backgroundColor:'#0f1a14',antialias:true});
      v.addModel(data.molblock,'sdf');v.setStyle({},styles[style]);v.zoomTo();v.render();
      viewer.current=v as unknown as typeof viewer.current;
      if(spinning)v.spin('y');
    }).catch(()=>live&&setError(true));
    return()=>{live=false;viewer.current?.spin(false);viewer.current?.clear();viewer.current=null;};
  },[data.molblock]);
  useEffect(()=>{viewer.current?.setStyle({},styles[style]);viewer.current?.render();},[style]);
  useEffect(()=>{viewer.current?.spin(spinning?'y':false);},[spinning]);
  if(!data.molblock||error)return <p className="notice error" role="alert">A 3D model could not be generated for this structure.</p>;
  return <>
    <p className="smiles-explorer-help">Drag to rotate, scroll to zoom. The geometry is a single low-energy conformer from RDKit ({data.force_field||'unoptimised'}), not an experimental structure.</p>
    {webglAvailable?<div className="model-view" ref={host} role="img" aria-label="Rotatable 3D model"/>:<div className="model-view" role="img" aria-label="Rotatable 3D model"><SoftwareModel molblock={data.molblock} style={style} spinning={spinning}/></div>}
    <div className="model-controls" role="group" aria-label="3D display">
      {(['stick','ballstick','sphere'] as Style[]).map(value=><button key={value} aria-pressed={style===value} onClick={()=>setStyle(value)}>{{stick:'Sticks',ballstick:'Ball and stick',sphere:'Space-filling'}[value]}</button>)}
      <button aria-pressed={spinning} onClick={()=>setSpinning(!spinning)}><i className={spinning?'fas fa-pause':'fas fa-sync-alt'} aria-hidden="true"/>{spinning?'Stop spin':'Spin'}</button>
    </div>
  </>;
}
function PropertiesView({data}:{data:Structure3D}){
  const p=data.properties;
  const rows:[string,React.ReactNode,string?][]=[
    ['Molecular formula',<Formula value={p.formula}/>],['Molar mass',`${p.molar_mass} g/mol`],['Monoisotopic mass',`${p.exact_mass} Da`],
    ['logP (Crippen)',p.logp,'Higher means more lipophilic'],['Polar surface area',`${p.tpsa} Å²`],['H-bond donors',p.h_bond_donors],['H-bond acceptors',p.h_bond_acceptors],
    ['Rotatable bonds',p.rotatable_bonds],['Rings (aromatic)',`${p.rings} (${p.aromatic_rings})`],['Stereocentres',p.stereocentres],['Net formal charge',p.formal_charge],['Heavy atoms',p.heavy_atoms]];
  return <><dl className="property-grid">{rows.map(([label,value,hint])=><div key={label} title={hint}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="smiles-explorer-credit">Calculated with RDKit from the drawn structure. logP and polar surface area are estimates.</p></>;
}

// Functional groups highlight on hover/focus; idea from chemdraw-mcp and openmolclaw, drawn by ChemEZ's RDKit backend.
function GroupsView({smiles}:{smiles:string}){
  const [data,setData]=useState<StructureAnalysis|null>(null),[failed,setFailed]=useState(false),[active,setActive]=useState<number|null>(null),[copied,setCopied]=useState('');
  useEffect(()=>{let live=true;window.chemez.request('analyseStructure',{smiles}).then(result=>{if(live)setData(result);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[smiles]);
  if(failed)return <p className="notice error" role="alert">Functional groups could not be analysed for this structure.</p>;
  if(!data)return <p className="smiles-explorer-status" role="status">Finding functional groups…</p>;
  const svg=active===null?data.stereo_svg:data.groups[active].svg;
  const copy=(label:string,value:string)=>void navigator.clipboard.writeText(value).then(()=>setCopied(label)).catch(()=>{});
  return <>
    <p className="smiles-explorer-help">{data.groups.length?'Hover or focus a group to highlight its atoms.':'No common functional groups were found.'}{data.stereo.length>0&&' R/S and E/Z labels are shown on the structure.'}</p>
    <div className="group-drawing"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)} alt={active===null?'Structure with stereochemistry labels':`${data.groups[active].name} highlighted`}/></div>
    <div className="group-chips" role="list">{data.groups.map((group,index)=><button key={group.name} role="listitem" className="group-chip" aria-pressed={active===index} onMouseEnter={()=>setActive(index)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(index)} onBlur={()=>setActive(null)} onClick={()=>setActive(active===index?null:index)}>{group.name}{group.count>1&&<span className="group-count">×{group.count}</span>}</button>)}</div>
    {data.stereo.length>0&&<p className="stereo-list"><strong>Stereochemistry (CIP):</strong> {data.stereo.join(' · ')}</p>}
    {data.inchikey&&<dl className="identifier-list"><div><dt>InChIKey</dt><dd><button onClick={()=>copy('key',data.inchikey)} aria-label="Copy InChIKey"><code>{data.inchikey}</code><i className={copied==='key'?'fas fa-check':'far fa-copy'} aria-hidden="true"/></button></dd></div><div><dt>InChI</dt><dd><button onClick={()=>copy('inchi',data.inchi)} aria-label="Copy InChI"><code>{data.inchi}</code><i className={copied==='inchi'?'fas fa-check':'far fa-copy'} aria-hidden="true"/></button></dd></div></dl>}
  </>;
}


function Structure2D({molecule:m}:{molecule:Molecule}){
  const [pairs,setPairs]=useState(false),[hydrogens,setHydrogens]=useState(false),[zoom,setZoom]=useState(100);
  const [data,setData]=useState<StructureAnalysis|null>(null),[error,setError]=useState('');
  const needsData=pairs||hydrogens;
  useEffect(()=>{if(!needsData||data||error)return;let live=true;window.chemez.request('analyseStructure',{smiles:m.smiles}).then(value=>{if(live)setData(value);}).catch(()=>{if(live)setError('This depiction could not be prepared. The original structure is still available.');});return()=>{live=false;};},[needsData,data,error,m.smiles]);
  const enhanced=hydrogens?(pairs?data?.lewis_hydrogens_svg:data?.hydrogens_svg):data?.lewis_svg;
  const svg=needsData?enhanced:m.svg;
  const baseWidth=Math.max(120,Math.min(640,Number(svg?.match(/\bwidth=[\"']([0-9.]+)/)?.[1]||240)*1.5));
  const viewport=useRef<HTMLDivElement>(null);
  // Fit is the default: refit whenever the drawing or the viewport size changes, until the user zooms.
  const manual=useRef(false);
  const fit=()=>{
    const element=viewport.current;// offset sizes include any scrollbar, so a fit is the same whether or not the drawing overflowed.
    if(!element||!svg||element.offsetWidth<80||element.offsetHeight<80)return;
    const width=Number(svg.match(/\bwidth=["']([0-9.]+)/)?.[1]||240),height=Number(svg.match(/\bheight=["']([0-9.]+)/)?.[1]||160);
    const scale=Math.min(2,(element.offsetWidth-32)/baseWidth,(element.offsetHeight-56)/(baseWidth*height/width));
    setZoom(Math.max(25,Math.min(200,Math.floor(scale*100/5)*5)));element.scrollTo(0,0);
  };
  useEffect(()=>{manual.current=false;fit();const frame=requestAnimationFrame(()=>{if(!manual.current)fit();});const element=viewport.current;if(!element)return;const observer=new ResizeObserver(()=>{if(!manual.current)fit();});observer.observe(element);return()=>{cancelAnimationFrame(frame);observer.disconnect();};},[svg]);
  return <>
    <div className="structure-view-controls"><label><input type="checkbox" checked={pairs} onChange={e=>setPairs(e.target.checked)}/>Lone pairs</label><label><input type="checkbox" checked={hydrogens} onChange={e=>setHydrogens(e.target.checked)}/>Show hydrogens</label><button disabled={!svg} onClick={()=>svg&&void savePNG(svg).catch(()=>setError('PNG export was unavailable.'))}><i className="fas fa-download" aria-hidden="true"/>Save PNG</button></div>
    {error?<p role="alert" className="notice error">{error}</p>:!svg?<p className={data?undefined:"structure-loading"} role="status">{data?'Explicit detail exceeds the drawing limit. Turn off Show hydrogens to return.':'Preparing the 2D depiction…'}</p>:<div className="structure-2d-stage"><div ref={viewport} className="structure-2d-viewport group-drawing"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)} style={{width:(baseWidth*zoom/100)+'px',maxWidth:'none'}} alt={pairs?'Structure showing lone electron pairs':'2D molecular structure'}/></div><div className="structure-zoom-tools" role="group" aria-label="2D zoom controls"><button aria-label="Zoom out 2D structure" disabled={zoom<=25} onClick={()=>{manual.current=true;setZoom(value=>Math.max(25,value-25));}}>−</button><output aria-label="2D zoom level">{zoom}%</output><button aria-label="Zoom in 2D structure" disabled={zoom>=200} onClick={()=>{manual.current=true;setZoom(value=>Math.min(200,value+25));}}>+</button><button className="zoom-fit" onClick={()=>{manual.current=false;fit();}}>Fit</button></div></div>}
    {pairs&&<p className="smiles-explorer-help">Each pair of dots represents a lone electron pair. Formal charges and stereochemistry remain part of the structure.</p>}
  </>;
}

export function SmilesExplorer({molecule:m,onClose}:{molecule:Molecule;onClose:()=>void}){
  const [tab,setTab]=useState<'structure'|'groups'|'smiles'|'properties'>('structure');
  // One Structure tab with a 2D/3D switch; 2D first, the 3D geometry is fetched in the background.
  const [view,setView]=useState<'2d'|'3d'>('2d');
  const [data,setData]=useState<Structure3D|null>(null);
  const [failed,setFailed]=useState(false);
  const geometry=useRef<{smiles:string;promise:Promise<Structure3D>}|null>(null);
  useEffect(()=>{
    if(!geometry.current||geometry.current.smiles!==m.smiles)geometry.current={smiles:m.smiles,promise:window.chemez.request('structure3d',{smiles:m.smiles})};
    let live=true;
    geometry.current.promise.then(result=>{if(live)setData(result);}).catch(()=>{if(live)setFailed(true);});
    return()=>{live=false;};
  },[m.smiles]);
  const title=displayName(m.iupac_name||m.label||m.formula||'Structure');
  const tabs:[typeof tab,string][]=[['structure','Structure'],['groups','Functional groups'],['smiles','SMILES to atoms'],['properties','Properties']];
  const model=failed?<p className="notice error" role="alert">This structure could not be analysed.</p>:!data?<p className="smiles-explorer-status" role="status">Building the model…</p>:null;
  return <Dialog title={title} onClose={onClose} className="smiles-explorer">
    <div className="explorer-tabs" role="tablist" aria-label="Structure views">{tabs.map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    <div role="tabpanel" aria-label={tabs.find(([key])=>key===tab)![1]}>
      {tab==='structure'?<>
        <div className="view-switch" role="radiogroup" aria-label="Structure view">{(['2d','3d'] as const).map(value=><button key={value} type="button" role="radio" aria-checked={view===value} onClick={()=>setView(value)}>{value==='2d'?'2D':'3D'}</button>)}</div>
        {view==='2d'?<Structure2D molecule={m}/>:model||<ModelView data={data!}/>}
      </>:tab==='smiles'?<SmilesView molecule={m}/>:tab==='groups'?<GroupsView smiles={m.smiles}/>:model||<PropertiesView data={data!}/>}
    </div>
  </Dialog>;
}
