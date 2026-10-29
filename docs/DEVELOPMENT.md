# ChemEZ

A local Electron workspace for chemistry questions. Bring your own API key for
OpenAI, Anthropic, Google Gemini, or an OpenAI-compatible endpoint. Answers combine
Markdown, LaTeX/`mhchem`, locally validated molecular structures, reaction schemes,
and atom-anchored electron-flow diagrams.

## Run locally

Install Node.js 24 and Python 3.11 or 3.12 (matching your machine's architecture).
Then, from this directory:

```sh
npm ci
npm run setup
npm run dev
```

Open **Model & API → Chat model**, choose a provider, enter a model ID available to your
account and your API key, then **Save & connect**. Compatible endpoints use the
API base URL, e.g. `https://provider.example/v1` or a local
`http://127.0.0.1:11434/v1`. A nonempty placeholder key works for local providers
that ignore authentication. Each model must support text streaming and follow
structured JSON instructions; native tool-calling support is not required. Gemini chemistry requests additionally use JSON MIME mode and an answer schema.

`CHEMEZ_PYTHON` can select a Python executable for initial setup. Development
uses `.venv`; packaged applications include their own Python runtime and RDKit.
No external LaTeX installation or system-wide pip packages are required.

## What it does

- Explains undergraduate chemistry with formatted equations and highlighted code.
- Validates molecular SMILES, formulas, charges, and stereochemistry with RDKit.
- Places molecular drawings and reaction schemes next to the relevant explanation.
- Handles formula-only structure requests by asking for a compound or isomers.
  Natural-language ambiguity is additionally handled by model instructions.
- Draws mechanism panels using zero-based atom/bond anchors; unsupported or invalid
  arrows produce an explicit diagram limitation.
- Exposes `seq_encode` one-hot diagnostics, including the alphabet and per-row
  indices. Encoding errors do not prevent a valid drawing.
- Saves conversations and diagrams locally; copies answers, names and formulas, and exports PNG.
- Uses a minimal black-and-green glass interface, stop generation, and Cmd/Ctrl+Enter to send.
- Lazy-loads math/code rendering and Vitrio refraction; shows the shell while the chemistry runtime starts.
- Uses a benzene-and-lightning logo throughout the interface and desktop icon.

Chemical validation establishes that a structure is parsable and matches a supplied
formula. It cannot establish whether an AI-proposed reaction or mechanism is
experimentally correct. This is a study tool, not a reaction-prediction engine.

## Local data and credentials

The backend binds only to an OS-assigned `127.0.0.1` port. Electron generates a
per-launch bearer token and keeps it in the main process; the isolated renderer
uses a small, allowlisted IPC interface. Provider requests run in Python, never in
the renderer. No telemetry or remote images/fonts are used.

`CHEMEZ_SESSION_ONLY=1` explicitly disables credential persistence. Otherwise, API keys are saved in
`credentials.json` in ChemEZ's data folder with owner-only permissions (0600); the OS keychain is not used,
so there are no keychain password prompts. If that file cannot be written, keys stay in memory and the app
shows a session-only warning. Keys are separate for each provider/compatible
endpoint. Select that provider/endpoint and save settings before using **Delete
saved key**. A failed operating-system deletion is reported explicitly.

SQLite history and generated diagrams live in Electron's user-data directory:

| Platform | Default location |
| --- | --- |
| macOS | `~/Library/Application Support/ChemEZ/` |
| Windows | `%APPDATA%/ChemEZ/` |
| Linux | `$XDG_CONFIG_HOME/ChemEZ/` or `~/.config/ChemEZ/` |

Application naming may use `chemez` in development. Conversation deletion removes
its messages and diagrams from the active database; OS backups remain outside the
app's control. Questions and the latest 24 history messages are sent to the chosen
provider. No provider key is included in saved settings or conversations.

## Build installers

Build **on the target operating system and architecture**, using matching Node and
Python installations:

```sh
npm run package
```

Outputs are in `release/`: macOS DMG, Windows NSIS installer, or Linux AppImage.
`npm run package:dir` creates an unpacked app. `npm run bundle:backend` freezes the
Python service into `backend-dist/chemez-backend`; Electron Builder copies the
entire runtime into the application's resources. The macOS Intel build currently
requires macOS 14+ because of the bundled NumPy wheel.

The CI matrix builds Apple Silicon macOS, Intel macOS, x64 Windows, and x64 Linux
natively. Windows/Linux and Apple Silicon results are unverified until that CI
runs. A build on Intel macOS does not validate an Apple Silicon binary.

Unsigned local builds are suitable for development. Distribution signing and
Apple notarization require the owner's credentials. Configure Electron Builder's
standard `CSC_*`/Apple notarization environment for release distribution; don't
commit signing secrets. AppImage execution requires FUSE on distributions that
use it (or the standard AppImage extraction mode).

## Checks


```sh
npm test
npm run test:backend
npm run build
npx playwright install chromium
npm run test:e2e
npm run bundle:backend
npm run smoke:backend
node scripts/smoke-electron.mjs
node scripts/smoke-electron.mjs --packaged
```

Backend tests use mocked provider streams and a temporary credential adapter;
they don't spend API credits or modify your Keychain. Browser tests use a mock
desktop bridge. Electron smoke tests use the real local service and a temporary
profile; packaged smoke tests also exercise the frozen Python runtime. On headless
Linux, run the Electron smoke under `xvfb-run -a` and install Electron's system
libraries. The CI workflow provides the native build/test entrypoints.

Live provider compatibility must be checked with **Save & connect** and a representative
chemistry question using your account. No provider credentials are bundled.

## Architecture and answer protocol

- `electron/`: application lifecycle, backend subprocess, narrow IPC, native export.
- `backend/chemez/`: FastAPI, provider adapters, Pydantic answer schemas, RDKit,
  secure credentials, and SQLite persistence.
- `frontend/src/`: React chat, structured answer blocks, KaTeX, and diagram export.
- `scripts/`: portable setup, freezing, development, and smoke checks.

`POST /chat` accepts `{ "text": "Draw ethanol", "conversation_id": null }`.
Authenticated NDJSON events are `start`, `status`, `block`, and `done`. The desktop
bridge adds `error` and `finished` lifecycle events. Model output is an ordered
`{ "blocks": [...] }` object with `markdown`, `molecule`, `reaction`, `mechanism`,
and `clarification` variants. The backend assigns stable IDs, canonical SMILES,
SVG geometry, and encoding diagnostics. No model-authored HTML/SVG is accepted.

Complete blocks are validated before display. Progress streams while the model
composes JSON; raw JSON/token fragments are not shown as answer text. Invalid
formatting/chemistry triggers one repair request. If repair still fails, valid
neighboring blocks remain visible and affected blocks show an explicit error. Readable prose is retained when a provider ignores the answer format; malformed JSON is never dumped into chat. Wrapped JSON is normalized before validation, and Gemini thought parts are excluded from answer text. Explicit Kekulé SMILES retain their bond positions in drawings.
Cancellation closes the upstream stream, preserves the user's question, and does
not save an incomplete assistant answer.

## Attribution

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). `seq_encode` is vendored under
its MIT license. The provided chatbot template was an architecture reference;
it had no license file at the reviewed commit, so none of its code/assets are
redistributed. ChemEZ's original code is MIT-licensed.

