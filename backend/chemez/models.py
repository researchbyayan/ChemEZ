from typing import Annotated, Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from urllib.parse import urlparse

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Reference(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)

class Molecule(StrictModel):
    smiles: str = Field(min_length=1, max_length=2000)
    @field_validator('smiles', mode='before')
    @classmethod
    def interpret_condensed(cls, value):
        from .answer_policy import condensed
        match=condensed(value) if isinstance(value,str) else None
        return match[0] if match else value
    label: str = Field(default='', max_length=200)
    formula: str | None = Field(default=None, max_length=100)
    iupac_name: str = Field(default='', max_length=300)

class Arrow(StrictModel):
    tail: list[int] = Field(min_length=1, max_length=2)
    head: list[int] = Field(min_length=1, max_length=2)
    electrons: Literal[1, 2] = 2
    bend: Literal[-1, 1] = 1

class MarkdownBlock(StrictModel):
    type: Literal['markdown']
    text: str = Field(max_length=60000)

class MoleculeBlock(Molecule):
    type: Literal['molecule']

class ReactionBlock(StrictModel):
    type: Literal['reaction']
    reactants: list[Molecule] = Field(min_length=1, max_length=12)
    products: list[Molecule] = Field(min_length=1, max_length=12)
    reagents: str = Field(default='', max_length=300)
    conditions: str = Field(default='', max_length=300)
    caption: str = Field(default='', max_length=1000)
    # forward →, equilibrium ⇌, retrosynthesis ⇒ (product back to starting materials),
    # no_reaction (crossed arrow: these conditions give no reaction).
    arrow: Literal['forward', 'equilibrium', 'retrosynthesis', 'no_reaction'] = 'forward'
    @field_validator('arrow', mode='before')
    @classmethod
    def arrow_alias(cls, value):
        aliases = {'reversible': 'equilibrium', '<=>': 'equilibrium', '⇌': 'equilibrium', 'retro': 'retrosynthesis', '=>': 'retrosynthesis', 'none': 'no_reaction', 'no reaction': 'no_reaction', '->': 'forward', '→': 'forward'}
        return aliases.get(str(value).strip().lower(), value) if value else 'forward'
    @field_validator('reagents', 'conditions', mode='before')
    @classmethod
    def join_list(cls, value):
        # Models often send reagents/conditions as a list of strings.
        if isinstance(value, list) and all(isinstance(v, str) for v in value):
            return ', '.join(v.strip() for v in value if v.strip())
        return value

class MechanismStep(StrictModel):
    smiles: str = Field(min_length=1, max_length=2000)
    label: str = Field(max_length=500)
    iupac_name: str = Field(default='', max_length=300)
    arrows: list[Arrow] = Field(default_factory=list, max_length=12)
    limitation: str = Field(default='', max_length=500)

class MechanismBlock(StrictModel):
    type: Literal['mechanism']
    steps: list[MechanismStep] = Field(min_length=1, max_length=20)

class ResonanceContributor(StrictModel):
    smiles: str = Field(min_length=1, max_length=2000)
    label: str = Field(default='', max_length=200)
    arrows: list[Arrow] = Field(default_factory=list, max_length=12)

class ResonanceBlock(StrictModel):
    type: Literal['resonance']
    contributors: list[ResonanceContributor] = Field(min_length=2, max_length=8)
    hybrid: bool = True
    caption: str = Field(default='', max_length=1000)

class ClarificationBlock(StrictModel):
    type: Literal['clarification']
    question: str = Field(max_length=2000)
    options: list[str] = Field(default_factory=list, max_length=12)

Block = Annotated[MarkdownBlock | MoleculeBlock | ReactionBlock | MechanismBlock | ResonanceBlock | ClarificationBlock, Field(discriminator='type')]

class Answer(StrictModel):
    references: list[Reference] = Field(default_factory=list, max_length=12)
    blocks: list[Block] = Field(min_length=1, max_length=50)
    follow_ups: list[str] = Field(default_factory=list, max_length=3)

class ImageAttachment(StrictModel):
    name: str = Field(default='Image', min_length=1, max_length=255)
    mime: Literal['image/png'] = 'image/png'
    data: str = Field(min_length=1, max_length=8_000_000, pattern=r'^[A-Za-z0-9+/]+={0,2}$')

class ChatRequest(StrictModel):
    command: Literal['versus','stepbystep','synthesis','practice','nomenclature','lab','calc','spectra'] | None = None
    conversation_id: str | None = None
    text: str = Field(default='', max_length=12000)
    images: list[ImageAttachment] = Field(default_factory=list, max_length=4)
    response_style: Literal['balanced','concise','mechanism'] = 'balanced'
    level: Literal['school','undergraduate','graduate'] = 'undergraduate'
    @model_validator(mode='after')
    def has_content(self):
        if not self.text.strip() and not self.images:
            raise ValueError('Enter a question or attach an image.')
        return self

class ProviderConfig(StrictModel):
    provider: Literal['openai', 'anthropic', 'gemini', 'compatible', 'ollama']
    model: str = Field(min_length=1, max_length=150)
    endpoint: str = Field(default='', max_length=2000)
    api_key: str | None = Field(default=None, max_length=4000)
    auth_mode: Literal['api_key','none'] = 'api_key'
    # Working backup models, tried in order when the chosen model stalls.
    fallbacks: list[str] = Field(default_factory=list, max_length=8)
    @model_validator(mode='after')
    def local_only(self):
        if self.provider == 'ollama':
            if self.endpoint not in ('','http://127.0.0.1:11434/v1'):
                raise ValueError('Local Ollama uses http://127.0.0.1:11434/v1 only.')
            if 'cloud' in self.model.lower():
                raise ValueError('Choose a downloaded local model; cloud models are not supported in local mode.')
            self.endpoint = 'http://127.0.0.1:11434/v1'
        if self.auth_mode=='none' and not (self.provider=='compatible' and urlparse(self.endpoint).hostname in ('127.0.0.1','localhost','::1')):
            raise ValueError('Keyless gateway authentication is allowed only for a loopback compatible endpoint.')
        return self
    @field_validator('endpoint')
    @classmethod
    def endpoint_safe(cls, value):
        if value:
            parsed = urlparse(value)
            local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
            if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or (parsed.scheme != 'https' and not (local and parsed.scheme == 'http')):
                raise ValueError('Use HTTPS, or HTTP for a local endpoint. Credentials and query parameters are not allowed in the URL.')
        return value.rstrip('/')

class GeminiModelsRequest(StrictModel):
    credential_slot: Literal['chat','vision'] = 'chat'
    provider: Literal['gemini', 'ollama','compatible','openai','anthropic'] = 'gemini'
    endpoint: str = ''
    auth_mode: Literal['api_key','none'] = 'api_key'
    @model_validator(mode='after')
    def valid_target(self):
        if self.provider=='compatible':
            config=ProviderConfig(provider='compatible',model='discovery',endpoint=self.endpoint,auth_mode=self.auth_mode)
            if not config.endpoint:
                raise ValueError('Set the gateway API base URL first.')
            self.endpoint=config.endpoint
        elif self.endpoint or self.auth_mode!='api_key':
            raise ValueError('Custom endpoints and auth mode apply only to compatible gateways.')
        return self
    api_key: str | None = Field(default=None, max_length=4000)
