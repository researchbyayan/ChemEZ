"""Provider-neutral JSON recovery, without evaluating model-authored code."""
import json
import re
from .models import Answer


def gemini_answer_schema():
    """Translate Pydantic's discriminated union into Gemini's supported JSON subset."""
    schema = Answer.model_json_schema()
    definitions = schema.get('$defs', {})
    ignored = {'$defs', 'title', 'default', 'discriminator', 'minLength', 'maxLength'}

    def convert(value):
        if isinstance(value, list):
            return [convert(item) for item in value]
        if not isinstance(value, dict):
            return value
        if '$ref' in value:
            return convert(definitions[value['$ref'].rsplit('/', 1)[-1]])
        result = {}
        for key, item in value.items():
            if key in ignored:
                continue
            if key == 'const':
                result['enum'] = [item]
            else:
                result['anyOf' if key == 'oneOf' else key] = convert(item)
        return result

    return convert(schema)


def decode_answer(text):
    """Accept a complete JSON answer, including harmless Markdown/prose wrappers."""
    text = text.strip().lstrip('\ufeff')
    try:
        data = json.loads(text)
    except ValueError:
        # Some endpoints ignore JSON constraints and emit LaTeX with a single
        # backslash (\ce, \mathrm, ...). Repair only string escaping, never
        # missing braces/fields, truncated chemistry, or model-authored code.
        text = normalize_json_strings(text)
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        # Decode complete objects only. Never patch chemistry, use eval, or accept truncation.
        decoder = json.JSONDecoder()
        for match in ([] if data is not None else list(re.finditer(r'[\[{]', text))[:128]):
            try:
                candidate, _ = decoder.raw_decode(text, match.start())
            except ValueError:
                continue
            if isinstance(candidate, dict) and isinstance(candidate.get('blocks'), list):
                data = candidate
                break
            if isinstance(candidate, list) and candidate and all(isinstance(b, dict) and 'type' in b for b in candidate):
                data = {'blocks': candidate}
                break
        if data is None:
            raise ValueError('No complete answer JSON was found.')
    if isinstance(data, list) and data and all(isinstance(b, dict) and 'type' in b for b in data):
        return {'blocks': data}
    return data


def normalize_json_strings(text):
    """Escape invalid JSON string characters while preserving the exact text/SMILES."""
    output=[]
    inside=False
    index=0
    while index<len(text):
        char=text[index]
        if char=='"':
            inside=not inside
        elif inside and char=='\\' and index+1<len(text):
            following=text[index+1]
            valid=following in '"\\/bfnrt' or (following=='u' and bool(re.fullmatch(r'[0-9a-fA-F]{4}',text[index+2:index+6])))
            output.append(('\\' if valid else '\\\\')+following)
            index+=2
            continue
        elif inside and ord(char)<32:
            output.append(json.dumps(char)[1:-1])
            index+=1
            continue
        output.append(char)
        index+=1
    return ''.join(output)


def chemistry_markdown(text):
    """Render standalone mhchem macros while preserving math and code spans."""
    protected=r'(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*(?<!\\)\$)'
    parts=re.split(protected,text)
    for index in range(0,len(parts),2):
        parts[index]=re.sub(r'\\ce\{(?:[^{}]|\{[^{}]*\})*\}',lambda match:'$'+match.group(0)+'$',parts[index])
        # Recover literal escaped paragraph separators, not commands such as \nu.
        parts[index]=re.sub(r'(?<!\\)\\n(?=\\n|[ \t#*\d]|$)','\n',parts[index])
    return ''.join(parts)


def readable_fallback(text):
    """Keep prose after one failed repair, but never dump malformed JSON into chat."""
    text = text.strip()
    if len(text) < 30 or text.startswith(('{', '[', '`', '"')) or re.search(r'"(?:blocks|type|smiles)"\s*:', text):
        return None
    return text[:60000]


def complete_blocks(text):
    """Recover independently complete blocks, never inventing delimiters or fields.

    Called only after the one allowed repair fails. The caller must show a visible
    incomplete-answer notice; this is not acceptance of a truncated full answer.
    """
    text=normalize_json_strings(text)
    decoder=json.JSONDecoder()
    blocks=[]
    consumed=0
    for match in list(re.finditer(r'\{',text))[:128]:
        if match.start()<consumed:
            continue
        try:
            value,end=decoder.raw_decode(text,match.start())
        except ValueError:
            continue
        if isinstance(value,dict) and value.get('type') in ('markdown','molecule','reaction','mechanism','clarification'):
            blocks.append(value)
            consumed=end
    return blocks
