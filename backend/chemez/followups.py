"""Predictive follow-up questions shown under the latest answer.

The model may propose some ("follow_ups" beside "blocks"); otherwise they are built from
what the answer drew, so small models still get useful, specific next steps.
"""
import re

def _name(item):
    return (item.get('iupac_name') or item.get('label') or '').strip()

def _clean(text):
    text = re.sub(r'\s+', ' ', str(text)).strip()
    if not 6 <= len(text) <= 120 or re.search(r'[<>{}$\\]', text):
        return None
    return text if text.endswith('?') else text.rstrip('.') + '?'

def suggest_followups(blocks, proposed=None, limit=3):
    options = []
    for item in proposed if isinstance(proposed, list) else []:
        cleaned = _clean(item)
        if cleaned and cleaned.lower() not in {o.lower() for o in options}:
            options.append(cleaned)
    local = []
    for block in blocks:
        kind = block.get('type')
        if kind == 'reaction':
            product = next((_name(p) for p in block.get('products', []) if _name(p)), '')
            local += [f'What is the mechanism of {block.get("caption") or "this reaction"}?'.replace('of The ', 'of the '),
                      'Why are these reagents and conditions needed?',
                      f'What side products could form besides {product}?' if product else 'What side products could form?']
        elif kind == 'mechanism':
            local += ['Which step is rate-determining, and why?', 'How would the mechanism change under different conditions?']
        elif kind == 'resonance':
            local += ['Which resonance contributor matters most, and why?', 'How does resonance make this species more stable?']
        elif kind == 'molecule' and _name(block):
            local += [f'What functional groups does {_name(block)} have?', f'How is {_name(block)} made?']
    for item in local:
        cleaned = _clean(item)
        if cleaned and len(options) < limit and cleaned.lower() not in {o.lower() for o in options}:
            options.append(cleaned)
    return options[:limit]


def clean_next_question(reply):
    """A composer hint is a short message, never a serialized answer block."""
    import json
    if not isinstance(reply,str):
        return ''
    text=reply.strip()
    if text.startswith(('"','{','[')):
        try:
            value=json.loads(text)
        except (ValueError,TypeError):
            return ''
        if isinstance(value,dict) and set(value)=={'question'}:
            value=value['question']
        if not isinstance(value,str):
            return ''
        text=value.strip()
    text=re.sub(r'^/\w+\s*','',text.strip("\"'"))
    if len(text.splitlines())!=1 or not 6<=len(text)<=140 or len(text.split())>24 or re.search(r'[{}<>`$\\]',text) or text.startswith('['):
        return ''
    return text
