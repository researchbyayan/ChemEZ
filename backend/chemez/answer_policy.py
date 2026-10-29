"""Presentation policy and bounded interpretation of familiar condensed formulas."""
import re
from urllib.parse import urlsplit

CONDENSED = {
    'ch2=chch2cooh': ('C=CCC(=O)O', 'but-3-enoic acid'),
    'ch2=chcooh': ('C=CC(=O)O', 'prop-2-enoic acid'),
    'ch3ch2oh': ('CCO', 'ethanol'),
    'ch3cooh': ('CC(=O)O', 'ethanoic acid'),
    'ch3coch3': ('CC(=O)C', 'propan-2-one'),
    'ch3ch2cooh': ('CCC(=O)O', 'propanoic acid'),
}
def condensed(value):
    key=value.translate(str.maketrans('₀₁₂₃₄₅₆₇₈₉','0123456789')).lower()
    return CONDENSED.get(re.sub(r'\s+', '', key))

def prose(value, key=''):
    if isinstance(value,dict):
        return {k:prose(v,k) for k,v in value.items()}
    if isinstance(value,list):
        return [prose(v,key) for v in value]
    if isinstance(value,str) and key not in ('smiles','svg','svg_changes','url','molblock','inchi','inchikey'):
        # A model that double-escapes JSON leaves "\\u00b7"-style text behind; show the character.
        return re.sub(r'\\u([0-9a-fA-F]{4})',lambda m:chr(int(m.group(1),16)),value).replace('\u2014', ', ')
    return value

def references(items):
    result=[]
    if not isinstance(items,list):return result
    for item in items[:12]:
        if not isinstance(item,dict):continue
        title,url=item.get('title'),item.get('url')
        if not isinstance(title,str) or not title.strip():continue
        if url is None:
            # A book or article named without a link is still listed, just not clickable.
            if title not in [r['title'] for r in result]:
                result.append({'title':title[:200].replace('\u2014', ', '),'provenance':'model'})
            continue
        if not isinstance(url,str):continue
        try:
            target=urlsplit(url)
            host=target.hostname or ''
            safe=target.scheme=='https' and not target.username and not target.password and '.' in host and not re.fullmatch(r'[\d.:]+',host) and not host.endswith(('.local','.localhost'))
        except ValueError: safe=False
        if safe and len(url)<=2000 and url not in [r['url'] for r in result]:
            result.append({'title':title[:200].replace('\u2014', ', '),'url':url,'provenance':'model'})
    return result


HEADING=re.compile(r'^\W*(?:key\s+|further\s+)?(?:references?|sources?|citations?|reading)(?:\s+(?:for|on|about|used)\b[^\n]{0,60}?)?:?\W*$',re.I)
ITEM=re.compile(r'^\s*(?:[-*+]|\d+[.)])\s+(.+)$')

# A list item that reads like a citation: a year, plus a journal volume, edition, publisher or "et al.".
CITATION=re.compile(r'(?=.*\b(?:1[89]|20)\d{2}\b)(?=.*(?:et al\.|\bed\.|\bVol\.|\bCh(?:apter|\.)|\bAnnu\.|\bJ\.|Nature|Science|Wiley|Elsevier|Springer|Press|\*\*\d+\*\*|\b\d+\s*,\s*\d+\s*[-–]\s*\d+))',re.S)

def citations(lines):
    items=[m.group(1) for line in lines if (m:=ITEM.match(line))]
    return len(items)>=2 and all(CITATION.search(t) for t in items[:2])

def move_references(blocks):
    """Move a "References" list written into the answer text into the References button."""
    found=[]
    for block in blocks:
        if block.get('type')!='markdown':continue
        lines=block.get('text','').split('\n');kept=[];i=0
        while i<len(lines):
            if i+1<len(lines) and (HEADING.match(lines[i]) or citations(lines[i+1:])):
                j=i+1;items=[]
                while j<len(lines) and (ITEM.match(lines[j]) or not lines[j].strip() or (items and lines[j].startswith((' ','\t')))):
                    if (m:=ITEM.match(lines[j])):items.append(m.group(1).strip())
                    elif lines[j].strip():items[-1]+=' '+lines[j].strip()
                    j+=1
                if items and (HEADING.match(lines[i]) or all(CITATION.search(t) for t in items)):
                    found+=items
                    if not HEADING.match(lines[i]):kept.append(lines[i])
                    i=j
                    if kept and kept[-1].rstrip().endswith(':') and not HEADING.match(kept[-1]):kept[-1]=kept[-1].rstrip()[:-1]+' (see References).'
                    if i<len(lines):kept.append('')
                    continue
            kept.append(lines[i]);i+=1
        block['text']='\n'.join(kept).strip()
    if not found:return blocks
    blocks=[b for b in blocks if b.get('type')!='markdown' or b.get('text')]
    if not any(b.get('type')=='markdown' for b in blocks):
        blocks=[{'type':'markdown','text':'The sources are listed under References.'},*blocks]
    plain=[re.sub(r'[*_`]','',t)[:200] for t in found]
    if blocks:
        known=blocks[0].setdefault('references',[])
        known+=[{'title':t,'provenance':'model'} for t in plain if t not in [r['title'] for r in known]]
    return blocks
