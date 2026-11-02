import {useEffect,useRef,useState,type RefObject} from 'react';

// The chat's scrollbar is also its jump-to-latest control: when newer content is below, the thumb
// carries a double chevron. Click the chevrons, double-click the thumb or flick it down to snap to
// the latest message.
export function ChatScrollbar({target,onLatest}:{target:RefObject<HTMLDivElement|null>;onLatest:()=>void}){
  const track=useRef<HTMLDivElement>(null);
  const [thumb,setThumb]=useState({top:0,height:0,scrollable:false});
  const [box,setBox]=useState({top:0,height:0});
  // Measured here, not from scroll events, so a long chat opened at its top shows the cap too.
  const [atLatest,setAtLatest]=useState(true);
  const drag=useRef<{y:number;top:number;lastY:number;lastT:number;speed:number}|null>(null);
  // The bar rests hidden; scrolling, a pointer near it or dragging brings it back for a moment.
  const [awake,setAwake]=useState(false);
  const sleep=useRef(0);
  const wake=()=>{setAwake(true);clearTimeout(sleep.current);sleep.current=window.setTimeout(()=>{if(!drag.current)setAwake(false);},1200);};
  const bar=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=target.current;if(!element)return;
    const near=(event:PointerEvent)=>{const box=bar.current?.getBoundingClientRect();if(box&&event.clientX>box.left-40&&event.clientY>box.top&&event.clientY<box.bottom)wake();};
    element.addEventListener('scroll',wake,{passive:true});window.addEventListener('pointermove',near,{passive:true});
    return()=>{element.removeEventListener('scroll',wake);window.removeEventListener('pointermove',near);clearTimeout(sleep.current);};
  },[target]);
  useEffect(()=>{
    const element=target.current;if(!element)return;
    let frame=0;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const room=track.current?.clientHeight||0,{scrollTop,scrollHeight,clientHeight}=element;
      const scrollable=scrollHeight>clientHeight+1;
      // The thumb is drawn at 80% of its proportional length, so it reads as a handle rather than a slab.
      const height=scrollable?Math.max(16,0.8*room*clientHeight/scrollHeight-12):room;
      const top=scrollable?(room-height)*scrollTop/(scrollHeight-clientHeight):0;
      setThumb(previous=>previous.top===top&&previous.height===height&&previous.scrollable===scrollable?previous:{top,height,scrollable});
      setAtLatest(scrollHeight-scrollTop-clientHeight<100);
      // The bar spans exactly the scrolling area, whatever sits below it.
      const nextBox={top:element.offsetTop+10,height:Math.max(0,clientHeight-20)};
      setBox(previous=>previous.top===nextBox.top&&previous.height===nextBox.height?previous:nextBox);
    });};
    measure();
    element.addEventListener('scroll',measure,{passive:true});
    const resize=new ResizeObserver(measure);resize.observe(element);
    for(const child of Array.from(element.children))resize.observe(child);
    const mutations=new MutationObserver(measure);mutations.observe(element,{childList:true,subtree:true,characterData:true});
    return()=>{cancelAnimationFrame(frame);element.removeEventListener('scroll',measure);resize.disconnect();mutations.disconnect();};
  },[target]);
  const moveTo=(top:number)=>{
    const element=target.current,room=track.current?.clientHeight||0;if(!element||room<=thumb.height)return;
    element.scrollTop=Math.max(0,Math.min(1,top/(room-thumb.height)))*(element.scrollHeight-element.clientHeight);
  };
  return <div ref={bar} className={'chat-scrollbar'+(thumb.scrollable?'':' idle')+(atLatest?'':' has-more')+(awake?' awake':'')} aria-hidden={!thumb.scrollable} style={{top:box.top,height:box.height}}>
    <div ref={track} className="chat-scrollbar-track" onPointerDown={event=>{if(event.target!==event.currentTarget)return;const box=event.currentTarget.getBoundingClientRect();moveTo(event.clientY-box.top-thumb.height/2);}}>
      <div className="chat-scrollbar-thumb" style={{top:thumb.top,height:thumb.height}}
        onDoubleClick={()=>{if(!atLatest)onLatest();}}
        onPointerDown={event=>{if((event.target as HTMLElement).closest('.chat-scrollbar-latest'))return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={y:event.clientY,top:thumb.top,lastY:event.clientY,lastT:event.timeStamp,speed:0};}}
        onPointerMove={event=>{const d=drag.current;if(!d)return;const dt=Math.max(1,event.timeStamp-d.lastT);d.speed=(event.clientY-d.lastY)/dt;d.lastY=event.clientY;d.lastT=event.timeStamp;moveTo(d.top+event.clientY-d.y);}}
        onPointerUp={()=>{const d=drag.current;drag.current=null;wake();if(d&&d.speed>1.2&&!atLatest)onLatest();}} onPointerCancel={()=>{drag.current=null;wake();}}>
        {/* A downward flick (over ~1.2 px/ms) also snaps to the latest message. */}
        <button type="button" className="chat-scrollbar-latest" aria-label="Scroll to latest message" title="Scroll to latest message (or double-click the bar)" tabIndex={atLatest?-1:0} onClick={onLatest}><i className="fas fa-angle-double-down" aria-hidden="true"/></button>
      </div>
    </div>
  </div>;
}
