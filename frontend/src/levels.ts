export type Level='school'|'undergraduate'|'graduate';
export const LEVELS:Record<Level,{label:string;short:string;icon:string;blurb:string}>={
  school:{label:'High school',short:'High school',icon:'fas fa-school',blurb:'Plain language with every term defined. Still the full chemistry and drawings.'},
  undergraduate:{label:'University',short:'University',icon:'fas fa-flask',blurb:'Standard textbook terms, full mechanisms, selectivity and common pitfalls.'},
  graduate:{label:'Graduate / professional',short:'Graduate',icon:'fas fa-atom',blurb:'Technical and concise: mechanism, kinetics vs thermodynamics, practical detail.'},
};
const KEY='chemez-level';
export function storedLevel():Level|null{
  try{const value=localStorage.getItem(KEY);return value==='school'||value==='undergraduate'||value==='graduate'?value:null;}catch{return null;}
}
export function saveLevel(level:Level){try{localStorage.setItem(KEY,level);}catch{/* the choice still applies this session */}}
