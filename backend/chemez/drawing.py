"""Decide the drawing from the answer, not the question.

After the model has answered, a short second call reads that answer and picks what ChemEZ
should draw: keep the diagrams it made, drop them, show only specific species, or show a
resonance series. ChemEZ then draws the choice with its own verified tools.
"""
import json, re

DIAGRAMS = ('molecule', 'reaction', 'mechanism', 'resonance', 'comparison')
CHOICES = ('keep', 'none', 'molecules', 'resonance')


def prompt(question, blocks):
    """The decision request: the question, the answer text and the diagrams it currently has."""
    prose = '\n'.join(b.get('text', '') for b in blocks if b.get('type') == 'markdown').strip()[:4000]
    shown = [f'{b["type"]}: ' + (b.get('label') or b.get('caption') or b.get('smiles') or '') for b in blocks if b.get('type') in DIAGRAMS]
    return ('A chemistry tutor answered a learner. Choose the diagram that best supports THIS answer.\n'
            f'Question: {question}\nAnswer:\n{prose}\nDiagrams in the answer: {"; ".join(shown) or "none"}\n\n'
            'Reply with JSON only: {"draw": "keep" | "none" | "molecules" | "resonance", "molecules": [{"name": "...", "smiles": "..."}]}\n'
            '- keep: the listed diagrams fit what the answer says.\n'
            '- none: nothing to draw (greeting, small talk, not about a specific chemical species, or a pure calculation).\n'
            '- molecules: draw only the species the answer is about, e.g. just the major resonance contributor, or the two compounds compared. Give each one\'s SMILES with charges.\n'
            '- resonance: the answer explains delocalisation across several contributors; give the species in "molecules".')


def parse(text):
    """{'draw': choice, 'molecules': [{'name', 'smiles'}]} or None when the reply is unusable."""
    found = re.search(r'\{.*\}', text or '', re.S)
    try:
        data = json.loads(found.group(0)) if found else None
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get('draw') not in CHOICES:
        return None
    molecules = [m for m in data.get('molecules') or [] if isinstance(m, dict) and isinstance(m.get('smiles'), str) and m['smiles'].strip()][:4]
    if data['draw'] in ('molecules', 'resonance') and not molecules:
        return None
    return {'draw': data['draw'], 'molecules': molecules}


def wanted(decision):
    """Blocks for ChemEZ to draw for a decision, or None when the current diagrams stay."""
    if not decision or decision['draw'] == 'keep':
        return None
    if decision['draw'] == 'none':
        return []
    if decision['draw'] == 'resonance':
        first = decision['molecules'][0]
        return [{'type': 'resonance', 'caption': f'Resonance in {first.get("name") or "the species"}', 'hybrid': True,
                 'contributors': [{'smiles': first['smiles'], 'label': first.get('name', '')}]}]
    return [{'type': 'molecule', 'smiles': m['smiles'], 'label': (m.get('name') or '')[:1].upper() + (m.get('name') or '')[1:]} for m in decision['molecules']]


def apply(blocks, drawn):
    """The answer with its diagrams replaced by `drawn` (text and notes kept in place)."""
    text = [b for b in blocks if b.get('type') not in DIAGRAMS and b.get('type') != 'error']
    return text[:1] + drawn + text[1:]

