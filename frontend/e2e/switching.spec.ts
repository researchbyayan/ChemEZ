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
      onEvent:(fn:(event:unknown)=>void)=>{listener=fn;return()=>{};},
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
  await page.getByRole('button',{name:'Collapse composer',exact:true}).click();
  const form=page.locator('form.composer');
  await expect.poll(async()=>await form.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(58);
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toHaveValue('Draw ethanol');
  await expect(page.getByRole('button',{name:'Attach chemistry image'})).toBeHidden();
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.getByText('First part of the answer.')).toBeVisible();
  await page.getByRole('button',{name:'Expand composer',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop generation'})).toBeVisible();
  await finish(page);
  await expect(page.getByText('Second part of the answer.')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('font-family',/Lexend/);
  await expect(page.locator('.sidebar .wordmark')).toHaveCSS('font-family',/Lexend/);

});
