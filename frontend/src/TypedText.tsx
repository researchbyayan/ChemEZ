import {useEffect,useState} from 'react';
import {Markdown} from './Blocks';

// The answer's words type out while ChemEZ chooses and draws its diagram.
// With Reduce Motion on, the text appears at once.
const STEP=6,TICK=16;
export function TypedText({text}:{text:string}){
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown,setShown]=useState(reduced?text.length:0);
  useEffect(()=>{
    if(shown>=text.length)return;
    const timer=setTimeout(()=>setShown(value=>Math.min(text.length,value+STEP)),TICK);
    return()=>clearTimeout(timer);
  },[shown,text]);
  return <div className="typed-text"><span className="sr-only">{text}</span><div aria-hidden="true"><Markdown text={text.slice(0,shown)}/></div></div>;
}
