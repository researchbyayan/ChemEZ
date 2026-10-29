import {useState} from 'react';
import {COMMAND_NAMES} from './commands';
import type {ImageAttachment,Message,UserContent} from './types';

export function UserMessage({message,busy,onEdit,onPreview}:{message:Message;busy:boolean;onEdit:()=>void;onPreview:(image:ImageAttachment)=>void}){
  const content:UserContent=typeof message.content==='string'?{text:message.content,images:[]}:message.content as UserContent;
  const [copied,setCopied]=useState(false);
  const copy=()=>void navigator.clipboard.writeText(content.text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1600);}).catch(()=>{});
  return <div className="user-content">
    {!!content.images?.length&&<div className="user-images">{content.images.map((image,index)=><button className="image-preview-trigger" key={index} aria-label={`Preview ${image.name}`} onClick={()=>onPreview(image)}><img src={image.dataUrl||`data:${image.mime};base64,${image.data}`} alt={image.name||`Attached image ${index+1}`}/></button>)}</div>}
    {content.text&&(()=>{const command=content.command===null?null:content.text.match(/^\/(versus|stepbystep|synthesis|practice|nomenclature|lab|calc|spectra)\s+/);return <p className="user-text">{command&&<span className="slash-chip">{COMMAND_NAMES['/'+command[1]]}</span>}{command?content.text.slice(command[0].length):content.text}</p>;})()}
    <div className="question-actions"><button className="reuse-question" aria-label="Copy question" title={copied?'Copied':'Copy question'} onClick={copy}><i className={copied?'fas fa-check':'far fa-copy'} aria-hidden="true"/></button><button className="reuse-question" aria-label="Edit this question" title="Edit and send again" disabled={busy} onClick={onEdit}><i className="fas fa-pen" aria-hidden="true"/></button></div>
  </div>;
}
