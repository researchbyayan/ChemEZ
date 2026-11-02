import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AnswerBlock} from './Blocks';
import type {Block} from './types';
const step=(label:string)=>({smiles:'C',label,svg:null,limitation:'',arrows:[]});
const render=(block:unknown)=>renderToStaticMarkup(createElement(AnswerBlock,{block:block as Block,onChoice:()=>{}}));
describe('mechanism family badge',()=>{
  it('names the reaction type beside the heading, with SN subscripts',()=>{
    const html=render({type:'mechanism',family:'SN2',steps:[step('a'),step('b')]});
    expect(html).toContain('mechanism-family');expect(html).toContain('S<sub>N</sub>2');
  });
  it('shows no badge when the family is unknown',()=>{
    expect(render({type:'mechanism',steps:[step('a'),step('b')]})).not.toContain('mechanism-family');
  });
});

it('uses chlorine as the caption and formats its separate molecular formula',()=>{
 const html=render({id:'cl',type:'molecule',smiles:'ClCl',label:'Cl2',formula:'Cl2',iupac_name:'molecular chlorine',svg:'<svg width="100" height="80"/>'});
 expect(html).toContain('Chlorine');expect(html).toContain('Cl<sub>2</sub>');
 expect(html).not.toContain('structure-name">Cl2');
});
