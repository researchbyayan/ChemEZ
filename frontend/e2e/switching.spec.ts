import {test,expect,type Page} from '@playwright/test';

// A desktop bridge with several stored chats and an answer that streams slowly, so chats can be
// switched and created while it runs.
async function mockChats(page:Page){
  await page.addInitScript(()=>{
    localStorage.setItem('chemez-level','undergraduate');
    type Chat={id:string;title:string;pinned:boolean;archived:boolean;updated:string;messages:unknown[]};
    const chats=new Map<string,Chat>();
    const add=(id:string,title:string,question:string,answer:string)=>chats.set(id,{id,title,pinned:false,archived:false,updated:'2026-10-29T10:00:00Z',messages:[{id:id+'-u',role:'user',content:{text:question,images:[]}},{id:id+'-a',role:'assistant',content:[{id:'m',type:'markdown',text:answer}]}]});
    add('chat-1','Ethanol polarity','Why is ethanol polar?','Ethanol has an O–H bond.');
    add('chat-2','Benzene resonance','Draw benzene resonance','Benzene has two Kekulé structures.');
    let listener:(event:unknown)=>void=()=>{};let next=3;
    const w=window as unknown as {chemez:unknown;release:()=>void};
    w.chemez={
      request:async(command:string,payload:unknown)=>{
        if(command==='getConfig')return {config:{provider:'openai',model:'m',endpoint:''},has_key:true,ready:true,warning:''};
        if(command==='listConversations')return Array.from(chats.values()).map(({messages,...chat})=>chat).sort((a,b)=>b.updated.localeCompare(a.updated));
        if(command==='getConversation')return {messages:structuredClone(chats.get(payload as string)?.messages||[])};
        if(command==='listDiagrams')return [];
        if(command==='searchConversations')return [];
        return {ok:true};
      },
      onEvent:(fn:(event:unknown)=>void)=>{listener=fn;(window as unknown as {emit:(event:unknown)=>void}).emit=fn;return()=>{};},
      chat:async({text,conversation_id}:{text:string;conversation_id:string|null})=>{
        const id=conversation_id||'chat-'+(next++);
        if(!chats.has(id))chats.set(id,{id,title:text.slice(0,30),pinned:false,archived:false,updated:'2026-10-30T10:00:00Z',messages:[]});
        const chat=chats.get(id)!;chat.updated='2026-10-30T10:00:00Z';
        const user={id:id+'-u'+chat.messages.length,role:'user',content:{text,images:[]}};chat.messages.push(user);
        listener({type:'start',conversation_id:id,user_id:user.id});
        listener({type:'status',message:'Checking chemistry…'});
        listener({type:'block',block:{id:'p1',type:'markdown',text:'First part of the answer.'}});
        await new Promise<void>(resolve=>{w.release=resolve;});
        listener({type:'block',block:{id:'p2',type:'markdown',text:'Second part of the answer.'}});
        const answer={id:id+'-a'+chat.messages.length,role:'assistant',content:[{id:'p1',type:'markdown',text:'First part of the answer.'},{id:'p2',type:'markdown',text:'Second part of the answer.'}]};
        chat.messages.push(answer);
        listener({type:'done',message_id:answer.id});listener({type:'finished'});
      },
      cancel:async()=>{},windowAction:async()=>true,saveText:async()=>true,saveImage:async()=>true,appearance:async()=>({reducedTransparency:false})
    };
  });
}
const history=(page:Page)=>page.getByRole('navigation',{name:'Conversation history'});
const finish=(page:Page)=>page.evaluate(()=>(window as unknown as {release:()=>void}).release());
async function ask(page:Page,text:string){await page.getByRole('textbox').first().fill(text);await page.keyboard.press('Enter');}

test('switching chats while a new chat answers keeps each chat its own',async({page})=>{
  await mockChats(page);await page.goto('/');
  await ask(page,'What is an ester?');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await expect(page.getByText('Ethanol has an O–H bond.')).toBeVisible();
  await expect(page.getByText('First part of the answer.')).toHaveCount(0);
  await expect(page.getByText('Checking chemistry…')).toHaveCount(0);
  // Back to the running chat: the question and the answer so far are there.
  await history(page).getByTitle('What is an ester?',{exact:true}).click();
  await expect(page.locator('.message').getByText('What is an ester?')).toBeVisible();
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await finish(page);
  await expect(page.getByText('Second part of the answer.')).toBeVisible();
});

