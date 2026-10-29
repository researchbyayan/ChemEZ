import {useEffect,useRef} from 'react';

// Canvas 2D ball-and-stick renderer for machines where WebGL (and so 3Dmol.js) is unavailable.
type Atom={x:number;y:number;z:number;symbol:string};
const colours:Record<string,string>={C:'#909090',H:'#f2f2f2',O:'#ff3d3d',N:'#4a6cff',S:'#e8d63a',Cl:'#2fd42f',Br:'#b03a3a',F:'#90e050',I:'#9c2bb0',P:'#ff8000',B:'#ffb5b5',Si:'#f0c8a0',Na:'#ab5cf2',K:'#8f40d4',Mg:'#8aff00',Al:'#bfa6a6',Fe:'#e06633'};
const vdw:Record<string,number>={H:1.1,C:1.7,N:1.55,O:1.52,F:1.47,Cl:1.75,Br:1.85,I:1.98,S:1.8,P:1.8};
export function parseMolblock(block:string){
  const lines=block.split('\n');const counts=lines[3]||'';
  const atomCount=Number(counts.slice(0,3)),bondCount=Number(counts.slice(3,6));
  const atoms:Atom[]=lines.slice(4,4+atomCount).map(line=>({x:Number(line.slice(0,10)),y:Number(line.slice(10,20)),z:Number(line.slice(20,30)),symbol:line.slice(31,34).trim()}));
  const bonds=lines.slice(4+atomCount,4+atomCount+bondCount).map(line=>[Number(line.slice(0,3))-1,Number(line.slice(3,6))-1,Number(line.slice(6,9))] as [number,number,number]);
  const centre=['x','y','z'].map(k=>atoms.reduce((sum,a)=>sum+a[k as 'x'],0)/Math.max(1,atoms.length));
  for(const a of atoms){a.x-=centre[0];a.y-=centre[1];a.z-=centre[2];}
  return {atoms,bonds};
}
export function SoftwareModel({molblock,style,spinning}:{molblock:string;style:'stick'|'ballstick'|'sphere';spinning:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const view=useRef({yaw:0.6,pitch:-0.35,zoom:1,style,spinning});
  view.current.style=style;view.current.spinning=spinning;
  useEffect(()=>{
    const element=canvas.current!;const context=element.getContext('2d')!;
    const {atoms,bonds}=parseMolblock(molblock);
    const extent=Math.max(1.2,...atoms.map(a=>Math.hypot(a.x,a.y,a.z)))+0.9;
    // Open on the orientation that shows the molecule widest (largest projected spread).
    let best=-1;
    for(let i=0;i<24;i++)for(let j=-3;j<=3;j++){
      const yaw=i*Math.PI/12,pitch=j*Math.PI/8,[cy,sy,cp,sp]=[Math.cos(yaw),Math.sin(yaw),Math.cos(pitch),Math.sin(pitch)];
      const spread=atoms.reduce((sum,a)=>{const x=a.x*cy+a.z*sy,z1=-a.x*sy+a.z*cy,y=a.y*cp-z1*sp;return sum+x*x+y*y;},0);
      if(spread>best){best=spread;view.current.yaw=yaw;view.current.pitch=pitch;}
    }
    let frame=0,last=performance.now(),dragging:{x:number;y:number}|null=null;
    const draw=()=>{
      const ratio=window.devicePixelRatio||1,width=element.clientWidth,height=element.clientHeight;
      if(element.width!==width*ratio){element.width=width*ratio;element.height=height*ratio;}
      context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);
      const {yaw,pitch,zoom,style}=view.current;
      const scale=Math.min(width,height)/(2*(extent+(style==="sphere"?1.1:0)))*zoom;
      const [cy,sy,cp,sp]=[Math.cos(yaw),Math.sin(yaw),Math.cos(pitch),Math.sin(pitch)];
      const projected=atoms.map(a=>{const x=a.x*cy+a.z*sy,z1=-a.x*sy+a.z*cy,y=a.y*cp-z1*sp,z=a.y*sp+z1*cp;return {x:width/2+x*scale,y:height/2-y*scale,z,a};});
      const radius=(symbol:string)=>style==='sphere'?(vdw[symbol]||1.8)*scale:style==='ballstick'?(symbol==='H'?0.24:0.38)*scale:0.11*scale;
      const items:{z:number;paint:()=>void}[]=[];
      if(style!=='sphere')for(const [i,j,order] of bonds){
        const p=projected[i],q=projected[j];if(!p||!q)continue;
        items.push({z:(p.z+q.z)/2-0.01,paint:()=>{
          const mx=(p.x+q.x)/2,my=(p.y+q.y)/2,widthPx=Math.max(1.5,(style==='stick'?0.22:0.12)*scale);
          const dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
          const offsets=style==='ballstick'&&order>1?(order===2?[-1,1]:[-1.6,0,1.6]).map(k=>k*widthPx*0.9):[0];
          context.lineCap='round';context.lineWidth=offsets.length>1?widthPx*0.7:widthPx;
          for(const k of offsets)for(const [from,to,end] of [[p,{x:mx,y:my},p],[{x:mx,y:my},q,q]] as const){
            context.strokeStyle=colours[end.a.symbol]||'#ff69b4';context.beginPath();context.moveTo(from.x+nx*k,from.y+ny*k);context.lineTo(to.x+nx*k,to.y+ny*k);context.stroke();}
        }});
      }
      for(const p of projected)items.push({z:p.z,paint:()=>{
        const r=radius(p.a.symbol),base=colours[p.a.symbol]||'#ff69b4';
        const gradient=context.createRadialGradient(p.x-r*0.35,p.y-r*0.35,r*0.1,p.x,p.y,r);
        context.beginPath();context.arc(p.x,p.y,r,0,Math.PI*2);context.fillStyle=base;context.fill();
        gradient.addColorStop(0,'#ffffffcc');gradient.addColorStop(0.3,'#ffffff00');gradient.addColorStop(0.75,'#00000000');gradient.addColorStop(1,'#00000088');
        context.fillStyle=gradient;context.fill();
      }});
      items.sort((a,b)=>a.z-b.z).forEach(item=>item.paint());
    };
    const tick=(now:number)=>{if(view.current.spinning&&!dragging)view.current.yaw+=(now-last)*0.0006;last=now;draw();frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    const down=(e:PointerEvent)=>{dragging={x:e.clientX,y:e.clientY};element.setPointerCapture(e.pointerId);};
    const move=(e:PointerEvent)=>{if(!dragging)return;view.current.yaw+=(e.clientX-dragging.x)*0.01;view.current.pitch+=(e.clientY-dragging.y)*0.01;dragging={x:e.clientX,y:e.clientY};};
    const up=()=>{dragging=null;};
    const wheel=(e:WheelEvent)=>{e.preventDefault();view.current.zoom=Math.min(4,Math.max(0.4,view.current.zoom*Math.exp(-e.deltaY*0.001)));};
    element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('wheel',wheel,{passive:false});
    return()=>{cancelAnimationFrame(frame);element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('wheel',wheel);};
  },[molblock]);
  return <canvas ref={canvas} className="model-canvas"/>;
}
