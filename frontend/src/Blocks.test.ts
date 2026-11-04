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

it('shows Click Here for both bare URLs and named Markdown links',()=>{
 const html=render({type:'markdown',text:'URL: https://doi.org/10.3945/an.112.002154 and [website](https://researchbyayan.github.io/ChemEZ/).'});
 expect(html.match(/>Click Here<\/a>/g)).toHaveLength(2);
 expect(html).not.toContain('>https://');expect(html).not.toContain('>website</a>');
});

it('renders a collapsed spectral table as a table rather than raw pipes',()=>{
 const html=render({type:'markdown',text:'| δ (ppm) | Assignment ||---|---|| 165 | CO3 |'});
 expect(html).toContain('<table>');expect(html).toContain('<th>');expect(html).toContain('165');expect(html).not.toContain('||---');
});

it('typesets plain reagents in the card font: abbreviations, counts and charges, no KaTeX',()=>{
 const html=render({id:'r',type:'reaction',caption:'Grignard',reactants:[{smiles:'CC(C)=O',label:'Acetone',svg:'<svg/>'}],products:[{smiles:'CC(C)(C)O',label:'tert-Butanol',svg:'<svg/>'}],reagents:'1. Et2O; 2. H3O+',conditions:''});
 const reagents=html.slice(html.indexOf('reaction-reagents'));
 expect(reagents).toContain('Et<sub>2</sub></span>O');expect(reagents).toContain('H<sub>3</sub></span>O<sup>+</sup>');
 expect(reagents.slice(0,400)).not.toContain('katex');
});
