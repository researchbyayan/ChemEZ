import pytest

# Tests never reach PubChem: a small offline stand-in answers lookups.
OFFLINE = {
    'phosgene': {'cid': 6371, 'smiles': 'ClC(Cl)=O', 'title': 'Phosgene', 'iupac_name': 'carbonyl dichloride', 'source': 'pubchem',
                 'synonyms': ['Carbonyl dichloride'], 'properties': {'Boiling point': '8.2 °C'}},
    'chloroform': {'cid': 6212, 'smiles': 'ClC(Cl)Cl', 'title': 'Chloroform', 'iupac_name': 'trichloromethane', 'source': 'pubchem',
                   'synonyms': ['Trichloromethane'], 'properties': {'Boiling point': '61.1 °C'}},
}

class OfflineClient:
    def __enter__(self): return self
    def __exit__(self, *args): return False

@pytest.fixture(autouse=True)
def offline_pubchem(monkeypatch):
    from chemez import compounds
    monkeypatch.setattr(compounds, 'pubchem_record', lambda client, name: OFFLINE.get(name.lower()))
    monkeypatch.setattr(compounds, 'suggestions', lambda client, name: ['phosgene'] if name.startswith('fosgen') else [])
    monkeypatch.setattr(compounds.Lookup.__init__, '__defaults__', (lambda: OfflineClient(),))


@pytest.fixture(autouse=True)
def no_model_decisions(monkeypatch):
    # Existing tests count model calls; the drawing decision and name check are tested on their own.
    monkeypatch.setenv('CHEMEZ_MODEL_DECISIONS', '0')
