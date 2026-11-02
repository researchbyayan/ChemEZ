import {Fragment,type ReactNode} from 'react';

// Chemistry's typographic conventions: stereo- and position descriptors and Latin terms are set in
// italics (cis, trans, tert, o-/m-/p-, (R)/(S), (E)/(Z), syn/anti, endo/exo, ipso, in situ, via).
const ITALIC=/(\b(?:cis|trans|tert|sec|ortho|meta|para|syn|anti|endo|exo|ipso|in situ|via|vic|gem)\b(?=[-\s,.;:)]|$)|\b[ompn](?=-[A-Za-z0-9])|(?<=\()[RSEZ](?=\)))/g;

export function academic(text:string):ReactNode{
  const parts:ReactNode[]=[];let last=0;
  for(const match of text.matchAll(ITALIC)){
    const at=match.index??0;
    if(at>last)parts.push(text.slice(last,at));
    parts.push(<i key={at} className="chem-italic">{match[0]}</i>);
    last=at+match[0].length;
  }
  if(!parts.length)return text;
  if(last<text.length)parts.push(text.slice(last));
  return <>{parts.map((part,index)=><Fragment key={index}>{part}</Fragment>)}</>;
}
