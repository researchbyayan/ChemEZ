import {markdownTables} from './markdownTables';
export type SpectralKind='IR'|'¹H NMR'|'¹³C NMR'|'MS';
export type SpectralPart={text:string;kind?:SpectralKind;peaks?:{position:number;label:string;intensity?:number}[]};
// Only turn explicit numeric table entries into markers. Never invent intensities or splitting.
export function spectralParts(text:string):SpectralPart[]{
  const lines=markdownTables(text).split('\n'),parts:SpectralPart[]=[];let chunk:string[]=[],kind:SpectralKind|undefined;
  const flush=()=>{if(chunk.length)parts.push({text:chunk.join('\n')});chunk=[];};
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line.trim().startsWith('|')){
      const heading=line.replace(/[*#$]/g,'').trim();
      if(/^(?:IR|infrared)\b/i.test(heading))kind='IR';
      else if(/^(?:¹³|13|carbon.?13)\s*C?\s*(?:NMR)?\b/i.test(heading))kind='¹³C NMR';
      else if(/^(?:¹H|1H|proton)\s*(?:NMR)?\b/i.test(heading))kind='¹H NMR';
      else if(/^(?:MS|mass spectr)/i.test(heading))kind='MS';
      else if(/^(?:#{1,6}\s|\*\*[^*]+\*\*)/.test(line))kind=undefined;
      chunk.push(line);continue;
    }
    const table:string[]=[];
    while(i<lines.length&&lines[i].trim().startsWith('|'))table.push(lines[i++]);i--;
    chunk.push(...table);
    if(!kind)continue;
    const headers=table[0].split('|').slice(1,-1);
    const intensityIndex=headers.findIndex(cell=>/intensity|abundance/i.test(cell));
    const peaks=table.slice(2).flatMap(row=>{
      const cells=row.split('|').slice(1,-1).map(cell=>cell.trim());
      const match=cells[0]?.match(/^\s*[~≈]?\s*(-?\d+(?:\.\d+)?)(?:\s*[–−-]\s*(\d+(?:\.\d+)?))?/);
      if(!match)return [];
      const position=match[2]?(Number(match[1])+Number(match[2]))/2:Number(match[1]);
      const [low,high]=kind==='IR'?[400,4500]:kind==='¹H NMR'?[-2,16]:kind==='¹³C NMR'?[-20,250]:[0,10000];
      const intensity=intensityIndex>=0?Number(cells[intensityIndex]?.replace('%','')):NaN;
      return position>=low&&position<=high?[{position,label:cells.slice(1).join(' · ').slice(0,180),...(Number.isFinite(intensity)&&intensity>=0&&intensity<=100?{intensity}: {})}]:[];
    }).slice(0,100);
    flush();parts.push({text:'',kind,peaks});
  }
  flush();return parts;
}

// Display broadening only: input peak positions remain estimates, not a quantum prediction.
// IR bands: Lorentzian (condensed-phase) shape. Depth comes from a strength tag in the row
// (vs/s/m/w, strong/medium/weak) or, failing that, from the bond type; width from a "broad"/"sharp"
// tag or the bond type (H-bonded O–H ~300 cm⁻¹, N–H ~70, C=O ~18, C–H ~12).
export function irBand(position:number,label:string){
  const text=label.toLowerCase();
  const tagged=/\b(vs|very strong)\b/.test(text)?1:/\b(s|strong)\b/.test(text)?.85:/\b(m|medium)\b/.test(text)?.55:/\b(w|weak)\b/.test(text)?.25:NaN;
  const oh=/o[–-]h/.test(text),nh=/n[–-]h/.test(text),carbonyl=/c=o|carbonyl/.test(text),ch=/c[–-]h/.test(text),polar=/c[–-](o|cl|f|br|n)|s=o|n=o|no2|p=o/.test(text);
  const strength=Number.isFinite(tagged)?tagged:oh||carbonyl?.9:polar?.8:nh?.55:ch&&position>2700?.35:.5;
  const broad=/broad|br\b/.test(text),sharp=/sharp/.test(text);
  const width=sharp?7:oh&&(broad||position<3500)?150:oh?40:nh?(broad?60:35):broad?40:carbonyl?11:ch&&position>2700?9:polar?12:9;
  return {strength,width};
}
export function lineShape(kind:SpectralKind,peaks:{position:number;label:string;intensity?:number}[],low:number,high:number){
  if(kind==='MS'||!peaks.length)return [];
  if(kind==='IR'){
    // Absorbance-like depth (0–0.97); the graph draws it hanging down from a near-100 %T baseline.
    const bands=peaks.map(peak=>({centre:peak.position,...irBand(peak.position,peak.label)}));
    return Array.from({length:1400},(_,i)=>{
      const position=low+(high-low)*i/1399;
      const depth=bands.reduce((sum,b)=>{const d=(position-b.centre)/b.width;return sum+b.strength/(1+d*d);},0);
      return {position,value:Math.min(.97,depth)};
    });
  }
  const samples=720,values=Array.from({length:samples},(_,i)=>{
    const position=low+(high-low)*i/(samples-1);
    const value=peaks.reduce((sum,peak)=>{
      const width=kind==='¹H NMR'?.025:.4;
      const delta=(position-peak.position)/width;
      return sum+1/(1+delta*delta);
    },0);
    return {position,value};
  });
  const max=Math.max(...values.map(p=>p.value),1e-10);
  return values.map(p=>({position:p.position,value:p.value/max}));
}