test('a new chat shows in the history as soon as its answer starts',async({page})=>{
  await mockChats(page);await page.goto('/');
  await ask(page,'What is an ester?');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await expect(history(page).getByTitle('What is an ester?',{exact:true})).toBeVisible();
  await finish(page);
});

test('a new conversation opened mid-answer stays empty and the answer lands in its own chat',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Benzene resonance',{exact:true}).click();
  await ask(page,'And toluene?');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(page.getByText('Checking chemistry…')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Stop',exact:false})).toHaveCount(0);
  await finish(page);
  await expect(page.locator('.message')).toHaveCount(0);
  await history(page).getByTitle('Benzene resonance',{exact:true}).click();
  await expect(page.getByText('Second part of the answer.')).toBeVisible();
  await expect(page.locator('.message').getByText('And toluene?')).toBeVisible();
});

test('a new chat started mid-answer then left shows nothing of the running answer',async({page})=>{
  await mockChats(page);await page.goto('/');
  await ask(page,'What is an ester?');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(page.getByText('First part of the answer.')).toHaveCount(0);
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await finish(page);
  await expect(page.getByText('Second part of the answer.')).toHaveCount(0);
  await expect(page.getByText('Ethanol has an O–H bond.')).toBeVisible();
  await expect(history(page).getByRole('button')).toContainText(['What is an ester?']);
});

test('composer collapses to a slim bar, preserves a draft and still sends with Enter',async({page})=>{
  await mockChats(page);await page.goto('/');
  await expect(page.locator('.hero-word')).toHaveCSS('font-style','italic');
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
  await page.getByRole('heading',{name:'Chemistry, clearer.'}).click();
  await page.mouse.move(5,5);
  const form=page.locator('form.composer');
  await expect.poll(async()=>await form.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(58);
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toHaveValue('Draw ethanol');
  await expect(page.getByRole('button',{name:'Chat tools'})).toBeHidden();
  await page.screenshot({path:test.info().outputPath('composer-compact.png')});
  await page.locator('.composer-area').hover();
  await expect(page.getByRole('button',{name:'Chat tools'})).toBeVisible();
  await expect.poll(()=>form.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(80);
  await page.screenshot({path:test.info().outputPath('composer-expanded.png')});
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await page.locator('.composer-area').hover();
  await expect(page.getByRole('button',{name:'Stop generation'})).toBeVisible();
  await finish(page);
  await expect(page.getByText('Second part of the answer.')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('font-family',/Lexend/);
  await expect(page.locator('.sidebar .wordmark')).toHaveCSS('font-family',/Lexend/);

});


test('streamed answers do not force the reader to the bottom',async({page})=>{
  await mockChats(page);await page.goto('/');await ask(page,'Explain a long mechanism');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  const emit=(text:string)=>page.evaluate(text=>(window as unknown as {emit:(e:unknown)=>void}).emit({type:'block',block:{id:String(text.length),type:'markdown',text}}),text);
  await emit(Array.from({length:90},(_,i)=>`Paragraph ${i}. Electron movement is shown in the mechanism.`).join('\n\n'));
  const scroller=page.locator('.conversation-scroll');
  await scroller.evaluate(el=>{el.scrollTop=0;});
  const before=await scroller.evaluate(el=>el.scrollTop);
  await emit('A new section arrives.\n\n'.repeat(60));
  await expect(page.getByText('A new section arrives.',{exact:false}).first()).toBeAttached();
  await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeLessThanOrEqual(before+2);
  await page.screenshot({path:test.info().outputPath('answer-position-retained.png')});
  await finish(page);
});

test('native fullscreen preference persists and controls the window expand action',async({page})=>{
  await mockChats(page);await page.goto('/');
  await page.evaluate(()=>{const w=window as unknown as {chemez:{windowAction:(a:string)=>Promise<boolean>};windowActions:string[]};w.windowActions=[];w.chemez.windowAction=async action=>{w.windowActions.push(action);return true;};});
  await page.getByRole('button',{name:'Maximize or restore window'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {windowActions:string[]}).windowActions.includes('toggle-maximize'))).toBe(true);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Windowed maximize',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Windowed maximize',exact:true})).toHaveAttribute('aria-checked','false');
  await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.getByRole('button',{name:'Maximize or restore window'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {windowActions:string[]}).windowActions.includes('toggle-fullscreen'))).toBe(true);
  await page.reload();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Windowed maximize',exact:true})).toHaveAttribute('aria-checked','false');
});


