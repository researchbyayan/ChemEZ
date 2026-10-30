export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'compatible' | 'ollama';
export interface Config {provider:ProviderName;model:string;endpoint:string;api_key?:string;auth_mode?:'api_key'|'none';fallbacks?:string[]}
export interface ConfigState {vision_config?:Config|null;vision_has_key?:boolean;config:Config|null;has_key:boolean;warning:string;ready?:boolean;image_support?:'supported'|'unsupported'|'unknown';saved_keys?:Partial<Record<string,boolean>>}
export interface Molecule {properties?:[string,string][];source?:{label:string;url:string};interpreted?:string;smiles:string;label:string;formula?:string;iupac_name?:string;name_source?:'local'|'model'|'unavailable';svg:string;svg_changes?:string;atom_charges?:number[];encoding?:{available:boolean;shape?:number[];warning?:string;alphabet?:Record<string,number>;one_hot_indices?:number[]}}
export type Block = {id:string;references?:{title:string;url:string;provenance:string}[]} & (
  | {type:'markdown';text:string}
  | ({type:'molecule'} & Molecule)
  | {type:'reaction';reactants:Molecule[];products:Molecule[];svg:string;caption:string;reagents:string;conditions:string;arrow?:'forward'|'equilibrium'|'retrosynthesis'|'no_reaction'}
  | {type:'mechanism';steps:{arrows_derived?:boolean;completed?:string;bond_changes?:{action:string;label:string;before:number;after:number}[];smiles:string;label:string;svg:string|null;limitation:string;iupac_name?:string;formula?:string;name_source?:string}[]}
  | {type:'resonance';flow_summary?:string;caption:string;contributors:{bond_changes?:{action:string;label:string;before:number;after:number}[];smiles:string;label:string;svg:string;formula?:string;limitation:string;arrows_derived?:boolean}[];hybrid:{svg:string;label:string}|null}
  | {type:'clarification';question:string;options:string[]}
  | {type:'error';text:string}
);
export interface Structure3D {molblock:string|null;force_field:string|null;properties:{formula:string;molar_mass:number;exact_mass:number;logp:number;tpsa:number;h_bond_donors:number;h_bond_acceptors:number;rotatable_bonds:number;rings:number;aromatic_rings:number;stereocentres:number;formal_charge:number;heavy_atoms:number}}
export interface StructureAnalysis {lewis_svg?:string|null;hydrogens_svg?:string|null;lewis_hydrogens_svg?:string|null;groups:{name:string;count:number;atoms:number[];svg:string}[];stereo_svg:string;stereo:string[];inchi:string;inchikey:string}
export interface ImageAttachment {name:string;mime:'image/png';data:string;dataUrl?:string}
export interface UserContent {command?:string|null;text:string;images:ImageAttachment[]}
export interface Message {id:string;role:'user'|'assistant';content:string|UserContent|Block[];response_style?:'balanced'|'concise'|'tutor'|'mechanism';follow_ups?:string[];draft?:string}
export interface Conversation {id:string;title:string;updated:string;pinned?:boolean;archived?:boolean;snippet?:string}
export interface ChatEvent {type:'start'|'status'|'draft'|'block'|'done'|'error'|'finished';text?:string;conversation_id?:string;user_id?:string;message?:string;block?:Block;message_id?:string;follow_ups?:string[]}
export interface SavedDiagram {id:string;conversation_id:string;title:string;block:Block}
export interface Bridge {
  appInfo?():Promise<import('./About').AppInformation>;
  credits?():Promise<{entries:import('./About').Credit[]}>;
  license?(id:string):Promise<string>;
  openCreditSource?(id:string):Promise<unknown>;
  checkUpdates?():Promise<import('./About').UpdateResult>;
  downloadUpdate?():Promise<void>;
  installUpdate?():Promise<void>;
  onUpdate?(callback:(value:import('./UpdateCard').UpdateState)=>void):()=>void;

  appearance():Promise<{reducedTransparency:boolean}>;
  saveText(text:string):Promise<boolean>;
  openLink?(url:string):Promise<boolean>;
  openReference?(url:string):Promise<boolean>;
  signInOpenRouter?():Promise<ConfigState>;
  request(command:'updateConversation',payload:{id:string;title:string;pinned:boolean;archived?:boolean}):Promise<{ok:boolean}>;
  request(command:'searchConversations',query:string):Promise<Conversation[]>;
  request(command:'listDiagrams'):Promise<SavedDiagram[]>;
  request(command:'structure3d',payload:{smiles:string}):Promise<Structure3D>;
  request(command:'analyseStructure',payload:{smiles:string}):Promise<StructureAnalysis>;
  request(command:'suggestQuestion',payload:{id:string;mode:'concise'|'balanced'|'mechanism';command?:string}):Promise<{question:string}>;
  request(command:'rewindConversation',payload:{id:string;before_message_id:string}):Promise<{id:string;messages:Message[]}>;
  windowAction(action:'minimize'|'toggle-maximize'|'close'|'repaint'):Promise<boolean>;
  pickImage():Promise<ImageAttachment|null>;
  request(command:'loadModels',payload:{credential_slot?:'chat'|'vision';api_key?:string;provider?:'gemini'|'ollama'|'compatible'|'openai'|'anthropic';endpoint?:string;auth_mode?:'api_key'|'none'}):Promise<{models:{id:string;label:string;free_tier?:boolean}[]}>;
  request(command:'getConfig'):Promise<ConfigState>;
  request(command:'saveConfig'|'saveVisionConfig',payload:Config):Promise<ConfigState>;
  request(command:'saveVisionConfig',payload:Config):Promise<ConfigState>;
  request(command:'deleteVisionConfig'):Promise<ConfigState>;
  request(command:'testVisionConnection'):Promise<{ok:boolean}>;
  request(command:'deleteKey'|'deleteVisionConfig'):Promise<ConfigState>;
  request(command:'testConnection'|'testVisionConnection'):Promise<{ok:boolean}>;
  request(command:'listConversations'):Promise<Conversation[]>;
  request(command:'getConversation',id:string):Promise<{id:string;messages:Message[]}>;
  request(command:'deleteConversation',id:string):Promise<{ok:boolean}>;
  chat(payload:{command?:string|null;text:string;images:ImageAttachment[];conversation_id:string|null;response_style?:'balanced'|'concise'|'mechanism';level?:'school'|'undergraduate'|'graduate'}):Promise<void>;
  cancel():Promise<void>;
  saveImage(payload:{format:'svg'|'png';data:string}):Promise<boolean>;
  onEvent(callback:(event:ChatEvent)=>void):()=>void;
  onBackdrop?(callback:(value:'light'|'dark')=>void):()=>void;
}
declare global {interface Window {chemez:Bridge} const __APP_VERSION__:string}
