import {describe,it,expect} from 'vitest';
import {titleCase} from './titleCase';
describe('header capitalisation',()=>{
  it('capitalises major words and keeps chemistry intact',()=>{
    expect(titleCase('room temperature')).toBe('Room Temperature');
    expect(titleCase('Benzene + HCl → no reaction')).toBe('Benzene + HCl → No Reaction');
    expect(titleCase('aspirin synthesis: esterification of salicylic acid with acetic anhydride')).toBe('Aspirin Synthesis: Esterification of Salicylic Acid with Acetic Anhydride');
    expect(titleCase('conc. H2SO4, heat, 2 h')).toBe('conc. H2SO4, Heat, 2 h');
    expect(titleCase('SN1 of tert-butyl bromide in water')).toBe('SN1 of tert-butyl Bromide in Water');
  });
});