test('floating composer and tools are explicit and preserve default docked mode',async({page})=>{
  await mockChats(page);await page.goto('/');
  await expect(page.locator('.composer-area')).not.toHaveClass(/composer-floating/);
  await page.locator('.composer-area').hover();
  await page.getByRole('button',{name:'Chat tools',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:/Add image/})).toBeVisible();
  await expect(page.getByRole('menu',{name:'Chat tools'}).getByRole('menuitem').last()).toContainText('Add image');
  await page.screenshot({path:test.info().outputPath('chat-tools-menu.png')});
  await page.locator('.topbar').click({position:{x:500,y:12}});
  await expect(page.getByRole('menu',{name:'Chat tools'})).toHaveCount(0);
  await page.locator('.composer-area').hover();
  await page.getByRole('button',{name:'Chat tools',exact:true}).click();
  await page.getByRole('menuitem',{name:'/synthesis',exact:false}).click();
  await expect(page.locator('.slash-chip')).toContainText('Synthesis');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Windowed maximize',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();
  await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.mouse.move(5,5);
  await expect(page.locator('.composer-area')).toHaveClass(/composer-floating/);
  // A new conversation keeps its chatbox fully visible; inside a chat the resting box fades.
  await expect(page.locator('.composer-area')).toHaveCSS('opacity','1');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();await page.mouse.move(5,5);
  // Resting in a chat, the floating chatbox folds into a small pill.
  await expect(page.locator('form.composer')).toHaveCSS('opacity','0');
  await expect(page.getByRole('button',{name:'Open message box'})).toBeVisible();
  await page.locator('.composer-area').hover();
  await expect(page.locator('.composer-area')).toHaveCSS('opacity','1');
});

test('floating chatbox stays put, follows up on an answer and clears on chat navigation',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();
  await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  // The floating chatbox stays in place: there is no drag handle.
  await expect(page.getByRole('button',{name:'Move floating chatbox'})).toHaveCount(0);
  await page.locator('.composer-area').hover();
  await page.getByRole('button',{name:'Chat tools',exact:true}).click();
  const tools=page.getByRole('menu',{name:'Chat tools'});
  await expect(tools.getByRole('menuitem',{name:/Add image/})).toBeVisible();
  const menuBounds=await tools.boundingBox();expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');await expect(tools).toHaveCount(0);
  await page.getByRole('button',{name:'Reply to this answer'}).click();

  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Why is that?');
  await expect(page.locator('.composer-context-header')).toContainText('Ethanol has an O–H bond.');
  await expect(page.locator('.composer-area')).toHaveClass(/composer-reply/);
  await page.screenshot({path:test.info().outputPath('floating-contextual-reply.png')});
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.locator('.message.user').last().locator('.user-reply-quote')).toContainText('Ethanol has an O–H bond.');
  await expect(page.getByText('First part of the answer.')).toBeVisible();await finish(page);
  await history(page).getByTitle('Benzene resonance',{exact:true}).click();
  await expect(page.locator('.composer-context-header')).toHaveCount(0);
});

