import {useEffect,useState} from 'react';

// "Chemistry, ___." types each synonym out, holds it, erases it and types the next.
// With Reduce Motion on, whole words swap in place instead.
const WORDS=['clearer','simpler','visual','intuitive','explained'];
const TYPE=75,ERASE=40,HOLD=1600,PAUSE=250;
export function HeroWord(){
  const [index,setIndex]=useState(0);
  const [length,setLength]=useState(0);
  const [erasing,setErasing]=useState(false);
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const word=WORDS[index];
  useEffect(()=>{
    if(reduced){const timer=setTimeout(()=>setIndex(value=>(value+1)%WORDS.length),2500);return()=>clearTimeout(timer);}
    let delay=erasing?ERASE:TYPE,next:()=>void;
    if(!erasing&&length<word.length)next=()=>setLength(length+1);
    else if(!erasing){delay=HOLD;next=()=>setErasing(true);}
    else if(length>0)next=()=>setLength(length-1);
    else{delay=PAUSE;next=()=>{setErasing(false);setIndex((index+1)%WORDS.length);};}
    const timer=setTimeout(next,delay);
    return()=>clearTimeout(timer);
  },[index,length,erasing,reduced,word]);
  const shown=reduced?word:word.slice(0,length);
  return <span className="hero-word" aria-live="off"><span className="sr-only">{word}.</span><span className="hero-word-inner" aria-hidden="true">{shown}{!reduced&&length===word.length&&!erasing?'.':''}</span><span className="hero-caret" aria-hidden="true"/></span>;
}
