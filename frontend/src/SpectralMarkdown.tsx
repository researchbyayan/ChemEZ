import {useState,useRef,useEffect,useMemo,type ReactNode} from 'react';
import {spectralParts,lineShape,type SpectralKind} from './spectralData';
import {spectralAssignment} from './chemText';
type Peak={position:number;label:string;intensity?:number};
type Region={low:number;high:number};
// Instrument-style frame for every spectrum: boxed plot, round-number major ticks with minor
// ticks between (inward), faint gridlines. IR adds a 0–100 %T scale; MS a 0–100 relative scale
// when intensities are known. Plot area: x 48–612, y 29 (top) to 130 (baseline).
const T=(t:number)=>29+(1-t/100)*101;
const ceilTo=(value:number,step:number)=>Math.ceil(value/step)*step;
// Label x positions pushed apart so neighbouring peaks (e.g. m/z 77 and 78) never overlap;
// each label keeps a short angled leader to its true position.
function spreadLabels(xs:number[],gap=11){
  const order=xs.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value),placed=new Array(xs.length).fill(0);
  let last=-Infinity;for(const item of order){const at=Math.max(item.value,last+gap);placed[item.index]=at;last=at;}
  const overflow=Math.max(0,last-612);if(overflow)for(const item of order)placed[item.index]=Math.max(48,placed[item.index]-overflow);
  return placed;
}
function niceStep(span:number,target:number){const raw=span/target,steps=[.1,.2,.25,.5,1,2,2.5,5,10,20,25,50,100,200,250,500,1000];return steps.find(step=>step>=raw)||1000;}
function PlotFrame({kind,x,low,high,percent}:{kind:SpectralKind;x:(value:number)=>number;low:number;high:number;percent:boolean}){
  const span=high-low,step=kind==='IR'?500:niceStep(span,kind==='MS'?7:8),minorStep=kind==='IR'?100:step/(String(step).startsWith('2')&&step!==2.5?4:5);
  const ticks=(stepSize:number)=>{const out:number[]=[];for(let v=Math.ceil(low/stepSize-1e-9)*stepSize;v<=high+1e-9;v+=stepSize)out.push(Number(v.toFixed(4)));return out;};
  const major=ticks(step),minor=ticks(minorStep).filter(v=>!major.some(m=>Math.abs(m-v)<1e-6));
  const digits=step<1?(step<.25?1:2):0;
  return <g className="ir-frame">
    {percent&&[20,40,60,80].map(t=><line key={t} x1="48" x2="612" y1={T(t)} y2={T(t)} className="ir-grid"/>)}
    {major.map(v=><line key={'g'+v} x1={x(v)} x2={x(v)} y1="29" y2="130" className="ir-grid"/>)}
    <rect x="48" y="29" width="564" height="101" fill="none" className="ir-box"/>
    {major.map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="130" y2="125" className="ir-tick"/><line x1={x(v)} x2={x(v)} y1="29" y2="34" className="ir-tick"/><text x={x(v)} y="142" textAnchor="middle" className="ir-label">{v.toFixed(digits)}</text></g>)}
    {minor.map(v=><g key={'m'+v}><line x1={x(v)} x2={x(v)} y1="130" y2="127.5" className="ir-tick"/><line x1={x(v)} x2={x(v)} y1="29" y2="31.5" className="ir-tick"/></g>)}
    {percent&&[0,20,40,60,80,100].map(t=><g key={'y'+t}><line x1="48" x2="52" y1={T(t)} y2={T(t)} className="ir-tick"/><text x="44" y={T(t)+3} textAnchor="end" className="ir-label">{t}</text></g>)}
  </g>;
}
// Each peak's position written vertically in a row above the plot, with a short tick into the
// frame, so labels never sit on the trace (as on instrument printouts).
function PeakLabel({x,labelX=x,text}:{x:number;labelX?:number;text:string}){
  return <g className="ir-peak"><path d={`M${x} 29L${x} 27L${labelX} 22`} fill="none" className="ir-leader"/><text x={labelX} y="20" transform={`rotate(-90 ${labelX} 20)`} textAnchor="start" dominantBaseline="middle" className="ir-peak-label">{text}</text></g>;
}
function Spectrum({kind,peaks,onSelect}:{kind:SpectralKind;peaks:Peak[];onSelect:(region:Region|null)=>void}){
  const [highlight,setHighlight]=useState(false),[selection,setSelection]=useState<Region|null>(null),[error,setError]=useState('');
  const svg=useRef<SVGSVGElement>(null),drag=useRef<number|null>(null);
  // MS zooms to the region with peaks (10-unit margins) instead of always starting at m/z 0.
  const msLow=peaks.length?Math.max(0,Math.floor((Math.min(...peaks.map(p=>p.position))-12)/10)*10):0;
  const low=kind==='IR'?400:kind==='¹H NMR'?Math.min(0,...peaks.map(p=>p.position)):kind==='¹³C NMR'?Math.min(0,...peaks.map(p=>p.position)):msLow;
  const high=kind==='IR'?Math.max(4000,...peaks.map(p=>p.position)):kind==='¹H NMR'?Math.max(12,...peaks.map(p=>p.position)):kind==='¹³C NMR'?Math.max(220,...peaks.map(p=>p.position)):Math.max(ceilTo(Math.max(...peaks.map(p=>p.position),0)+12,10),msLow+40);
  const reverse=kind!=='MS',x=(value:number)=>48+(reverse?(high-value)/(high-low):(value-low)/(high-low))*564;
  const curve=useMemo(()=>lineShape(kind,peaks,low,high),[kind,peaks,low,high]);
  const pick=(clientX:number)=>{const bounds=svg.current!.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((clientX-bounds.left)/bounds.width*650-48)/564));return reverse?high-fraction*(high-low):low+fraction*(high-low);};
  const select=(region:Region|null)=>{setSelection(region);onSelect(region);};
  const unit=kind==='IR'?'cm⁻¹':kind==='MS'?'m/z':'ppm';
  const save=async()=>{try{const clone=svg.current!.cloneNode(true) as SVGSVGElement;clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width','1300');clone.setAttribute('height','350');const background=document.createElementNS('http://www.w3.org/2000/svg','rect');background.setAttribute('width','650');background.setAttribute('height','175');background.setAttribute('fill','#091710');const original=svg.current!.querySelectorAll('*'),copies=clone.querySelectorAll('*');original.forEach((node,i)=>{const style=getComputedStyle(node);for(const key of ['fill','stroke','color','font-size','font-family'])copies[i].setAttribute(key,style.getPropertyValue(key));});clone.insertBefore(background,clone.firstChild);await (await import('./Blocks')).savePNG(new XMLSerializer().serializeToString(clone));}catch{setError('The graph could not be saved.');}};
  return <figure className="spectrum-figure"><figcaption><strong>{kind}</strong><span>{kind==='MS'?(peaks.every(p=>p.intensity!==undefined)?'Intensities from table':'Estimated peak positions'):'Estimated peaks · display-broadened'}</span><div className="spectrum-tools"><button type="button" aria-label={`Highlight ${kind} peaks`} aria-pressed={highlight} title="Select peaks or drag a region; matching table rows are highlighted" onClick={()=>{setHighlight(!highlight);if(highlight)select(null);}}><i className="fas fa-highlighter" aria-hidden="true"/></button><button type="button" aria-label={`Save ${kind} graph as PNG`} title="Save graph as PNG" onClick={()=>void save()}><i className="fas fa-download" aria-hidden="true"/></button></div></figcaption>
    <svg ref={svg} className={highlight?'selecting':''} viewBox="0 0 650 175" role="img" tabIndex={highlight?0:undefined} aria-label={`${kind} graph. ${kind==='MS'?(peaks.every(p=>p.intensity!==undefined)?'Heights follow the supplied intensity column.':'Equal heights; fragment abundances unavailable.'):'Display-broadened estimated peaks, not a measured spectrum.'} ${highlight?'Click a peak or drag a region. Arrow keys select peaks.':''}`} onKeyDown={event=>{if(!highlight||!peaks.length||!['ArrowLeft','ArrowRight','Escape'].includes(event.key))return;event.preventDefault();if(event.key==='Escape'){select(null);return;}const current=peaks.findIndex(p=>selection&&p.position>=selection.low&&p.position<=selection.high),next=(current+(event.key==='ArrowRight'?1:-1)+peaks.length)%peaks.length,tolerance=kind==='IR'?30:kind==='MS'?1:.1;select({low:peaks[next].position-tolerance,high:peaks[next].position+tolerance});}}
    onPointerDown={event=>{if(!highlight)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current=pick(event.clientX);select({low:drag.current,high:drag.current});}}
    onPointerMove={event=>{if(drag.current!==null){const value=pick(event.clientX);select({low:Math.min(drag.current,value),high:Math.max(drag.current,value)});}}}
    onPointerUp={event=>{if(drag.current===null)return;const value=pick(event.clientX),start=drag.current;drag.current=null;if(Math.abs(value-start)<(high-low)*.012){const nearest=peaks.reduce<Peak|null>((best,p)=>!best||Math.abs(p.position-value)<Math.abs(best.position-value)?p:best,null),tolerance=kind==='IR'?30:kind==='MS'?1:.1;if(nearest)select({low:nearest.position-tolerance,high:nearest.position+tolerance});}}} onPointerCancel={()=>{drag.current=null;}}>
      {selection&&<rect x={Math.min(x(selection.low),x(selection.high))} y="25" width={Math.max(2,Math.abs(x(selection.high)-x(selection.low)))} height="105" fill="#a4ddbb30"/>}
      <PlotFrame kind={kind} x={x} low={low} high={high} percent={kind==='IR'||kind==='MS'&&peaks.every(p=>p.intensity!==undefined)}/>
      <text x="14" y="83" textAnchor="middle" transform="rotate(-90 14 83)">{kind==='MS'?(peaks.every(p=>p.intensity!==undefined)?'Relative intensity (%)':'Unspecified intensity'):kind==='IR'?'Transmittance (%)':'Intensity (a.u.)'}</text>
      {curve.length>0&&<path d={curve.map((p,i)=>`${i?'L':'M'}${x(p.position).toFixed(2)} ${(kind==='IR'?29+p.value*101:130-p.value*88).toFixed(2)}`).join(' ')} fill="none" stroke="var(--green)" strokeWidth={kind==='IR'?1.4:1.7} strokeLinejoin="round"/>}
      {(()=>{const labelXs=spreadLabels(peaks.map(p=>x(p.position)));return peaks.map((peak,i)=><g key={i}><title>{peak.position}: {peak.label}</title>{kind==='MS'&&<path d={`M${x(peak.position)} 130V${T(peak.intensity??100)}`} stroke="var(--green)" strokeWidth="1.6"/>}<PeakLabel x={x(peak.position)} labelX={labelXs[i]} text={kind==='IR'||kind==='MS'?String(Math.round(peak.position)):kind==='¹H NMR'?peak.position.toFixed(2):peak.position.toFixed(1)}/></g>);})()}
      <text x="330" y="172" textAnchor="middle">{kind==='IR'?'Wavenumber (cm⁻¹)':kind==='MS'?'m/z':'Chemical shift δ (ppm)'}</text>
    </svg>
    {!peaks.length&&<p>No numeric peaks were supplied. A compound without the relevant nuclei has no corresponding NMR signals.</p>}
    {/* Selected bands are shown by highlighting their rows in the table itself. */}

{error&&<p role="alert">{error}</p>}
  </figure>;
}
export default function SpectralMarkdown({text,renderText}:{text:string;renderText:(text:string)=>ReactNode}){
  const root=useRef<HTMLDivElement>(null),[region,setRegion]=useState<{index:number;range:Region}|null>(null);
  const parts=useMemo(()=>spectralParts(text),[text]);
  useEffect(()=>{
    const rows=root.current?.querySelectorAll('tr');rows?.forEach(row=>row.classList.remove('spectral-table-selected'));
    if(!region)return;
    const tables=root.current?.querySelector(`[data-spectral-text="${region.index-1}"]`);
    tables?.querySelectorAll('tbody tr').forEach(row=>{const match=row.querySelector('td')?.textContent?.match(/[-~≈]?\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/);if(!match)return;const value=match[2]?(Number(match[1])+Number(match[2]))/2:Number(match[1]);if(value>=region.range.low&&value<=region.range.high)row.classList.add('spectral-table-selected');});
  },[region]);
  return <div ref={root}>{parts.map((part,i)=>part.kind?<Spectrum key={i} kind={part.kind} peaks={part.peaks||[]} onSelect={range=>setRegion(range?{index:i,range}:null)}/>:<div key={i} data-spectral-text={i}>{renderText(part.text)}</div>)}</div>;
}
