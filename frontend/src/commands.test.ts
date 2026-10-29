import {it,expect} from 'vitest';
import {commandQuery,removeCommandQuery} from './commands';
it('finds slash menus mid-sentence and preserves text on both sides',()=>{
 const input='Compare /ve chlorobenzene and bromobenzene',caret=input.indexOf('/ve')+3;
 const query=commandQuery(input,caret)!;
 expect(query.query).toBe('ve');expect(removeCommandQuery(input,query)).toBe('Compare chlorobenzene and bromobenzene');
 expect(commandQuery('Please explain /',16)?.query).toBe('');
 expect(commandQuery('https://example.com/path',24)).toBeUndefined();
 expect(commandQuery('10 mol/L',8)).toBeUndefined();
});
it('detecting text does not select or rewrite a command',()=>{
 const text='/versus benzene vs phenol';const query=commandQuery(text,7)!;
 expect(query).toEqual({start:0,end:7,query:'versus'});expect(text).toBe('/versus benzene vs phenol');
 expect(removeCommandQuery('Tell me /versus next',{start:8,end:15,query:'ve'})).toBe('Tell me next');
});
