import {useState} from 'react';

export function applyDiagramPreferences(){
  const layout=localStorage.getItem('chemez-diagram-layout')==='scroll'?'scroll':'wrap';
  const stored=localStorage.getItem('chemez-diagram-size');
  const size=stored==='compact'||stored==='large'?stored:'standard';
  document.documentElement.dataset.diagramLayout=layout;
  document.documentElement.style.setProperty('--molecule-width',({compact:170,standard:230,large:310}[size])+'px');
  document.documentElement.style.setProperty('--structure-scale',String({compact:0.8,standard:1,large:1.3}[size]));
  return {layout,size};
}
export function DiagramPreferences({inline=false}:{inline?:boolean}){
  const [preferences,setPreferences]=useState(applyDiagramPreferences);
  function update(key:'layout'|'size',value:string){localStorage.setItem('chemez-diagram-'+key,value);setPreferences(applyDiagramPreferences());}
  const fields=<><label>Reaction and structure layout<select aria-label="Diagram layout" value={preferences.layout} onChange={event=>update('layout',event.target.value)}><option value="wrap">Wrap onto the next line</option><option value="scroll">Scroll horizontally</option></select></label><label>Structure size<select aria-label="Structure size" value={preferences.size} onChange={event=>update('size',event.target.value)}><option value="compact">Compact</option><option value="standard">Standard</option><option value="large">Large</option></select></label><p className="field-help">Applies to saved and new answers. PNG downloads keep their full resolution.</p></>;
  return inline?<div className="diagram-preferences inline">{fields}</div>:<details className="diagram-preferences"><summary>Diagram display</summary>{fields}</details>;
}
