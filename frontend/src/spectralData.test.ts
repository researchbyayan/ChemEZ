import {describe,it,expect} from 'vitest';
import {spectralParts} from './spectralData';
describe('spectral peak tables',()=>{
 it('plots each supported spectrum without inventing intensities',()=>{
  const text=['**IR**','| cm⁻¹ | Assignment |','|---|---|','| 3200–3600 | O–H |','**¹H NMR**','| δ ppm | H |','|---|---|','| 1.2 | 3 |','**¹³C NMR**','| δ ppm | Assignment |','|---|---|','| 58 | CH2 |','**MS**','| m/z | Ion |','|---|---|','| 46 | M+ |'].join('\n');
  const graphs=spectralParts(text).filter(p=>p.kind);
  expect(graphs.map(p=>p.kind)).toEqual(['IR','¹H NMR','¹³C NMR','MS']);
  expect(graphs[0].peaks?.[0].position).toBe(3400);
  expect(graphs[3].peaks).toEqual([{position:46,label:'M+'}]);
 });
 it('does not plot unrelated tables and handles missing or invalid peaks',()=>{
  expect(spectralParts('| mass | value |\n|---|---|\n| 12 | g |').some(p=>p.kind)).toBe(false);
  const parts=spectralParts('**¹H NMR**\n| δ | assignment |\n|---|---|\n| 999 | invalid |\n| ? | unknown |');
  expect(parts.find(p=>p.kind)?.peaks).toEqual([]);
 });
});

import {lineShape} from './spectralData';
it('broadens peaks with a reproducible bounded algorithm',()=>{
 const curve=lineShape('¹H NMR',[{position:1.2,label:'CH3'}],0,12);
 expect(curve).toHaveLength(720);
 expect(Math.max(...curve.map(p=>p.value))).toBeCloseTo(1);
 expect(curve.reduce((a,b)=>a.value>b.value?a:b).position).toBeCloseTo(1.2,1);
 expect(lineShape('MS',[{position:46,label:'M+'}],0,100)).toEqual([]);
});
it('preserves a supplied intensity column rather than assigning equal heights',()=>{
 const graph=spectralParts('**MS isotope envelope (calculated)**\n| m/z | Relative intensity (%) | Assignment |\n|---|---|---|\n| 70 | 100 | M |\n| 72 | 64 | M+2 |').find(p=>p.kind);
 expect(graph?.peaks?.map(p=>p.intensity)).toEqual([100,64]);
});

import {irBand} from './spectralData';
describe('IR band shapes',()=>{
  it('reads strength and width tags, else the bond type',()=>{
    expect(irBand(3300,'O–H stretch · s, broad')).toEqual({strength:.85,width:150});
    expect(irBand(1715,'C=O stretch · s')).toMatchObject({strength:.85,width:11});
    expect(irBand(3019,'C–H stretch · w')).toMatchObject({strength:.25});
    expect(irBand(757,'C–Cl stretch').strength).toBeGreaterThan(irBand(3019,'C–H stretch').strength);
  });
});