test('disabled send keeps the original arrow while only its circle dims',async({page})=>{
  await mockChats(page);await page.goto('/');await page.locator('.composer-area').hover();
  const send=page.getByRole('button',{name:'Send question',exact:true});
  await expect(send).toBeDisabled();await expect(send.locator('i')).toHaveClass(/fa-arrow-up/);
  const idle=await send.evaluate(el=>({arrow:getComputedStyle(el.querySelector('i')!).color,opacity:getComputedStyle(el).opacity,circle:getComputedStyle(el,'::before').opacity}));
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw benzene');await expect(send).toBeEnabled();
  await expect.poll(()=>send.evaluate(el=>getComputedStyle(el,'::before').opacity)).toBe('1');
  const ready=await send.evaluate(el=>({arrow:getComputedStyle(el.querySelector('i')!).color,opacity:getComputedStyle(el).opacity,circle:getComputedStyle(el,'::before').opacity}));
  expect(idle.arrow).toBe(ready.arrow);expect(idle.opacity).toBe('1');expect(ready.opacity).toBe('1');expect(Number(idle.circle)).toBeLessThan(Number(ready.circle));
});


test('explicit replies keep their anchor and new floating chats return to the welcome layout',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.getByRole('button',{name:'Reply to this answer'}).click();
  await expect(page.locator('.composer-context-header')).toContainText('Ethanol has an O–H bond.');
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Tell me more');
  await expect(page.locator('.composer-context-header')).toContainText('Ethanol has an O–H bond.');
  const close=page.getByRole('button',{name:'Clear reply context'});
  await expect(page.getByRole('button',{name:'Reply to this question'})).toHaveCount(0);
  await expect(page.locator('.composer-context-header')).toContainText('Follow-up on:');
  await page.waitForTimeout(400); // let the chatbox finish expanding before measuring
  const form=await page.locator('form.composer').boundingBox();
  // The follow-up close now sits in the context header.
  await expect(close).toBeVisible();
  await expect(page.locator('form.composer')).toHaveCSS('transform','none');
  // The chatbox has no side tab; jumping to the latest message lives on the scrollbar.
  await expect(page.locator('.composer-side-controls')).toHaveCount(0);
  expect(form).not.toBeNull();

  await page.getByRole('textbox',{name:'Chemistry question'}).blur();await page.mouse.move(5,5);
  await page.screenshot({path:test.info().outputPath('follow-up-side-controls.png')});
  // Resting floating chatbox opens after a one-second hover.
  await page.getByRole('button',{name:'Open message box'}).click();await close.click();await expect(page.locator('.composer-context-header')).toHaveCount(0);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(page.locator('.composer-floating')).toHaveCSS('position','relative');
  await expect(page.getByRole('heading',{name:'Chemistry, clearer.'})).toBeVisible();
});

test('clicking the compact typing area still focuses it during expansion',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.mouse.move(5,5);
  await expect(page.locator('.composer-area')).toHaveClass(/composer-compact/);
  // Resting, the chatbox is a pill; clicking the pill opens it and focuses typing straight away.
  const field=page.getByRole('textbox',{name:'Chemistry question'});
  await page.getByRole('button',{name:'Open message box'}).click();
  await page.keyboard.type('Explain this');
  await expect(field).toBeFocused();await expect(field).toHaveValue('Explain this');
});

test('a question typed at the bottom of a chat is not treated as a follow-up',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('What is an ester?');
  await expect(page.locator('.composer-context-header')).toHaveCount(0);
  await expect(page.locator('.composer-area')).not.toHaveClass(/composer-reply/);
});

test('a sent follow-up shows a one-line quote and edits back to the plain question',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Reply to this answer'}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Is this correct');
  await page.keyboard.press('Enter');
  const bubble=page.locator('.message.user').last();
  await expect(bubble.locator('.user-reply-quote')).toContainText('Ethanol has an O–H bond.');
  await expect(bubble.locator('.user-text')).toHaveText('Is this correct');
  await page.evaluate(()=>(window as unknown as {release:()=>void}).release());
  await bubble.hover();await bubble.getByRole('button',{name:'Edit this question'}).click();
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toHaveValue('Is this correct');
  // While editing, the single context header describes the edit; the follow-up link is kept for sending.
  await expect(page.locator('.composer-context-header')).toContainText('Editing an earlier question');
});

