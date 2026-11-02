"""On-demand publication metadata lookup. Fixed API host; no arbitrary URL fetching."""
import asyncio
import re
import time
from collections import OrderedDict
from difflib import SequenceMatcher
import httpx

_CACHE=OrderedDict()
_SLOTS=asyncio.Semaphore(2)


def query_title(citation):
    quoted=re.search(r'[“"]([^”"]{12,300})[”"]',citation)
    return quoted[1].strip(' ,.;') if quoted else citation.strip()


def normal(text):
    return ' '.join(re.findall(r'[a-z0-9]+',text.lower()))


def match_record(citation,items):
    query=normal(query_title(citation))
    if len(query)<15:return None
    matches=[]
    author=re.match(r'\s*([A-Z][A-Za-z-]+)\s+(?:et al\.|[A-Z][.\s])',citation)
    for item in items[:5]:
        titles=item.get('title') or []
        if not titles or not isinstance(titles[0],str):continue
        candidate=normal(titles[0])
        exact=query==candidate
        prefix=len(query)>=30 and candidate.startswith(query+' ')
        score=SequenceMatcher(None,query,candidate).ratio()
        if not (exact or prefix or score>=.94):continue
        if author and not any(normal(a.get('family',''))==normal(author[1]) for a in item.get('author',[])):continue
        doi=item.get('DOI','')
        if not isinstance(doi,str) or not re.fullmatch(r'10\.\d{4,9}/[^\s<>"?#]+',doi,re.I):continue
        authors='; '.join(' '.join(filter(None,[a.get('family'),''.join(part[0]+'.' for part in a.get('given','').split() if part)])) for a in item.get('author',[])[:3])
        dates=item.get('published',{}).get('date-parts',[[None]])
        year=dates[0][0] if dates and dates[0] else None
        journal=(item.get('container-title') or [''])[0]
        details=''.join([str(item.get('volume','')),('('+str(item['issue'])+')') if item.get('issue') else '',(':'+item['page']) if item.get('page') else ''])
        formatted='. '.join(str(value).rstrip('.') for value in (authors,titles[0],journal,str(year) if year else '',details) if value)+'.'
        matches.append((1 if exact else .99 if prefix else score,{'status':'matched','title':titles[0],'url':'https://doi.org/'+doi,'citation':formatted,'provenance':'Publication metadata matched via Crossref; answer claims are not verified.'}))
    return max(matches,key=lambda pair:pair[0])[1] if matches else None


async def resolve(citation):
    key=citation.strip()
    cached=_CACHE.get(key)
    if cached and time.monotonic()-cached[0]<cached[1]:return cached[2]
    async with _SLOTS:
        try:
            async with httpx.AsyncClient(timeout=7,follow_redirects=False,headers={'User-Agent':'ChemEZ/0.1 (https://github.com/researchbyayan/ChemEZ)'}) as client:
                response=await client.get('https://api.crossref.org/works',params={'query.bibliographic':query_title(key),'rows':5,'select':'DOI,title,author,published,container-title,volume,issue,page'})
                response.raise_for_status()
                result=match_record(key,response.json().get('message',{}).get('items',[])) or {'status':'unmatched'}
        except (httpx.HTTPError,ValueError,TypeError,KeyError,AttributeError):result={'status':'unavailable'}
    _CACHE[key]=(time.monotonic(),86400 if result['status']=='matched' else 30,result)
    _CACHE.move_to_end(key)
    while len(_CACHE)>256:_CACHE.popitem(last=False)
    return result
