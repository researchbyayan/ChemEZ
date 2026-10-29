import {describe,it,expect} from 'vitest';
import {collectReferences} from './References';
describe('answer references',()=>{
  it('collects nested lookup and model sources, deduplicates and rejects executable links',()=>{
    const sources=collectReferences([{source:{label:'PubChem',url:'https://pubchem.ncbi.nlm.nih.gov/compound/1'},reactants:[{source:{label:'PubChem',url:'https://pubchem.ncbi.nlm.nih.gov/compound/1'}}],references:[{title:'Book',url:'https://example.org/book',provenance:'model'},{title:'Bad',url:'javascript:alert(1)'}]}]);
    expect(sources).toHaveLength(2);
    expect(sources[0].provenance).toBe('Compound lookup source');
    expect(sources[1].provenance).toContain('not retrieved');
  });
  it('lists a named book without a link',()=>expect(collectReferences([{references:[{title:'Guyton & Hall, Chapter 64',provenance:'model'}]}])).toEqual([{title:'Guyton & Hall, Chapter 64',provenance:'Suggested by model, not retrieved by ChemEZ'}]));
  it('does not invent sources for an answer without references',()=>expect(collectReferences([{type:'markdown',text:'Hello'}])).toEqual([]));
});
