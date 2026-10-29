import json
import os
import sqlite3
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'chemez.sqlite3')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
        ''')
        if 'pinned' not in {row[1] for row in self.db.execute('PRAGMA table_info(conversations)')}:
            self.db.execute('ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
            self.db.commit()
        if 'archived' not in {row[1] for row in self.db.execute('PRAGMA table_info(conversations)')}:
            self.db.execute('ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
        if 'named' not in {row[1] for row in self.db.execute('PRAGMA table_info(conversations)')}:
            # 1 once the learner renames a chat; automatic titles never replace their name.
            self.db.execute('ALTER TABLE conversations ADD COLUMN named INTEGER NOT NULL DEFAULT 0')
        if 'response_style' not in {row[1] for row in self.db.execute('PRAGMA table_info(messages)')}:
            self.db.execute('ALTER TABLE messages ADD COLUMN response_style TEXT')
        if 'follow_ups' not in {row[1] for row in self.db.execute('PRAGMA table_info(messages)')}:
            self.db.execute('ALTER TABLE messages ADD COLUMN follow_ups TEXT')
        self.db.execute('CREATE TABLE IF NOT EXISTS message_search (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, text TEXT NOT NULL)')
        for mid,cid,content in self.db.execute('SELECT id,conversation_id,content FROM messages WHERE id NOT IN (SELECT id FROM message_search)'):
            self.db.execute('INSERT INTO message_search VALUES (?,?,?)',(mid,cid,self.searchable(json.loads(content))))
        self.db.commit()
    @staticmethod
    def searchable(content):
        if isinstance(content,str):
            return content
        if isinstance(content,list):
            return '\n'.join(Store.searchable(item) for item in content)
        if isinstance(content,dict):
            # Index chemistry and prose, never SVG markup or image base64.
            return '\n'.join(Store.searchable(value) for key,value in content.items() if key in {'text','label','smiles','caption','question','reagents','conditions','steps','reactants','products'})
        return ''
    def config(self, slot=1):
        row = self.db.execute('SELECT value FROM settings WHERE id=?', (slot,)).fetchone()
        return json.loads(row[0]) if row else None
    def save_config(self, config, slot=1):
        self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (slot,json.dumps(config)))
        self.db.commit()
    def create(self, title):
        cid = str(uuid4())
        self.db.execute('INSERT INTO conversations (id,title,updated) VALUES (?,?,?)', (cid, title[:80], self.now()))
        self.db.commit()
        return cid
    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()
    def exists(self, cid):
        return self.db.execute('SELECT 1 FROM conversations WHERE id=?', (cid,)).fetchone() is not None
    def add(self, cid, role, content, response_style=None, follow_ups=None):
        mid = str(uuid4())
        self.db.execute('INSERT INTO messages (id,conversation_id,role,content,created,response_style,follow_ups) VALUES (?,?,?,?,?,?,?)', (mid, cid, role, json.dumps(content), self.now(),response_style,json.dumps(follow_ups) if follow_ups else None))
        self.db.execute('INSERT INTO message_search VALUES (?,?,?)',(mid,cid,self.searchable(content)))
        self.db.execute('UPDATE conversations SET updated=? WHERE id=?', (self.now(), cid))
        self.db.commit()
        return mid
    def messages(self, cid):
        return [dict(id=r[0], role=r[1], content=json.loads(r[2]),**({'response_style':r[3]} if r[3] else {}),**({'follow_ups':json.loads(r[4])} if r[4] else {})) for r in self.db.execute('SELECT id,role,content,response_style,follow_ups FROM messages WHERE conversation_id=? ORDER BY rowid', (cid,))]
    def conversations(self):
        return [dict(id=r[0],title=r[1],updated=r[2],pinned=bool(r[3]),archived=bool(r[4])) for r in self.db.execute('SELECT id,title,updated,pinned,archived FROM conversations ORDER BY pinned DESC,updated DESC')]
    def update_conversation(self, cid, title, pinned, archived=None):
        self.db.execute('UPDATE conversations SET named=1 WHERE id=? AND title!=?', (cid, title))
        self.db.execute('UPDATE conversations SET title=?,pinned=? WHERE id=?', (title, int(pinned), cid))
        if archived is not None:
            self.db.execute('UPDATE conversations SET archived=? WHERE id=?',(int(archived),cid))
        self.db.commit()
    def auto_title(self, cid, title):
        """Set a generated title unless the learner has renamed the chat."""
        self.db.execute('UPDATE conversations SET title=? WHERE id=? AND named=0', (title[:80], cid))
        self.db.commit()
    def questions(self, cid):
        return self.db.execute('SELECT COUNT(*) FROM messages WHERE conversation_id=? AND role=?', (cid,'user')).fetchone()[0]
    def search(self, query):
        needle=query.casefold()
        results=[]
        for chat in self.conversations():
            snippet=None
            for (text,) in self.db.execute('SELECT text FROM message_search WHERE conversation_id=?',(chat['id'],)):
                position=text.casefold().find(needle)
                if position>=0:
                    start=max(0,position-55)
                    snippet=('…' if start else '')+text[start:start+180]+('…' if len(text)>start+180 else '')
                    break
            if needle in chat['title'].casefold() or snippet is not None:
                results.append({**chat,'snippet':snippet or chat['title']})
            if len(results)>=50:
                break
        return results
    def diagrams(self):
        results=[]
        # Read assistant diagrams directly; image attachments in user turns can
        # be large and are never needed to populate this panel.
        rows=self.db.execute('SELECT m.id,m.conversation_id,c.title,m.content FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.role=? ORDER BY m.rowid DESC',('assistant',))
        for mid,cid,title,raw in rows:
            content=json.loads(raw)
            if not isinstance(content,list):
                continue
            for block in content:
                if block.get('type') in {'molecule','reaction','mechanism','resonance'} and (block.get('svg') or any(step.get('svg') for step in block.get('steps',[])+block.get('contributors',[]))):
                    results.append({'id':mid+':'+str(block.get('id','')),'conversation_id':cid,'title':title,'block':block})
                if len(results)>=120:
                    return results
        return results
    def rewind_to(self, cid, message_id):
        """Remove a question and everything after it, so Retry and Edit continue the same chat."""
        history=self.messages(cid)
        index=next((i for i,message in enumerate(history) if message['id']==message_id and message['role']=='user'),None)
        if index is None:
            raise ValueError('That question was not found in this conversation.')
        with self.db:
            for message in history[index:]:
                self.db.execute('DELETE FROM message_search WHERE id=?',(message['id'],))
                self.db.execute('DELETE FROM messages WHERE id=?',(message['id'],))
    def delete(self, cid):
        self.db.execute('DELETE FROM message_search WHERE conversation_id=?', (cid,))
        self.db.execute('DELETE FROM messages WHERE conversation_id=?', (cid,))
        self.db.execute('DELETE FROM conversations WHERE id=?', (cid,))
        self.db.commit()
        self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.db.execute('VACUUM')

class Credentials:
    """API keys in a private file in ChemEZ's data folder, readable only by this user account.

    The operating-system keychain is deliberately not used: on unsigned builds macOS asked for a
    keychain password that need not match the login password. Keys never enter SQLite or chats.
    """
    def __init__(self, directory=None):
        self.session = {}
        self.warning = ''
        self.path = Path(directory) / 'credentials.json' if directory else None
        # Evaluation runs use an isolated profile but may reuse the keys the app already saved.
        if os.environ.get('CHEMEZ_CREDENTIALS_FILE'):
            self.path = Path(os.environ['CHEMEZ_CREDENTIALS_FILE'])
        if os.environ.get('CHEMEZ_SESSION_ONLY') == '1':
            self.path = None
            self.warning = 'Session-only credentials are enabled. API keys will not be saved on this device.'
        elif not self.path:
            self.warning = 'No data folder is available. API keys will be kept for this session only.'
    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf8'))
            return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(data, dict) else {}
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            self.warning = 'Saved API keys could not be read. Re-enter your key.'
            return {}
    def _save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name('.credentials.json.tmp')
        # Created with owner-only permissions before any key is written, then swapped in atomically.
        handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(handle, 'w', encoding='utf8') as file:
                json.dump(data, file)
                file.flush()
                os.fsync(file.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)
    def get(self, account):
        if account in self.session:
            return self.session[account]
        if self.path:
            secret = self._load().get(account)
            if secret:
                return self.session.setdefault(account, secret)
        return None
    def set(self, account, secret):
        self.session[account] = secret
        if not self.path:
            return
        try:
            data = self._load()
            data[account] = secret
            self._save(data)
        except OSError:
            self.warning = 'This API key could not be saved on this device. It is kept for this session only.'
    def delete(self, account):
        self.session.pop(account, None)
        if not self.path:
            return
        data = self._load()
        if account in data:
            del data[account]
            try:
                self._save(data)
            except OSError as exc:
                raise RuntimeError('The saved API key could not be deleted. Check ChemEZ’s data folder permissions.') from exc
