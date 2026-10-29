# ChemEZ production evaluation

50 distinct prompts: 25 reference-answer questions and 25 authored stress scenarios.
Live runs use the explicitly selected NVIDIA connection through ChemEZ's native
provider adapter. The runner never reads, prints, or copies API keys. Temporary
profiles keep evaluation conversations separate from the user's chats.

Image capability/safety, cancellation, rendering recovery and native worker
failures are additional tests. A text-only model cannot pass image-recognition
evaluation; graceful rejection is recorded separately from chemistry correctness.

Run `node scripts/evaluate.mjs --live` after building the frontend. It copies only
the current provider configuration into a temporary profile and uses the normal
credential interface. Results and screenshots go to `evaluation/runs/`.

Reference answers use OpenStax Organic Chemistry and Chemistry 2e and RDKit
computed atom inventories. See `cases.json` for individual expectations and sources.
Keyword checks are screening checks, not proof of chemical or mechanistic accuracy.

## Vision candidate

The authorized candidate is `qwen/qwen3.5-122b-a10b` on NVIDIA. Run:

```sh
node scripts/evaluate.mjs --live --connect --keep-open --model=qwen/qwen3.5-122b-a10b --with-images --tag=qwen-vision-2026-10-26
```

This runs the same 50 prompts plus 10 image interpretation cases. Enter the key
in the isolated app, not a command or test fixture. Until that connection is
made, the report covers the completed Bolt runs only; Qwen accuracy is unverified.
