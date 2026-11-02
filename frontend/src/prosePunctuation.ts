// Apply the prose rule to saved answers too, without altering code, math or link targets.
export function prosePunctuation(text:string){
  return text.split(/(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|https:\/\/[^\s<>]+)/g).map((part,index)=>index%2?part:part.replace(/\s*(?:—|&mdash;|&#0*8212;|&#x0*2014;|\\u2014)\s*/gi,', ')).join('');
}
