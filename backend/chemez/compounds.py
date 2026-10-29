"""Named-compound lookup: structure and properties for "phosgene", "chloroform", "methan"…

Order, cheapest first: the verified local table, compounds looked up before (cached in
SQLite), a close-spelling match against both, then PubChem (exact name, then PubChem's
own spelling suggestions). Structures always come from the table or PubChem and are
checked with RDKit; a model may only suggest which name was meant.
"""
import difflib, json, re, sqlite3
import httpx
from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors
from .common_names import COMMON, normalize

PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest'
# Bump when the record format or text clean-up changes; older cached records are fetched again.
VERSION = 2
TIMEOUT = 8
# Names that cover several compounds: ask which one instead of picking.
AMBIGUOUS = {
    'xylene': ['o-xylene', 'm-xylene', 'p-xylene'],
    'cresol': ['o-cresol', 'm-cresol', 'p-cresol'],
    'butanol': ['1-butanol', '2-butanol', 'tert-butanol', 'isobutanol'],
    'butene': ['1-butene', 'cis-2-butene', 'trans-2-butene', 'isobutene'],
    'propanol': ['1-propanol', '2-propanol'],
    'pentane isomers': ['pentane', 'isopentane', 'neopentane'],
    'dichlorobenzene': ['1,2-dichlorobenzene', '1,3-dichlorobenzene', '1,4-dichlorobenzene'],
}
# PubChem "Experimental Properties" headings shown in the properties table.
HEADINGS = [('Physical Description', 'Phase / appearance'), ('Melting Point', 'Melting point'),
            ('Boiling Point', 'Boiling point'), ('Density', 'Density')]


