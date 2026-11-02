import {it,expect} from 'vitest';
import {prosePunctuation} from './prosePunctuation';
it('removes literal, escaped and entity em dashes in saved prose',()=>{
 expect(prosePunctuation('A — B &mdash; C &#8212; D &#x2014; E \\u2014 F')).toBe('A, B, C, D, E, F');
});
it('preserves scientific ranges, code, math and source URLs',()=>{
 const text='10–20 `a—b` $a—b$ https://example.org/a—b';expect(prosePunctuation(text)).toBe(text);
});
