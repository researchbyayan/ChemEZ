import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement,Fragment} from 'react';
import {academic} from './italics';
const html=(t:string)=>renderToStaticMarkup(createElement(Fragment,null,academic(t)));
describe('chemistry italics',()=>{
  it('italicises descriptors and Latin terms',()=>{
    expect(html('tert-butyl bromide')).toContain('<i class="chem-italic">tert</i>-butyl');
    expect(html('p-nitrophenol and (R)-limonene')).toContain('<i class="chem-italic">p</i>-nitrophenol');
    expect(html('(R)-limonene')).toContain('(<i class="chem-italic">R</i>)');
    expect(html('anti addition via a bromonium ion')).toContain('<i class="chem-italic">anti</i> addition <i class="chem-italic">via</i>');
  });
  it('leaves ordinary words alone',()=>{
    for(const t of ['Metathesis','parameters','Synthesis of aspirin','Transfer of a proton','esterification'])expect(html(t)).toBe(t);
  });
});
