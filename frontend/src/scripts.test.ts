import {describe,it,expect} from 'vitest';
import {chemScripts} from './scripts';
describe('plain-text sub and superscripts',()=>{
  it('turns mechanism names, formulas and charges into math',()=>{
    expect(chemScripts('a typical S_N2 reaction')).toBe('a typical $\\mathrm{S_{N}}$2 reaction');
    expect(chemScripts('S\\_N1 and H_2O')).toBe('$\\mathrm{S_{N}}$1 and $\\mathrm{H_{2}}$O');
    expect(chemScripts('the Br^- ion and Fe^{3+}')).toBe('the $\\mathrm{Br^{-}}$ ion and $\\mathrm{Fe^{3+}}$');
  });
  it('joins mechanism names however they were spelled',()=>{
    for(const text of ['S N2','S$_N$2','S_{N}2','S_N2'])expect(chemScripts(text)).toBe('$\\mathrm{S_{N}}$2');
  });
  it('leaves code, existing math and ordinary words alone',()=>{
    for(const text of ['`snake_case`','$S_N2$','file_name and x_value','see section 2^nd'])expect(chemScripts(text)).toBe(text);
  });
});