### Optional gateways

See [gateway setup and comparison](GATEWAYS.md) for LiteLLM/Routerly presets,
model discovery, keyless loopback mode, transient-error handling, and a local-only
LiteLLM example. Gateways run separately and do not create free upstream access.

### Optional separate image API

In **Model & API → Image reader**, connect an image-understanding model using
its own provider, endpoint, model and key. This is optional: a multimodal chat
model can still handle images directly. Image generators are not image readers.

With a separate reader, images are sent to that service. Its text observations
and uncertainty are passed to the chat model, which produces the chemistry
answer and validated drawings. The original image and observations stay in local
history so follow-up questions do not require another image-reading request.
Text-only conversations use just the chat API. Each provider's usage limits apply.

Keys for the two roles are isolated, including when they use the same provider.
The Image reader's connection check sends a blank test image; acceptance checks
transport, not recognition accuracy. Disable the reader and remove its key from
its tab without affecting the chat connection. Removing it does not erase saved
observations; delete the conversation to remove its local image history.

Run `node scripts/smoke-dual-api.mjs` (or add `--packaged`) for the native UI
integration check with isolated local mock APIs. Real image-recognition accuracy
still requires testing the particular model connected by the user.


### Explicit command selection

The composer opens its slash menu at a slash token near the caret, including within
a sentence. Only an explicit menu-button activation selects a command. Typing,
pasting, Tab and Enter in the textarea do not select one. Existing plain question
suggestions remain independent.

`POST /chat` accepts an optional `command` field with one of the eight registered
command names (without `/`), or `null`. The backend applies a command contract only
when this field names it; a raw slash prefix alone is ordinary input. Selected
commands are stored alongside user content so newly typed literal prefixes are not
mistaken for selected tags. Older saved conversations remain readable.
