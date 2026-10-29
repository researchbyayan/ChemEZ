import type {Block,Molecule} from './types';
import {displayName,formulaText,plainChem} from './chemText';
const species=(m:Pick<Molecule,'iupac_name'|'label'|'formula'>)=>`${displayName(m.iupac_name||m.label||'Molecule')}${m.formula?` (${formulaText(m.formula)})`:''}`;
export function answerText(blocks:Block[]):string {
  return blocks.map(b=>{
    if(b.type==='markdown'||b.type==='error')return b.text;
    if(b.type==='clarification')return b.question+'\n'+b.options.join('\n');
    if(b.type==='molecule')return species(b);
    if(b.type==='reaction'){
      const conditions=[b.reagents,b.conditions].map(text=>plainChem(text||'').trim()).filter(Boolean).join('; ');
      return [b.caption,`${b.reactants.map(species).join(' + ')} → ${b.products.map(species).join(' + ')}`,conditions&&`Conditions: ${conditions}`].filter(Boolean).join('\n');
    }
    if(b.type==='resonance')return [b.caption||'Resonance structures',b.contributors.map((c,i)=>c.label||`Contributor ${i+1}`).join(' ↔ ')+(b.hybrid?' ≡ '+b.hybrid.label:'')].join('\n');
    return b.steps.map((s,i)=>`${i+1}. ${s.label}\n${s.iupac_name?displayName(s.iupac_name):'IUPAC name unavailable'}${s.formula?' ('+formulaText(s.formula)+')':''}${s.limitation?'\n'+s.limitation:''}`).join('\n\n');
  }).join('\n\n');
}