test('the scrollbar rests hidden, wakes near the pointer, and its cap jumps to the latest message',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await expect(page.locator('.chat-scrollbar')).toHaveCSS('opacity','0');
  await page.evaluate(()=>{for(let i=0;i<60;i++){const p=document.createElement('p');p.textContent='filler '+i;document.querySelector('.messages')!.append(p);}});
  // Chats open pinned to their latest message; a wheel releases the pin, then scroll up.
  await page.locator('.conversation-scroll').evaluate(e=>{e.dispatchEvent(new WheelEvent('wheel'));e.scrollTop=0;});
  await expect(page.locator('.chat-scrollbar')).toHaveClass(/has-more/);
  const bar=(await page.locator('.chat-scrollbar').boundingBox())!;await page.mouse.move(bar.x+bar.width/2,bar.y+20);
  await expect(page.locator('.chat-scrollbar')).toHaveCSS('opacity','0.64');
  await page.getByRole('button',{name:'Scroll to latest message'}).click();
  await expect.poll(()=>page.locator('.conversation-scroll').evaluate(e=>Math.round(e.scrollHeight-e.scrollTop-e.clientHeight))).toBeLessThan(2);
  await expect(page.locator('.chat-scrollbar')).not.toHaveClass(/has-more/);
  await page.mouse.move(400,300);await expect(page.locator('.chat-scrollbar')).toHaveCSS('opacity','0',{timeout:4000});
});

test('double-clicking the scrollbar thumb snaps to the latest message',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.evaluate(()=>{for(let i=0;i<60;i++){const p=document.createElement('p');p.textContent='filler '+i;document.querySelector('.messages')!.append(p);}});
  // Chats open pinned to their latest message; a wheel releases the pin, then scroll up.
  await page.locator('.conversation-scroll').evaluate(e=>{e.dispatchEvent(new WheelEvent('wheel'));e.scrollTop=0;});
  await expect(page.locator('.chat-scrollbar')).toHaveClass(/has-more/);
  const thumb=(await page.locator('.chat-scrollbar-thumb').boundingBox())!;
  await page.mouse.dblclick(thumb.x+thumb.width/2,thumb.y+8);
  await expect.poll(()=>page.locator('.conversation-scroll').evaluate(e=>Math.round(e.scrollHeight-e.scrollTop-e.clientHeight))).toBeLessThan(2);
  await page.screenshot({path:test.info().outputPath('scrollbar-thumb.png'),clip:{x:1260,y:60,width:60,height:780}});
});

test('spectra tables always receive local graphs with axes and prediction limits',async({page})=>{
  await mockChats(page);await page.goto('/');await ask(page,'Show ethanol spectra');
  await page.evaluate(()=>{
    const emit=(window as unknown as {emit:(e:unknown)=>void}).emit;
    emit({type:'block',block:{id:'spectra',type:'markdown',text:'**IR**\n\n| cm⁻¹ | Assignment |\n|---|---|\n| 3350 | O–H |\n\n**¹H NMR**\n\n| δ ppm | Assignment |\n|---|---|\n| 1.2 | CH3 |\n| , | no protons |\n\n**¹³C NMR**\n\n| δ ppm | Assignment |\n|---|---|\n| 58 | CH2 |\n\n**MS**\n\n| m/z | Ion |\n|---|---|\n| 46 | M+ |'}});
  });
  await expect(page.locator('.spectrum-figure svg')).toHaveCount(4);
  await expect(page.locator('.spectrum-figure').first()).toContainText('Transmittance (%)');
  await expect(page.locator('.spectrum-figure').first()).toContainText('cm⁻¹');
  // The figure can re-render as the answer settles, so retry until a peak is selected.
  const graph=page.locator('.spectrum-figure svg').first();
  await expect(async()=>{
    if(await graph.getAttribute('tabindex')!=='0')await page.getByRole('button',{name:'Highlight IR peaks',exact:true}).click();
    await expect(graph).toHaveAttribute('tabindex','0',{timeout:1000});await graph.focus();await page.keyboard.press('ArrowRight');
    await expect(page.locator('.spectral-table-selected')).toHaveCount(1,{timeout:1000});
  }).toPass({timeout:10000});
  // The selected band shows through its highlighted table row; no separate list.
  await expect(page.locator('.spectrum-selection')).toHaveCount(0);

  await expect(page.getByRole('cell',{name:'–',exact:true})).toBeVisible();
  const tableFrame=page.locator('.markdown-table-scroll').first();
  await expect(tableFrame).toHaveCSS('border-top-width','1px');await expect(tableFrame).toHaveCSS('border-bottom-width','1px');
  await page.locator('.spectrum-figure').first().scrollIntoViewIfNeeded();
  await page.evaluate(()=>{window.chemez.saveImage=async payload=>{(window as unknown as {savedSpectrum:string}).savedSpectrum=payload.data;return true;};});
  await page.getByRole('button',{name:'Save IR graph as PNG',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {savedSpectrum?:string}).savedSpectrum?.slice(0,8))).toBe('iVBORw0K');
  await page.screenshot({path:test.info().outputPath('spectra-graphs.png')});
  await finish(page);
});

