import {describe,it,expect} from 'vitest';
import {cleanSuggestion,composerSuggestion} from './suggest';
describe('composer suggestion safety',()=>{
 it('rejects serialized answers, fragments, arrays, markup and long output',()=>{
  for(const value of ['{"blocks":[{"type":"reaction","caption":"Grignard"}]}','{"blocks":[','["What next?"]','<script>bad</script>','```json\n{}\n```','x'.repeat(141),null])expect(cleanSuggestion(value)).toBeUndefined();
 });
 it('keeps natural chemistry questions and supported wrappers',()=>{
  expect(cleanSuggestion('Why is [NH4+] acidic?')).toBe('Why is [NH4+] acidic?');
  expect(cleanSuggestion('"/versus Grignard vs organolithium reagents"')).toBe('Grignard vs organolithium reagents');
  expect(cleanSuggestion('{"question":"Why does acetone react?"}')).toBe('Why does acetone react?');
 });
 it('falls back to the existing topic-based suggestion when a proposed hint is JSON',()=>{
  const messages:any=[{id:'a',role:'assistant',content:[{id:'m',type:'molecule',label:'Acetone'}],follow_ups:['{"blocks":[]}']}];
  expect(composerSuggestion(messages,'balanced','')).toContain('acetone');
 });
});
