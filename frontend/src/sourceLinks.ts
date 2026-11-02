// Shared URL policy for answer links and recovered references. Never execute model-provided URLs.
export function sourceURL(value:string):string|null{
  try{const url=new URL(value);const host=url.hostname;
    return value.length<=2000&&url.protocol==='https:'&&!url.username&&!url.password&&host.includes('.')&&!/^[\d.:\[\]]+$/.test(host)&&!host.endsWith('.local')&&!host.endsWith('.localhost')?url.href:null;
  }catch{return null;}
}
export function proseLinks(text:string){
  const clean=text.slice(0,60000).replace(/```[\s\S]*?```|`[^`\n]*`/g,'');
  const found=new Map<string,{title:string;url:string}>();
  for(const match of clean.matchAll(/\[([^\]\n]+)\]\((https:\/\/[^\s<>]+?)\)|https:\/\/[^\s<>\[\]]+/g)){
    let raw=(match[2]||match[0]).replace(/[.,;:!?]+$/,'');
    while(raw.endsWith(')')&&(raw.match(/\)/g)?.length||0)>(raw.match(/\(/g)?.length||0))raw=raw.slice(0,-1);
    const url=sourceURL(raw);if(!url)continue;
    const label=match[1]?.replace(/[*_]/g,'').trim();
    found.set(url,{url,title:label&&!/^https?:|^click here$/i.test(label)?label:new URL(url).hostname+(new URL(url).pathname==='/'?'':new URL(url).pathname)});
  }
  return [...found.values()];
}