test('reference dialog resolves an inline citation to an openable DOI and copies corrected metadata',async({page})=>{
  await mockChats(page);await page.goto('/');await ask(page,'Give me the apple study reference');
  await page.evaluate(()=>{
    const w=window as unknown as {emit:(e:unknown)=>void;openedSource?:string;copiedSource?:string;chemez:{request:(c:string,p?:unknown)=>Promise<unknown>;openReference:(url:string)=>Promise<boolean>}};
    const request=w.chemez.request;
    w.chemez.request=async(c,p)=>c==='resolveCitation'?{status:'matched',title:'Association Between Apple Consumption and Physician Visits',url:'https://doi.org/10.1001/jamainternmed.2014.5466',citation:'Davis MA et al. JAMA Internal Medicine. 2015;175(5):777–783.',provenance:'Publication metadata matched via Crossref; answer claims are not verified.'}:request(c,p);
    w.chemez.openReference=async url=>{w.openedSource=url;return true;};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{w.copiedSource=text;}}});
    w.emit({type:'block',block:{id:'reference',type:'markdown',text:'An analysis found no difference (Davis et al., “Association Between Apple Consumption and Physician Visits,” JAMA Intern Med 175: 1347–1349).'}});
  });
  await page.getByRole('button',{name:/References \(1\)/}).click();
  const dialog=page.getByRole('dialog',{name:'References',exact:true});
  await expect(dialog).toContainText('777–783');
  await expect(dialog.getByText('Original answer citation',{exact:true})).toHaveCount(0);
  await expect(dialog.locator('.reference-doi')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Open source',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {openedSource:string}).openedSource)).toBe('https://doi.org/10.1001/jamainternmed.2014.5466');
  await dialog.getByRole('button',{name:'Copy citation',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {copiedSource:string}).copiedSource)).toContain('https://doi.org/');
  await page.screenshot({path:test.info().outputPath('resolved-reference-dialog.png')});
  await finish(page);
});


test('brand has no Tab outline and settings focus rings stay inset',async({page})=>{
  await mockChats(page);await page.goto('/');
  await page.keyboard.press('Tab');
  const brand=page.getByRole('link',{name:'ChemEZ home'});await brand.focus();
  await expect(brand).toHaveCSS('outline-style','none');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const general=page.getByRole('button',{name:'General',exact:true});await page.keyboard.press('Tab');await general.focus();
  await expect(general).toHaveCSS('outline-offset','-2px');
  await expect(general).toHaveCSS('animation-name','none');
  expect(await general.evaluate(node=>parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(0);
});

test('one loading status, one submission and one active stream listener under dev StrictMode',async({page})=>{
  await mockChats(page);
  await page.addInitScript(()=>{
    const w=window as unknown as {audit:{reads:Record<string,number>;listeners:number;submissions:number;duplicateStatuses:number};beginAnswer:()=>void;chemez:{request:(command:string,payload?:unknown)=>Promise<unknown>;onEvent:(callback:(event:unknown)=>void)=>()=>void;chat:(payload:unknown)=>Promise<void>}};
    w.audit={reads:{},listeners:0,submissions:0,duplicateStatuses:0};
    const request=w.chemez.request,subscribe=w.chemez.onEvent,chat=w.chemez.chat;
    w.chemez.request=async(command,payload)=>{w.audit.reads[command]=(w.audit.reads[command]||0)+1;return request(command,payload);};
    w.chemez.onEvent=callback=>{w.audit.listeners++;const stop=subscribe(callback);return()=>{w.audit.listeners--;stop();};};
    w.chemez.chat=async payload=>{w.audit.submissions++;await new Promise<void>(resolve=>{w.beginAnswer=resolve;});await chat(payload);};
    const observer=new MutationObserver(()=>{if(document.querySelectorAll('[data-pending-answer=true] [role=status]').length>1)w.audit.duplicateStatuses++;});
    observer.observe(document,{childList:true,subtree:true});
  });
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {audit:{reads:Record<string,number>}}).audit.reads.getConfig)).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {audit:{listeners:number}}).audit.listeners)).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {audit:{reads:Record<string,number>}}).audit.reads.listConversations)).toBe(1);
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Explain ethanol');
  await page.evaluate(()=>{const form=document.querySelector('form.composer') as HTMLFormElement;form.requestSubmit();form.requestSubmit();});
  await expect(page.getByText('Preparing your answer…',{exact:true})).toHaveCount(1);
  await expect(page.locator('[data-pending-answer=true] [role=status]')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as unknown as {audit:{submissions:number}}).audit.submissions)).toBe(1);
  await page.evaluate(()=>(window as unknown as {beginAnswer:()=>void}).beginAnswer());
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await finish(page);await expect(page.getByText('Second part of the answer.')).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {audit:{duplicateStatuses:number}}).audit.duplicateStatuses)).toBe(0);
});

