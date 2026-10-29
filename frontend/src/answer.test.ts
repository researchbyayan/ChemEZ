import {expect,test} from 'vitest';
import {answerText} from './answer';
test('copy answer preserves the explanation/structure order without SVG markup',()=>{
  expect(answerText([{id:'1',type:'markdown',text:'Before'},{id:'2',type:'molecule',label:'Ethanol',formula:'C2H6O',smiles:'CCO',svg:'<svg/>'},{id:'3',type:'markdown',text:'After'}])).toBe('Before\n\nEthanol (C₂H₆O)\n\nAfter');
});
test('copied reactions use capitalised names, real subscripts and no empty separators',()=>{
  const m=(iupac_name:string,formula:string)=>({iupac_name,formula,label:'',smiles:'C',svg:''});
  expect(answerText([{id:'r',type:'reaction',caption:'Kolbe–Schmitt',reactants:[m('phenol','C6H6O')],products:[m('2-hydroxybenzoic acid','C7H6O3')],reagents:'$\\text{CO}_2$, NaOH',conditions:'',svg:''}]))
    .toBe('Kolbe–Schmitt\nPhenol (C₆H₆O) → 2-Hydroxybenzoic acid (C₇H₆O₃)\nConditions: CO₂, NaOH');
});
