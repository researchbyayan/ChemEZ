# Failure review and follow-up changes

The two completed live passes used NVIDIA's hosted
`nvidia/nemotron-3.5-bolt-e4b` at `https://integrate.api.nvidia.com/v1`.
The 50 distinct prompts comprise 25 reference questions and 25 authored cases.
The report and screenshots record those runs; later offline validation is not a
new model run or an accuracy score. The Qwen vision candidate was not tested live:
its evaluation connection was never completed.

| Evidence | General lesson | Implemented response |
| --- | --- | --- |
| Many baseline answers contained malformed JSON/LaTeX | Prompting alone does not guarantee machine-readable answers | Native structured output where documented; conservative string escape recovery; one repair; visible partial-answer errors |
| Images and difficult structures could destabilize processing | Expensive native decoding and chemistry need limits and isolation | Header/pixel checks before decode; bounded native workers; cancellation; backend/renderer recovery |
| K05, K16, S10, S18 supplied invalid or underspecified stereochemistry/intermediates | A readable name is not structural proof | Stereochemistry/name checks; atom/charge conservation checks; invalid panels suppressed |
| K14, S04, S16 omitted carbon-bearing reactants | A valid product SMILES does not validate the scheme | Conservative missing-carbon-source guard; explicit reactant requirements in the model prompt |
| K18 listed FeBr3 without Br2 | A catalyst is not the consumed halogenating reagent | New narrow catalyst-only halogenation guard; legitimate explicit or labeled halogen sources remain accepted |
| K23 contradicted its own pH calculation; S25 chose the wrong product | Structural validation does not certify explanatory chemistry | Explicit model self-check instructions; these remain accuracy-test blockers, rather than falsely claimed validator successes |
| Tutor answers were terse or missed the final teaching question | Explanation styles need a contract and persistence | Distinct mode instructions, post-response checks, bounded repair, stored mode labels |
| Bolt cannot interpret images | Reading an image and explaining chemistry may need different models | Optional independently configured Image reader; original images sent only to it; observations handed to the chat model |
| Re-reading images during follow-up questions wastes calls | Cache the interpretation with its source image | Local stored observations reused on follow-up turns, including after disabling the reader |
| Provider 503/429 errors were confused with bad keys | Availability and authentication are different failures | Bounded pre-output transient retries; NVIDIA 429 retries only when it supplies a short Retry-After; no model/key rotation or paid fallback |

## NVIDIA hosted trial access

NVIDIA Developer Program membership offers hosted API access for prototyping.
Use an account-issued key and an API-enabled model from the catalog. A downloadable
model or an image-generation endpoint is not automatically an image-reading chat
endpoint. Model listing is discovery, not proof that a model is usable by this
account. Save & connect exercises the selected connection; the Image reader check
sends a blank image to test transport, not chemistry recognition accuracy.

- [Official hosted API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart)
- [Official access, scope and rate-limit FAQ](https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317)
- [API catalog](https://build.nvidia.com/explore/discover)

No local LLM or model weights were installed for these tests. Local Python/RDKit
handles structure validation and drawing. Native integration smoke tests use
local mock API servers and spend no hosted inference credits. A real 50-question
plus image accuracy pass still needs a working model/key connection. Trial limits
and production deployment terms are separate from application correctness.