test('existing follow-up hints do not trigger another model request',async({page})=>{
  await mockChats(page);await page.addInitScript(()=>{
    const w=window as unknown as {hintCalls:number;chemez:{request:(command:string,payload?:unknown)=>Promise<any>}};
    const request=w.chemez.request;w.hintCalls=0;
    w.chemez.request=async(command,payload)=>{
      if(command==='suggestQuestion'){w.hintCalls++;return {question:'A new hint for another mode?'};}
      const result=await request(command,payload);
      if(command==='getConversation')for(const message of result.messages)if(message.role==='assistant'){message.response_style='concise';message.follow_ups=['Why does ethanol dissolve in water?'];}
      return result;
    };
  });await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toHaveAttribute('placeholder',/Why does ethanol dissolve in water/);
  expect(await page.evaluate(()=>(window as unknown as {hintCalls:number}).hintCalls)).toBe(0);
});

test('saved chats open at their latest message',async({page})=>{
  await mockChats(page);
  await page.addInitScript(()=>{
    const bridge=window.chemez,original=bridge.request.bind(bridge);
    bridge.request=(async(command:string,payload:unknown)=>{
      if(command==='getConversation')return {messages:Array.from({length:30},(_,i)=>({id:'saved-'+i,role:i%2?'assistant':'user',content:i%2?[{id:'b'+i,type:'markdown',text:'Saved answer '+i}]:{text:'Saved question '+i,images:[]}}))};
      return original(command as 'getConversation',payload as string);
    }) as typeof bridge.request;
  });
  await page.goto('/');await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await expect(page.getByText('Saved answer 29',{exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.conversation-scroll').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(3);
});

test('retry preserves the selected question and original command and mode',async({page})=>{
  await mockChats(page);
  await page.addInitScript(()=>{
    const bridge=window.chemez,original=bridge.request.bind(bridge);
    const messages=[{id:'q1',role:'user',content:{text:'Why is iodine unreactive?',images:[]}},{id:'a1',role:'assistant',content:[{id:'b1',type:'markdown',text:'An earlier chemistry answer.'}]},{id:'q2',role:'user',content:{text:'Does fruit juice help?',command:null,images:[]}},{id:'a2',role:'assistant',response_style:'concise',content:[{id:'b2',type:'markdown',text:'The nutrition answer.'}]}];
    bridge.request=(async(command:string,payload:unknown)=>{
      if(command==='getConversation')return {messages};
      if(command==='rewindConversation'){(window as unknown as {rewind:unknown}).rewind=payload;return {messages:messages.slice(0,2)};}
      return original(command as 'getConversation',payload as string);
    }) as typeof bridge.request;
    bridge.chat=async payload=>{(window as unknown as {retry:unknown}).retry=payload;};
  });
  await page.goto('/');await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Reply to this answer',exact:true}).first().click();
  await page.getByRole('button',{name:'Retry answer',exact:true}).last().click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {retry:unknown}).retry)).toMatchObject({text:'Does fruit juice help?',command:null,response_style:'concise'});
  expect(await page.evaluate(()=>(window as unknown as {rewind:unknown}).rewind)).toEqual({id:'chat-1',before_message_id:'q2'});
});

