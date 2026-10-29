import {useEffect,useRef,type ReactNode} from 'react';

export function Dialog({title,onClose,children,className=''}:{title:string;onClose:()=>void;children:ReactNode;className?:string}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close();},[]);
  return <dialog ref={dialog} className={'utility-dialog '+className} aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();}}}>
    <div className="utility-dialog-header"><h2>{title}</h2><button type="button" className="icon-action" onClick={onClose} aria-label={`Close ${title}`}><i className="fas fa-times" aria-hidden="true"/></button></div>
    {children}
  </dialog>;
}
