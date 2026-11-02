export type SpectralKind='IR'|'¹H NMR'|'¹³C NMR'|'MS';
export type SpectralPart={text:string;kind?:SpectralKind;peaks?:{position:number;label:string;intensity?:number}[]};
// Only turn explicit numeric table entries into markers. Never invent intensities or splitting.
export function spectralParts(text:string):SpectralPart[]{
  const lines=text.split('\n'),parts:SpectralPart[]=[];let chunk:string[]=[],kind:SpectralKind|undefined;
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
export function lineShape(kind:SpectralKind,peaks:{position:number;label:string;intensity?:number}[],low:number,high:number){
  if(kind==='MS'||!peaks.length)return [];
  const samples=720,values=Array.from({length:samples},(_,i)=>{
    const position=low+(high-low)*i/(samples-1);
    const value=peaks.reduce((sum,peak)=>{
      const width=kind==='IR'?(/broad|O[–-]H|N[–-]H/i.test(peak.label)?100:18):kind==='¹H NMR'?.025:.4;
      const delta=(position-peak.position)/width;
      return sum+(kind==='IR'?Math.exp(-delta*delta/2):1/(1+delta*delta));
    },0);
    return {position,value};
  });
  const max=Math.max(...values.map(p=>p.value),1e-10);
  return values.map(p=>({position:p.position,value:p.value/max}));
}
