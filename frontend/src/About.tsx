import {useEffect,useState} from 'react';
import {Logo} from './Logo';
export interface AppInformation {version:string;platform:string;arch:string;nativeArch:string;build:string;dirty:boolean;source:string}
export interface Credit {id:string;name:string;version?:string;url:string;group:'software'|'data'|'reference';license:string;note:string;licenseAvailable:boolean}
export interface UpdateResult {status:'current'|'available';version:string;url?:string;size?:number}
export default function About(){
 const [info,setInfo]=useState<AppInformation|null>(null),[entries,setEntries]=useState<Credit[]>([]),[query,setQuery]=useState(''),[text,setText]=useState(''),[selected,setSelected]=useState(''),[error,setError]=useState(''),[update,setUpdate]=useState<UpdateResult|null>(null),[checking,setChecking]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;window.chemez.appInfo?.().then(value=>{if(live)setInfo(value);}).catch(()=>{});window.chemez.credits?.().then(value=>{if(live)setEntries(value.entries);}).catch(()=>{if(live)setError('Credits could not be loaded. Reopen the app or check the installation.');});return()=>{live=false;};},[]);
 async function copy(){try{await navigator.clipboard.writeText(info?`ChemEZ ${info.version}\n${info.platform} ${info.arch} (native ${info.nativeArch})\nBuild ${info.build}${info.dirty?' (local changes)':''}\n${info.source}`:`ChemEZ ${__APP_VERSION__}`);setNotice('App information copied.');}catch{setError('Could not copy app information.');}}
 async function updates(){setChecking(true);setError('');setUpdate(null);try{if(!window.chemez.checkUpdates)throw new Error();setUpdate(await window.chemez.checkUpdates());}catch{setError('Could not check for updates. Check your connection and try again.');}finally{setChecking(false);}}
 async function license(entry:Credit){setError('');setSelected(entry.name);setText('Loading license…');try{setText(await window.chemez.license!(entry.id));}catch{setText('');setError('This license text could not be opened.');}}
 const visible=entries.filter(e=>[e.name,e.note,e.license].join(' ').toLowerCase().includes(query.toLowerCase()));
 const platform=info?.platform==='darwin'?'macOS':info?.platform==='win32'?'Windows':info?.platform;
 return <section aria-label="About" className="settings-about">
 <div className="about-head"><Logo mini/><div><b>ChemEZ</b><small>Version {info?.version||__APP_VERSION__}</small></div></div>
 <p className="about-tagline">Structures, reactions, and chemistry explained clearly.</p>
 <div className="about-developer"><small>Developed by</small><b>Mohammed Ayan Mahmood</b><div className="about-links">{([['https://github.com/researchbyayan/ChemEZ','fab fa-github','ChemEZ on GitHub'],['https://linkedin.com/in/mohammedayanm','fab fa-linkedin','LinkedIn'],['https://scholar.google.com/citations?user=MAMahmood','fas fa-graduation-cap','Google Scholar']] as const).map(([url,icon,label])=><button type="button" key={label} onClick={()=>void window.chemez.openLink?.(url)}><i className={icon} aria-hidden="true"/>{label}</button>)}</div></div>
 <div className="about-app-section" aria-label="Application information"><h3>Application</h3><div className="about-app-menu"><button disabled={checking} onClick={()=>void updates()}><i className="fas fa-sync-alt" aria-hidden="true"/><span>{checking?'Checking…':'Check for updates'}</span><i className="fas fa-chevron-right" aria-hidden="true"/></button><button onClick={()=>void window.chemez.openLink?.('https://github.com/researchbyayan/ChemEZ')}><i className="fab fa-github" aria-hidden="true"/><span>Source code</span><i className="fas fa-external-link-alt" aria-hidden="true"/></button></div>
 {notice&&<p className="about-feedback" role="status">{notice}</p>}{error&&<p className="about-feedback" role="alert">{error}</p>}{update&&<p className="about-feedback" role="status">{update.status==='current'?'You’re using the latest public release.':<>Version {update.version} is available. <button onClick={()=>void window.chemez.openLink?.(update.url!)}>Download installer</button></>}</p>}
 <details className="about-technical"><summary>App details</summary><p>RDKit provides molecular processing; PubChem supplies compound information. Structural checks do not establish experimental correctness. Spectral predictions may use typical values or aggregate reference data; they are not measurements of your sample.</p>{info&&<dl><dt>System</dt><dd>{platform} · {info.arch}</dd><dt>Build</dt><dd>{info.build.slice(0,12)}{info.dirty?' · development':''}</dd></dl>}<button className="about-copy-details" aria-label="Copy app information" onClick={()=>void copy()}><i className="far fa-copy" aria-hidden="true"/>Copy app info</button></details>
 </div>
 <div className="about-open-source"><h3>Open source</h3><p>Application license: MIT. Third-party components and data retain their own licenses.</p>
 <details className="credits-section"><summary>Credits &amp; licenses ({entries.length})</summary><label>Find a project<input aria-label="Search credits" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, license or contribution"/></label>
 {([['software','Bundled software'],['data','Incorporated data'],['reference','Research & design references']] as const).filter(([group])=>visible.some(e=>e.group===group)).map(([group,label])=><div key={group}><h3>{label}</h3>{visible.filter(e=>e.group===group).map(entry=><details className="credit-entry" key={entry.id}><summary>{entry.name}{entry.version?' '+entry.version:''}</summary><p>{entry.note}</p><small>{entry.license}</small><div className="about-links"><button onClick={()=>void window.chemez.openCreditSource?.(entry.id).catch(()=>setError('Could not open the upstream source.'))}>Upstream source</button>{entry.licenseAvailable&&<button onClick={()=>void license(entry)}>Read license</button>}</div></details>)}</div>)}
 {query&&!visible.length&&<p>No matching credits.</p>}
 {selected&&<div className="license-reader"><div><b>{selected}</b><button aria-label="Close license" onClick={()=>{setSelected('');setText('');}}>Close</button></div><pre tabIndex={0}>{text}</pre></div>}
 </details>
 
 </div>
 </section>;
}
