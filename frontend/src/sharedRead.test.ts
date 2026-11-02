import {it,expect,vi} from 'vitest';
import {sharedRead} from './sharedRead';
it('coalesces concurrent reads but reads fresh after completion',async()=>{
 let release!:(value:number)=>void;
 const read=vi.fn(()=>new Promise<number>(resolve=>{release=resolve;}));
 const first=sharedRead('test:read',read),second=sharedRead('test:read',read);
 expect(first).toBe(second);await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);
 release(1);expect(await first).toBe(1);
 const again=vi.fn(async()=>2);expect(await sharedRead('test:read',again)).toBe(2);expect(again).toHaveBeenCalledTimes(1);
});
it('evicts failures and does not combine different reads',async()=>{
 await expect(sharedRead('test:error',async()=>{throw new Error('offline');})).rejects.toThrow('offline');
 expect(await sharedRead('test:error',async()=>3)).toBe(3);
 expect(await sharedRead('test:other',async()=>4)).toBe(4);
});
