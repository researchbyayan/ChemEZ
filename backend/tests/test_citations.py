import pytest
from chemez.citations import match_record,query_title,resolve,_CACHE

CITATION='Davis et al., “Association Between Apple Consumption and Physician Visits,” JAMA Intern Med 175: 1347–1349'
RECORD={'title':['Association Between Apple Consumption and Physician Visits: Appealing the Conventional Wisdom That an Apple a Day Keeps the Doctor Away'],'author':[{'family':'Davis','given':'Matthew A'},{'family':'Bynum','given':'Julie P W'}],'published':{'date-parts':[[2015,5,1]]},'container-title':['JAMA Internal Medicine'],'volume':'175','issue':'5','page':'777-783','DOI':'10.1001/jamainternmed.2014.5466'}


def test_matches_title_and_author_not_hallucinated_pagination():
    result=match_record(CITATION,[RECORD])
    assert result['url']=='https://doi.org/10.1001/jamainternmed.2014.5466'
    assert '777-783' in result['citation'] and '1347' not in result['citation']
    assert 'not verified' in result['provenance']
    assert query_title(CITATION)=='Association Between Apple Consumption and Physician Visits'


def test_rejects_nearby_unrelated_or_wrong_author_and_unsafe_doi():
    assert match_record(CITATION,[{**RECORD,'title':['Apple juice and diabetes']}]) is None
    assert match_record(CITATION,[{**RECORD,'author':[{'family':'SomeoneElse'}]}]) is None
    assert match_record(CITATION,[{**RECORD,'DOI':'https://evil.example'}]) is None


@pytest.mark.asyncio
async def test_offline_failure_does_not_invent_a_url(monkeypatch):
    import httpx
    class Offline:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):raise httpx.ConnectError('offline')
        async def __aexit__(self,*args):pass
    _CACHE.clear();monkeypatch.setattr('chemez.citations.httpx.AsyncClient',Offline)
    assert await resolve(CITATION)=={'status':'unavailable'}


@pytest.mark.asyncio
async def test_lookup_route_requires_loopback_token_and_bounded_text(tmp_path,monkeypatch):
    from httpx import ASGITransport,AsyncClient
    from chemez.app import create_app
    monkeypatch.setattr('chemez.app.prewarm',lambda:None)
    async def fake(citation):return {'status':'unmatched'}
    monkeypatch.setattr('chemez.citations.resolve',fake)
    app=create_app(tmp_path,'test-token')
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
        assert (await client.post('/references/resolve',json={'citation':CITATION})).status_code==401
        headers={'Authorization':'Bearer test-token'}
        assert (await client.post('/references/resolve',json={'citation':'x'*601},headers=headers)).status_code==422
        response=await client.post('/references/resolve',json={'citation':CITATION},headers=headers)
        assert response.status_code==200 and response.json()=={'status':'unmatched'}
