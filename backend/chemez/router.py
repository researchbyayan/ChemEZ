"""Routes compound questions using question_map.json (see that file for the scenarios)."""
import json, re
from pathlib import Path
from uuid import uuid4
from .chemistry import render_block
from .common_names import COMMON, normalize
from .compounds import computed
from .models import MoleculeBlock

MAP = json.loads((Path(__file__).with_name('question_map.json')).read_text(encoding='utf8'))
# A bare message with one of these words is a question, not a compound name.
NOT_A_NAME = re.compile(r'\b(?:hi|hello|hey|thanks?|thank you|explain|why|how|mechanism|reaction|react|reacts|mechanisms|difference|sn[12]|e[12]|help|test|ok|okay|yes|no|isomers?|polar|acidic|basic|stable|soluble|resonance|resonating|acidity|basicity|stability|stabili[sz]\w*|aromatic\w*)\b|^(?:is|are|does|do|can|could|which|will|should|would|when|where|who)\b', re.I)


def match(text):
    """(intent, {slot: name}) for the first matching intent, or None."""
    cleaned = re.sub(r'\s+', ' ', text.strip()).rstrip('?.! ')
    for intent in MAP['intents']:
        if intent.get('max_words') and (len(cleaned.split()) > intent['max_words'] or NOT_A_NAME.search(cleaned)):
            continue
        for pattern in intent['patterns']:
            found = re.fullmatch(pattern, cleaned, re.I)
            if found and not any(NOT_A_NAME.search(v) for v in found.groupdict().values() if v):
                return intent, {k: v.strip(' "\'') for k, v in found.groupdict().items() if v}
    return None


def _label(title):
    # Capitalise plain names ("methane"), never locants or stereo prefixes ("trans-2-butene", "p-xylene").
    return title[:1].upper() + title[1:] if title.islower() and not re.match(r'^[\w,]+-', title) else title


def compound_block(record, view='card', interpreted=None):
    """A molecule block drawn from the verified SMILES, plus a properties table for cards."""
    block = render_block(MoleculeBlock(type='molecule', smiles=record['smiles'], label=_label(record.get('title', '')), iupac_name=record.get('iupac_name', '')))
    if interpreted:
        block['interpreted'] = f'Showing {record.get("title") or interpreted}'
    if view == 'structure':
        return block
    facts = computed(record['smiles'])
    rows = [['Formula', facts['formula']], ['Molar mass', f'{facts["molar_mass"]} g/mol']]
    if record.get('iupac_name'):
        rows.append(['IUPAC name', record['iupac_name']])
    if record.get('synonyms'):
        rows.append(['Also called', ', '.join(record['synonyms'][:4])])
    rows += [[label, value] for label, value in record.get('properties', {}).items()]
    rows.append(['SMILES', record['smiles']])
    block['properties'] = rows
    if record.get('cid'):
        block['source'] = {'label': 'PubChem', 'url': f'https://pubchem.ncbi.nlm.nih.gov/compound/{record["cid"]}'}
    return block


def ambiguous_block(name, options):
    return {'id': str(uuid4()), 'type': 'clarification', 'question': f'"{name}" can mean more than one compound. Which one?', 'options': options}


def named_structures(text):
    """Verified SMILES for compounds named in a free question (local table only, no network)."""
    words = re.findall(r"[a-z0-9,'()\-]+", text.lower())
    found = {}
    for size in (4, 3, 2, 1):
        for start in range(len(words) - size + 1):
            phrase = normalize(' '.join(words[start:start + size]))
            if len(phrase) > 3 and phrase in COMMON and not any(phrase in seen for seen in found):
                found[phrase] = COMMON[phrase]
    return found
