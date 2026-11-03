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

describe('plain formulas in prose',()=>{
  it('typesets real formulas with mhchem',()=>{
    expect(chemScripts('an alkyl halide (e.g., CH₃Cl) and AlCl₃.')).toBe('an alkyl halide (e.g., $\\ce{CH3Cl}$) and $\\ce{AlCl3}$.');
    expect(chemScripts('With only HCl, nothing happens')).toBe('With only $\\ce{HCl}$, nothing happens');
    expect(chemScripts('sulfate SO₄²⁻ ions')).toBe('sulfate $\\ce{SO4^{2-}}$ ions');
    expect(chemScripts('44 | CO₂− |')).toBe('44 | $\\ce{CO2^{-}}$ |');
    expect(chemScripts('the H2O+ ion and NH4+')).toBe('the $\\ce{H2O^{+}}$ ion and $\\ce{NH4^{+}}$');
  });
  it('leaves words, abbreviations and existing math alone',()=>{
    for(const text of ['OK, I see','Use CO and NO carefully? No.','NMR and IR spectra','$\\ce{H2O}$','Benzene does not react'])expect(chemScripts(text)).toBe(text);
  });
});

describe('charges written as plain + or −',()=>{
  it('lifts a trailing sign after a formula into a superscript charge',()=>{
    expect(chemScripts('44 | CO₂− |')).toBe('44 | $\\ce{CO2^{-}}$ |');
    expect(chemScripts('the H2O+ ion and NH4+')).toBe('the $\\ce{H2O^{+}}$ ion and $\\ce{NH4^{+}}$');
  });
  it('leaves molecular-ion notation and hyphenated words alone',()=>{
    for(const text of ['62 (M+)','C=C double bond'])expect(chemScripts(text)).toBe(text);
    expect(chemScripts('a H2O-soluble salt')).toBe('a $\\ce{H2O}$-soluble salt');
  });
});
