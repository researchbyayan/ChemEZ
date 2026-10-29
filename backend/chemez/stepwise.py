"""Step-by-step electron movement: one drawing per move.

For /stepbystep (or a question asking for steps or electron movement), a resonance series or a
mechanism is split into consecutive pairs: the structure before, with its curved arrows, and
the structure after. Each step's sentence is written from those arrows, so text and drawing
always agree. Nothing is assumed about a particular compound: the series comes from the model,
or ChemEZ derives it from the structure.
"""
import json, re

ASKS_FOR_STEPS = re.compile(r'step[\s-]*by[\s-]*step|\bin steps\b|moving electrons|electrons? (?:move|moving|movement|flow|pushing)|arrow pushing|curved arrows', re.I)
MODEL_STEP = re.compile(r'\s*\**\s*step\s*\d', re.I)


def wanted(command, question):
    return command == 'stepbystep' or bool(ASKS_FOR_STEPS.search(question or ''))


def atom(smiles, index):
    """"C3"-style label for a zero-based atom index (1-based for the learner)."""
    found = re.findall(r'Cl|Br|[A-Z][a-z]?|[cnops]', re.sub(r'\[(Cl|Br|[A-Z][a-z]?|[cnops])[^\]]*\]', r'\1', smiles))
    element = found[index].capitalize() if index < len(found) else 'atom '
    return f'{element}{index + 1}'


def describe(n, before):
    """One clause per arrow, saying which electron pair moves where."""
    smiles, arrows = before['smiles'], before.get('arrows') or []
    def place(spot):
        return f'the {atom(smiles, spot[0])}–{atom(smiles, spot[1])} bond' if len(spot) == 2 else atom(smiles, spot[0])
    moves = []
    for arrow in arrows:
        tail, head = arrow.get('tail') or [], arrow.get('head') or []
        if not tail or not head:
            continue
        source = f'the bonding electrons of {place(tail)}' if len(tail) == 2 else f'a lone pair on {place(tail)}'
        s_ = '' if len(tail) == 2 else 's'  # "electrons move", "a lone pair moves"
        if len(head) == 2:
            target = f'form{s_} a new bond between {atom(smiles, head[0])} and {atom(smiles, head[1])}' if len(tail) == 1 else f'shift{s_} to {place(head)}'
        else:
            target = f'move{s_} onto {place(head)}'
        clause = f'{source} {target}'
        # With one arrow the charges it creates are simple to state; with more, they cancel along the way.
        if len(arrows) == 1 and len(tail) == 2 and len(head) == 1 and head[0] in tail:
            left = tail[0] if tail[1] == head[0] else tail[1]
            clause += f', so {atom(smiles, head[0])} becomes negative and {atom(smiles, left)} positive'
        moves.append(clause)
    if not moves:
        return f'**Step {n}.** Push the electrons along the curved arrows to reach the next structure.'
    sentence = '; '.join(moves)
    return f'**Step {n}.** {sentence[:1].upper()}{sentence[1:]}. Each curved arrow is one electron pair.'


def resonance_chain(block):
    contributors = [c for c in block.get('contributors') or [] if isinstance(c, dict) and isinstance(c.get('smiles'), str)]
    if len(contributors) == 1:
        # The shortcut: ChemEZ derives the series from the structure itself.
        from .chemistry import resonance_series
        contributors = [{'smiles': s, 'label': contributors[0].get('label', '') if not i else ''} for i, s in enumerate(resonance_series(contributors[0]['smiles'], most=6))]
    return contributors


def split(block):
    """Before/after pairs for a resonance series or mechanism, or None to leave the block whole."""
    if block.get('type') == 'resonance':
        chain, name = resonance_chain(block), block.get('caption') or 'Resonance'
        make = lambda n, before, after: {'type': 'resonance', 'caption': f'{name}: step {n}', 'hybrid': False, 'contributors': [before, after]}
    elif block.get('type') == 'mechanism':
        if block.get('name') and isinstance(block.get('reactants'), list):
            from . import mechanisms
            block = mechanisms.build(block['name'], [r for r in block['reactants'] if isinstance(r, str)])
        chain = [s for s in block.get('steps') or [] if isinstance(s, dict) and isinstance(s.get('smiles'), str)]
        make = lambda n, before, after: {'type': 'mechanism', 'steps': [before, after]}
    else:
        return None
    if len(chain) < 3:
        return None
    out = []
    for n, (before, after) in enumerate(zip(chain, chain[1:]), 1):
        out.append({'type': 'markdown', 'text': describe(n, before), 'drawn': True})
        out.append(make(n, dict(before), {k: v for k, v in after.items() if k != 'arrows'}))
    return out


def steps(raw):
    """Model JSON with each resonance series or mechanism split into one drawing per step."""
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return raw
    blocks = data.get('blocks') if isinstance(data, dict) else None
    if not isinstance(blocks, list):
        return raw
    out, seen, changed = [], set(), False
    for block in blocks:
        try:
            parts = split(block) if isinstance(block, dict) else None
        except Exception:
            parts = None
        if parts is None:
            out.append(block)
            continue
        changed = True
        # The same series repeated under every step is drawn once, split.
        key = json.dumps([b for b in parts if b['type'] != 'markdown'], sort_keys=True)
        if key not in seen:
            seen.add(key)
            out += parts
    if not changed:
        return raw
    # The model's own "Step n" prose would now repeat the drawn steps; its other prose stays.
    out = [b for b in out if not (isinstance(b, dict) and b.get('type') == 'markdown' and not b.get('drawn') and MODEL_STEP.match(b.get('text', '')))]
    out = [{k: v for k, v in b.items() if k != 'drawn'} if isinstance(b, dict) else b for b in out]
    return json.dumps({**data, 'blocks': out})
