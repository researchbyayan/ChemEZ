import type {Block,Message} from './types';

type Mode='concise'|'balanced'|'mechanism';

// "Ethanol" reads as "ethanol" mid-sentence; names like "SN2" or "DMSO" keep their case.
const plain=(name:string)=>/^[A-Z][a-z]+$/.test(name)?name.toLowerCase():name;

// The compound the conversation is about: the last one ChemEZ drew.
export function topic(messages:Message[]){
  for(const message of [...messages].reverse()){
    if(message.role!=='assistant'||!Array.isArray(message.content))continue;
    for(const block of [...message.content as Block[]].reverse()){
      if(block.type==='reaction'&&block.caption)return 'this reaction';
      if(block.type==='molecule'&&block.label)return plain(block.label);
      if(block.type==='resonance'&&block.contributors[0]?.label&&!/^contributor/i.test(block.contributors[0].label))return plain(block.contributors[0].label);
    }
  }
  return '';
}

const BY_MODE:Record<Mode,(t:string)=>string>={
  concise:t=>`What is ${t} used for?`,
  balanced:t=>`Why does ${t} behave the way it does?`,
  mechanism:t=>`Show the mechanism of a typical reaction of ${t}`,
};
const BY_COMMAND:Record<string,(t:string)=>string>={
  versus:t=>`${t} vs a close relative`,
  stepbystep:t=>`Calculate the moles in 10 g of ${t}`,
  synthesis:t=>`Make ${t} from a simple starting material`,
  practice:t=>`A question on ${t}`,
  nomenclature:t=>`Name ${t} and explain each part`,
  lab:t=>`Prepare ${t} in the lab`,
  calc:t=>`Molar mass of ${t}`,
  spectra:t=>`${t}`,
};

// The faded suggestion in the composer follows the chosen mode or command, using the
// compound in context. Explain keeps the model's own follow-up when it proposed one.
export function composerSuggestion(messages:Message[],mode:Mode,command:string){
  const last=messages[messages.length-1];
  const proposed=last?.role==='assistant'?cleanSuggestion(last.follow_ups?.[0]):undefined;
  const subject=topic(messages);
  if(command)return subject?BY_COMMAND[command.replace('/','')]?.(subject):undefined;
  if(mode==='balanced'&&proposed)return proposed;
  return subject?BY_MODE[mode](subject):proposed;
}


export function cleanSuggestion(value:unknown):string|undefined{
  if(typeof value!=='string')return;
  let text=value.trim();
  if(/^["{\[]/.test(text)){
    try{
      const decoded:unknown=JSON.parse(text);
      if(typeof decoded==='string')text=decoded.trim();
      else if(decoded&&typeof decoded==='object'&&!Array.isArray(decoded)&&Object.keys(decoded).join()==='question'&&typeof (decoded as {question:unknown}).question==='string')text=(decoded as {question:string}).question.trim();
      else return;
    }catch{return;}
  }
  text=text.replace(/^['"]|['"]$/g,'').replace(/^\/\w+\s*/,'');
  if(text.length<6||text.length>140||text.split(/\s+/).length>24||/[{}<>`$\\\n\r]/.test(text)||text.startsWith('['))return;
  return text;
}