class Cache:
    def __init__(self, db):
        # Lookups run in worker threads, so the cache keeps its own connection and lock.
        import threading
        self.db = db if isinstance(db, sqlite3.Connection) else sqlite3.connect(db, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute('CREATE TABLE IF NOT EXISTS compounds (name TEXT PRIMARY KEY, record TEXT NOT NULL)')
        self.db.commit()

    def get(self, name):
        with self.lock:
            row = self.db.execute('SELECT record FROM compounds WHERE name=?', (normalize(name),)).fetchone()
        record = json.loads(row[0]) if row else None
        return record if record and (record.get('version') == VERSION or record.get('source') == 'local') else None

    def names(self):
        with self.lock:
            return [row[0] for row in self.db.execute('SELECT name FROM compounds')]

    def put(self, names, record):
        with self.lock:
            for name in {normalize(n) for n in names if n}:
                self.db.execute('INSERT OR REPLACE INTO compounds VALUES (?,?)', (name, json.dumps(record)))
            self.db.commit()


def computed(smiles):
    """Properties RDKit calculates, so they cannot be wrong."""
    mol = Chem.MolFromSmiles(smiles)
    return {'formula': rdMolDescriptors.CalcMolFormula(mol), 'molar_mass': round(Descriptors.MolWt(mol), 2)}


def _get(client, path):
    response = client.get(PUBCHEM + path, timeout=TIMEOUT)
    return response.json() if response.status_code == 200 else None


def _first_text(section):
    """First readable string in a PUG View section (depth-first)."""
    for info in section.get('Information', []):
        for item in info.get('Value', {}).get('StringWithMarkup', []):
            text = item.get('String', '').strip()
            if text:
                return text[:140]
    for child in section.get('Section', []):
        found = _first_text(child)
        if found:
            return found
    return None


def _all_text(section):
    for info in section.get('Information', []):
        for item in info.get('Value', {}).get('StringWithMarkup', []):
            yield item.get('String', '')
    for child in section.get('Section', []):
        yield from _all_text(child)


def pubchem_record(client, name):
    """Structure, names and physical data for one name, or None if PubChem has no match."""
    found = _get(client, f'/pug/compound/name/{_quote(name)}/property/SMILES,IUPACName,Title/JSON')
    if not found:
        return None
    entry = found['PropertyTable']['Properties'][0]
    cid, smiles = entry['CID'], entry.get('SMILES') or entry.get('IsomericSMILES') or entry.get('CanonicalSMILES')
    if not smiles or Chem.MolFromSmiles(smiles) is None:
        return None
    record = {'cid': cid, 'smiles': Chem.MolToSmiles(Chem.MolFromSmiles(smiles)), 'title': entry.get('Title') or name,
              'iupac_name': entry.get('IUPACName', ''), 'source': 'pubchem'}
    synonyms = _get(client, f'/pug/compound/cid/{cid}/synonyms/JSON')
    if synonyms:
        names = synonyms['InformationList']['Information'][0].get('Synonym', [])
        # Drop registry numbers and codes; keep readable names.
        record['synonyms'] = [n for n in names if re.search(r'[a-z]{3}', n) and not re.search(r'\d{2,}-\d{2}-\d', n)][:5]
    properties = {}
    for heading, label in HEADINGS:
        view = _get(client, f'/pug_view/data/compound/{cid}/JSON?heading={_quote(heading)}')
        if not view:
            continue
        # PubChem notes values measured on a related compound as "… /cis-2-Butene/"; keep only
        # values for this compound (unannotated, or annotated with one of its own names).
        own = {normalize(n) for n in [record['title'], *record.get('synonyms', [])]}
        texts = []
        for t in _all_text(view.get('Record', {})):
            note = re.search(r'\s*/([^/]+)/\s*$', t)
            if note and normalize(note.group(1)) not in own:
                continue
            if t.strip():
                texts.append(t[:note.start()].strip() if note else t.strip())
        # Prefer a Celsius value; keep the phase description to its first sentence.
        if heading == 'Physical Description':
            # The first sentence that states the phase (gas, liquid, solid…).
            sentences = [x.rstrip('.') + '.' for t in texts for x in t.split('. ')]
            text = next((x for x in sentences if re.search(r'\b(?:gas|liquid|solid|crystals?|powder)\b', x, re.I)), sentences[0] if sentences else None)
        else:
            text = next((t for t in texts if '°C' in t), texts[0] if texts else None)
        if text:
            properties[label] = text[:140]
    hazards = _get(client, f'/pug_view/data/compound/{cid}/JSON?heading=GHS+Classification')
    if hazards:
        codes = {}
        for text in _all_text(hazards.get('Record', {})):
            found = re.match(r'(H\d{3})(?: \([\d.]+%\))?: ([^\[]+)', text)
            if found:
                codes.setdefault(found.group(1), found.group(2).strip().rstrip('.'))
        if codes:
            properties['Hazards (GHS)'] = '; '.join(f'{code}: {meaning}' for code, meaning in sorted(codes.items())[:4])
    uses = _get(client, f'/pug_view/data/compound/{cid}/JSON?heading=Uses')
    text = uses and _first_text(uses.get('Record', {}))
    if text:
        properties['Common uses'] = text.split('. ')[0].rstrip('.') + '.'
    record['properties'] = {label: _tidy(value) for label, value in properties.items()}
    record['title'] = _tidy(record['title'], title=True)
    record['version'] = VERSION
    return record


def _tidy(text, title=False):
    """PubChem sometimes shouts (HSDB entries in capitals); write those in sentence or title case."""
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8 and len(letters) > 3:
        text = text.lower()
        if title:
            return re.sub(r'(^|[\s-])([a-z])(?=[a-z]{2})', lambda m: m.group(1) + m.group(2).upper(), text, count=1)
        return text[:1].upper() + text[1:]
    if title:
        # Mixed titles such as "trans-2-BUTENE": lower the shouted name part.
        text = re.sub(r'\b[A-Z]{4,}\b', lambda m: m.group(0).lower(), text)
    return text


def _quote(text):
    from urllib.parse import quote
    return quote(text, safe='')


def suggestions(client, name):
    """PubChem's autocomplete, which corrects most misspellings."""
    data = _get(client, f'/autocomplete/compound/{_quote(name)}/json?limit=3')
    return (data or {}).get('dictionary_terms', {}).get('compound', [])


class Lookup:
    def __init__(self, cache: Cache, client_factory=lambda: httpx.Client(follow_redirects=True)):
        self.cache, self.client_factory = cache, client_factory

    def find(self, name):
        """{'record': …, 'interpreted': name or None} | {'ambiguous': [names]} | None."""
        key = normalize(name)
        if not key or len(key) > 80:
            return None
        if key in AMBIGUOUS:
            return {'ambiguous': AMBIGUOUS[key]}
        record = self._known(key)
        if record:
            return {'record': record, 'interpreted': None}
        close = difflib.get_close_matches(key, list(COMMON) + self.cache.names(), n=1, cutoff=0.84)
        if close:
            return {'record': self._known(close[0]), 'interpreted': close[0]}
        try:
            with self.client_factory() as client:
                record = pubchem_record(client, key)
                interpreted = None
                if not record:
                    for suggestion in suggestions(client, key):
                        # Only a spelling correction, not a different compound containing the words.
                        if difflib.SequenceMatcher(None, key, normalize(suggestion)).ratio() < 0.75:
                            continue
                        record = pubchem_record(client, suggestion)
                        if record:
                            interpreted = suggestion
                            break
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            return None
        if not record:
            return None
        self.cache.put([key, interpreted, record['title']], record)
        return {'record': record, 'interpreted': interpreted}

    def known(self, name):
        """True for names ChemEZ has verified locally or looked up before (no network)."""
        key = normalize(name)
        return key in COMMON or bool(self.cache.get(key))

    def _known(self, key):
        cached = self.cache.get(key)
        if cached:
            return cached
        if key in COMMON:
            # The verified local structure; physical data is filled in from PubChem when online.
            record = {'smiles': COMMON[key], 'title': key, 'iupac_name': '', 'source': 'local', 'properties': {}}
            try:
                with self.client_factory() as client:
                    online = pubchem_record(client, key)
            except (httpx.HTTPError, ValueError, KeyError, IndexError):
                online = None
            if online and same_structure(online['smiles'], record['smiles']):
                record = {**online, 'smiles': record['smiles']}
                self.cache.put([key], record)
            return record
        return None


def same_structure(a, b):
    first, second = Chem.MolFromSmiles(a), Chem.MolFromSmiles(b)
    return bool(first and second) and Chem.MolToSmiles(first, isomericSmiles=False) == Chem.MolToSmiles(second, isomericSmiles=False)
