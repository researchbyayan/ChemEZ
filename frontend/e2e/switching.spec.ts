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
  await expect(page.locator('.composer-area')).toHaveCSS('opacity','0.15');
  await page.locator('.composer-area').hover();
  await expect(page.locator('.composer-area')).toHaveCSS('opacity','1');
});

test('floating follow-up anchors the nearby answer and clears on chat navigation',async({page})=>{
  await mockChats(page);await page.goto('/');
  await history(page).getByTitle('Ethanol polarity',{exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('switch',{name:'Dock chatbox at bottom'}).click();
  await page.getByRole('button',{name:'Close Settings',exact:true}).click();
  const handle=page.getByRole('button',{name:'Move floating chatbox'});
  const initial=await handle.boundingBox();expect(initial).not.toBeNull();
  await page.mouse.move(initial!.x+initial!.width/2,initial!.y+initial!.height/2);
  await page.mouse.down();await page.mouse.move(initial!.x+initial!.width/2,160,{steps:12});await page.mouse.up();
  await expect.poll(async()=>((await handle.boundingBox())?.y||0)).toBeLessThan(initial!.y-100);
  await page.locator('.composer-area').hover();
  await page.getByRole('button',{name:'Chat tools',exact:true}).click();
  const tools=page.getByRole('menu',{name:'Chat tools'});
  await expect(tools.getByRole('menuitem',{name:/Add image/})).toBeVisible();
  const menuBounds=await tools.boundingBox();expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');await expect(tools).toHaveCount(0);
  const answerBounds=await page.locator('.message.assistant').boundingBox();
  const dragBounds=await handle.boundingBox();
  await page.mouse.move(dragBounds!.x+40,dragBounds!.y+6);await page.mouse.down();
  await page.mouse.move(dragBounds!.x+40,answerBounds!.y,{steps:8});await page.mouse.up();

  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Why is that?');
  await expect(page.locator('.reply-anchor')).toContainText('Ethanol has an O–H bond.');
  await expect(page.locator('.composer-area')).toHaveClass(/composer-reply/);
  await page.screenshot({path:test.info().outputPath('floating-contextual-reply.png')});
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.locator('.message.user').last()).toContainText('Replying to the earlier message "Ethanol has an O–H bond."');
  await expect(page.getByText('First part of the answer.')).toBeVisible();await finish(page);
  await history(page).getByTitle('Benzene resonance',{exact:true}).click();
  await expect(page.locator('.reply-anchor')).toHaveCount(0);
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
  await expect(page.locator('form.composer .reply-anchor')).toContainText('Ethanol has an O–H bond.');
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Tell me more');
  await expect(page.locator('.reply-anchor')).toContainText('Ethanol has an O–H bond.');
  const close=page.getByRole('button',{name:'Clear reply context'});
  await expect(page.getByRole('button',{name:'Reply to this question'})).toHaveCount(0);
  await expect(page.locator('.reply-anchor')).toContainText('Follow-up on:');
  const form=await page.locator('form.composer').boundingBox();
  const rail=await page.locator('.composer-side-controls').boundingBox();
  const upper=await close.boundingBox();const lower=await page.getByRole('button',{name:'Scroll to latest message'}).boundingBox();
  const outlines=await page.locator('form.composer, .side-control-glass').evaluateAll(nodes=>nodes.map(node=>{
    const edge=getComputedStyle(node),highlight=getComputedStyle(node,'::after');
    return {widths:[edge.borderTopWidth,edge.borderRightWidth,edge.borderBottomWidth,edge.borderLeftWidth],highlight:highlight.paddingTop};
  }));
  expect(outlines).toHaveLength(3);
  for(const outline of outlines){expect(outline.widths).toEqual(['1px','1px','1px','1px']);expect(outline.highlight).toBe(outlines[0].highlight);}
  expect(Math.abs(rail!.height-form!.height)).toBeLessThan(3);
  expect(Math.abs(upper!.height-lower!.height)).toBeLessThan(2);
  expect(upper!.y).toBeLessThan(lower!.y);
  expect(rail!.x+rail!.width).toBeLessThan(form!.x);
  await expect(page.locator('form.composer')).toHaveCSS('transform','none');
  await expect.poll(async()=>Math.round((await page.locator('.composer-side-controls').boundingBox())!.width)).toBe(42);
  for(let sample=0;sample<5;sample++){
    const field=await page.locator('form.composer').boundingBox(),controls=await page.locator('.composer-side-controls').boundingBox();
    expect(Math.abs(field!.x-controls!.x-controls!.width-10)).toBeLessThan(2);
    await page.waitForTimeout(45);
  }

  await page.getByRole('textbox',{name:'Chemistry question'}).blur();await page.mouse.move(5,5);
  for(let sample=0;sample<9;sample++){
    const field=await page.locator('form.composer').boundingBox(),arrow=await page.getByRole('button',{name:'Scroll to latest message'}).boundingBox();
    expect(Math.abs(field!.x-arrow!.x-arrow!.width-10)).toBeLessThan(2);
    const shaft=await page.locator('.scroll-arrow').boundingBox();expect(shaft!.height).toBeLessThanOrEqual(31);
    await page.waitForTimeout(55);
  }
  await page.screenshot({path:test.info().outputPath('follow-up-side-controls.png')});
  await close.click();await expect(page.locator('.reply-anchor')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Scroll to latest message'})).toBeAttached();
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
  const field=page.getByRole('textbox',{name:'Chemistry question'}),bounds=await field.boundingBox();
  await page.mouse.move(bounds!.x+90,bounds!.y+12);
  await page.waitForTimeout(70); // Deliberately click while the expansion is in progress.
  await page.mouse.click(bounds!.x+90,bounds!.y+12);
  await page.keyboard.type('Explain this');
  await expect(field).toBeFocused();await expect(field).toHaveValue('Explain this');
});
