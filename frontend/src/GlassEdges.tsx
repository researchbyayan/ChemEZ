import {useEffect} from 'react';

// Real liquid-glass refraction at the edges of the app window, using vitrio (MIT,
// eamonliu/vitrio). Vitrio bends a cloned DOM background, and the window's real backdrop is
// the desktop, which the page cannot see. So a static, decorative light layer sits behind the
// app; lenses refract it and are masked to a thin rim (see .lqg-lens in chat-layout.css).
// Chat content is never cloned. Switched on or off in Preferences.
// A subtle bezel with a 30% frost (vitrio's blur range is 0–24 px). The composer has no lens:
// it is matte frosted glass (backdrop blur only).
const FROST=0.3*24;
const surfaces:[string,Record<string,number>][]= [
  ['.app-shell',{radius:12,scale:8,depth:5,curvature:1.3,chroma:0.03,blur:FROST,edge:0.9,glow:0.35,specAngle:135}],
];
export type GlassMode='on'|'off';
// On unless switched off in Preferences (an earlier "follow system" choice counts as on).
export function storedGlassMode():GlassMode{try{return localStorage.getItem('chemez-glass-effects')==='off'?'off':'on';}catch{return 'on';}}
export function GlassEdges({mode}:{mode:GlassMode}){
  useEffect(()=>{
    if(mode==='off')return;
    let live=true;const lenses:{destroy():void}[]=[];
    let timer:ReturnType<typeof setTimeout>|undefined;
    void import('./vendor/vitrio/vitrio.esm.js').then(({default:LiquidGlass})=>{
      // The packaged app shows a start-up shell first, so surfaces may appear later: attach
      // each one when it exists, checking for up to a minute.
      const pending=new Map(surfaces);let tries=0;
      const attach=()=>{
        const scene=document.querySelector('.glass-scene');
        if(!live||!scene)return;
        for(const [selector,params] of [...pending]){
          const anchor=document.querySelector(selector);
          if(!anchor)continue;
          lenses.push(new LiquidGlass({background:scene,attachTo:anchor,draggable:false,zIndex:6,liteMotion:'auto',tint:0,...params}));
          // Tag this lens's layers so each surface gets its own rim mask (the newest are last).
          const name=selector.slice(1);
          for(const layer of ['.lqg-lens','.lqg-glass']){const all=document.querySelectorAll<HTMLElement>(layer);all[all.length-1]?.setAttribute('data-surface',name);}
          pending.delete(selector);
        }
        if(pending.size&&++tries<120)timer=setTimeout(attach,500);
      };
      attach();
    }).catch(()=>{/* glass is decorative; the app works without it */});
    return()=>{live=false;if(timer)clearTimeout(timer);lenses.forEach(lens=>lens.destroy());};
  },[mode]);
  return <div className="glass-scene" aria-hidden="true"><span className="glass-light one"/><span className="glass-light two"/><span className="glass-light three"/><span className="glass-streaks"/></div>;
}
