import {it,expect} from 'vitest';
import {markdownTables} from './markdownTables';
import {spectralParts} from './spectralData';
it('recovers collapsed spectral rows without changing their values',()=>{
 const broken='| δ (ppm) | Assignment ||---|---|| 165 | CO₃²⁻ |';
 expect(markdownTables(broken)).toBe('| δ (ppm) | Assignment |\n|---|---|\n| 165 | CO₃²⁻ |');
 expect(markdownTables('| $δ$ | Assignment ||---|---|| 165 | $CO_3^{2-}$ |')).toContain('| $δ$ | Assignment |\n|---|---|\n| 165 | $CO_3^{2-}$ |');
 const parts=spectralParts('¹³C NMR\n'+broken);
 expect(parts.find(part=>part.kind==='¹³C NMR')?.peaks?.[0].position).toBe(165);
});
it('preserves proper tables, empty cells and code',()=>{
 const text='| A | B |\n|---|---|\n| 1 ||\n\n`| a ||---|---||b|`';expect(markdownTables(text)).toBe(text);
});
