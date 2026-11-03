// Recover tables whose row newlines were omitted, but only with an explicit separator row.
// Ordinary prose pipes, code and already well-formed tables are left alone.
export function markdownTables(text:string){
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part,index)=>index%2?part:part.split('\n').map(line=>{
    if(!/^\s*\|/.test(line)||! /\|\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|)+/.test(line))return line;
    return line.replace(/\|[ \t]*\|/g,'|\n|');
  }).join('\n')).join('');
}
