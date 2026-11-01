import {describe,it,expect} from 'vitest';
import {plainQuote} from './UserMessage';
describe('follow-up quotes',()=>{
  it('show answers as plain text',()=>{
    expect(plainQuote('There are **20 standard amino acids** in `code`, see [PubChem](https://x.org).\n\n## Notes\n- $\\ce{H2O}$ is _water_'))
      .toBe('There are 20 standard amino acids in code, see PubChem. Notes H2O is water');
  });
});
