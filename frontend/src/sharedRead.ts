// Coalesce only simultaneous read requests; never cache results or share mutations/streams.
const pendingReads=new Map<string,Promise<unknown>>();
export function sharedRead<T>(key:string,read:()=>Promise<T>):Promise<T>{
  const existing=pendingReads.get(key);if(existing)return existing as Promise<T>;
  const pending=Promise.resolve().then(read).finally(()=>{if(pendingReads.get(key)===pending)pendingReads.delete(key);});
  pendingReads.set(key,pending);return pending;
}
