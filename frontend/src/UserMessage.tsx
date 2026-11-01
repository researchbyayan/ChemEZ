import {useState} from 'react';
import {COMMAND_NAMES} from './commands';
import type {ImageAttachment,Message,UserContent} from './types';

// A follow-up carries the quoted answer for the model; people see it as a one-line quote.
// Quoted answers are shown as plain text: markdown markers, links and math delimiters are dropped.
export function plainQuote(text:string){
  return text.replace(/\bS\\?_\{?N\}?(1|2|Ar|i)\b/g,'SN$1').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\\ce\{([^}]*)\}/g,'$1').replace(/\$+/g,'').replace(/(\*\*|__|\*|`+|~~)/g,'').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g,'$1$2').replace(/^\s*(#{1,6}|>|[-+]|\d+\.)\s+/gm,'').replace(/\s+/g,' ').trim();
}

export function splitReply(full:string){
  const reply=/^(\/\w+\s+)?Replying to the earlier message "([\s\S]*?)":\n/.exec(full);
  return reply?{quote:plainQuote(reply[2]),fullQuote:reply[2],text:(reply[1]||'')+full.slice(reply[0].length)}:{quote:'',fullQuote:'',text:full};
}

export function UserMessage({message,busy,onEdit,onPreview}:{message:Message;busy:boolean;onEdit:()=>void;onPreview:(image:ImageAttachment)=>void}){
  const raw:UserContent=typeof message.content==='string'?{text:message.content,images:[]}:message.content as UserContent;
  const {quote,text}=splitReply(raw.text);
  const content:UserContent=quote?{...raw,text}:raw;
  const [copied,setCopied]=useState(false);
  const copy=()=>void navigator.clipboard.writeText(content.text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1600);}).catch(()=>{});
  return <div className="user-content">
    {quote&&<div className="user-reply-quote" title={quote}><small><i className="fas fa-reply" aria-hidden="true"/>Follow-up to</small><span>{quote}</span></div>}
    {!!content.images?.length&&<div className="user-images">{content.images.map((image,index)=><button className="image-preview-trigger" key={index} aria-label={`Preview image ${index+1}`} onClick={()=>onPreview(image)}><img src={image.dataUrl||`data:${image.mime};base64,${image.data}`} alt={`Attached image ${index+1}`}/></button>)}</div>}
    {content.text&&(()=>{const command=content.command===null?null:content.text.match(/^\/(versus|stepbystep|synthesis|practice|nomenclature|lab|calc|spectra)\s+/);return <p className="user-text">{command&&<span className="slash-chip">{COMMAND_NAMES['/'+command[1]]}</span>}{command?content.text.slice(command[0].length):content.text}</p>;})()}
    <div className="question-actions"><button className="reuse-question" aria-label="Copy question" title={copied?'Copied':'Copy question'} onClick={copy}><i className={copied?'fas fa-check':'far fa-copy'} aria-hidden="true"/></button><button className="reuse-question" aria-label="Edit this question" title="Edit and send again" disabled={busy} onClick={onEdit}><i className="fas fa-pen" aria-hidden="true"/></button></div>
  </div>;
}