test('inline HTTPS sources open through the desktop bridge',async({page})=>{
  await mockChats(page);
  await page.addInitScript(()=>{
    const bridge=window.chemez,original=bridge.request.bind(bridge);
    bridge.request=(async(command:string,payload:unknown)=>command==='getConversation'?{messages:[{id:'linked',role:'assistant',content:[{id:'link',type:'markdown',text:'Read the [source](https://example.org/paper).'}]}]}:original(command as 'getConversation',payload as string)) as typeof bridge.request;
    bridge.openReference=async url=>{(window as unknown as {opened:string}).opened=url;return true;};
  });
  await page.goto('/');await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await expect(page.getByRole('button',{name:'References (1)',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Click Here',exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {opened:string}).opened)).toBe('https://example.org/paper');
});

test('editing and follow-up share a tall divided composer and round close button',async({page})=>{
  await mockChats(page);await page.goto('/');await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Reply to this answer',exact:true}).click();
  const context=page.locator('.composer-context');
  await expect(context).toBeVisible();
  await expect(page.locator('.composer-context-header .fa-reply')).toBeVisible();
  const reply=await context.evaluate(el=>({height:el.getBoundingClientRect().height,border:getComputedStyle(el.querySelector('.composer-context-header')!).borderBottomWidth,radius:getComputedStyle(el.querySelector('.context-close')!).borderRadius}));
  const controls=await context.evaluate(el=>{const close=el.querySelector('.context-close')!.getBoundingClientRect(),send=el.querySelector('.send-button')!.getBoundingClientRect();return {closeX:close.x+close.width/2,sendX:send.x+send.width/2,closeWidth:close.width,sendWidth:send.width};});
  expect(controls.closeX).toBeCloseTo(controls.sendX,0);expect(controls.closeWidth).toBe(controls.sendWidth);
  expect(reply.height).toBeGreaterThanOrEqual(180);expect(reply.border).toBe('1px');expect(reply.radius).toBe('50%');
  await page.getByRole('button',{name:'Clear reply context',exact:true}).click();
  await page.getByRole('button',{name:'Edit this question',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cancel editing',exact:true})).toBeVisible();
  await expect(page.locator('.composer-context-header .fa-pen')).toBeVisible();
  expect(await context.evaluate(el=>el.getBoundingClientRect().height)).toBeCloseTo(reply.height,0);
});

test('floating reply pill opens when hovering its visible position',async({page})=>{
  await mockChats(page);await page.addInitScript(()=>localStorage.setItem('chemez-composer-docked','off'));
  await page.goto('/');await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Reply to this answer',exact:true}).click();
  await page.mouse.click(280,100);await page.mouse.move(280,90);
  const area=page.locator('.composer-area');
  await expect(area).toHaveClass(/composer-compact/);
  await expect(area).toHaveClass(/composer-reply/);
  const trigger=page.getByRole('button',{name:'Open message box',exact:true});
  const before=await trigger.boundingBox();
  await trigger.hover();
  const during=await trigger.boundingBox();
  expect(during!.x+during!.width/2).toBeCloseTo(before!.x+before!.width/2,0);
  await expect(area).not.toHaveClass(/composer-compact/,{timeout:3000});
  await expect(page.getByRole('button',{name:'Clear reply context',exact:true})).toBeVisible();
});

test('structure library close button dismisses the panel at wide and narrow sizes',async({page})=>{
  await mockChats(page);await page.goto('/');
  for(const width of [1440,1000]){
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Structure library',exact:true}).click();
    const panel=page.getByRole('complementary',{name:'Structure library',exact:true});
    await expect(panel).toBeVisible();
    const close=page.getByRole('button',{name:'Close structure library',exact:true});
    expect(await close.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
    await close.click();await expect(panel).toHaveCount(0);
  }
});
