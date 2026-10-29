# External gateways for ChemEZ

ChemEZ can connect to an independently configured OpenAI-compatible gateway.
Gateway software does not grant upstream model access, extra quota, or free
inference. Gateway routing/budget settings determine which upstream is called;
ChemEZ submits only the alias you choose and never changes to another alias.
All previously deleted credentials remain deleted.

## LiteLLM example

1. Install LiteLLM Proxy separately in its own environment, following its official
   documentation: https://docs.litellm.ai/docs/simple_proxy . It is not bundled in
   ChemEZ's chemistry Python environment.
2. Start Ollama separately and download `llama3.2:3b` if you want to use the local
   example. Model size, speed and chemistry quality depend on the hardware/model.
3. Set `CHEMEZ_GATEWAY_KEY` in the gateway process environment to a key you choose.
   Do not put it in this repository. Start LiteLLM bound to loopback:

   ```sh
   litellm --config config/litellm.local.example.yaml --host 127.0.0.1 --port 4000
   ```

4. In ChemEZ choose **OpenAI-compatible endpoint / gateway**, then **Local LiteLLM**.
   Keep **API / gateway key** authentication, enter the gateway key, and click
   **Load available models**. Choose `chem-local`, then **Save & test**.

The example routes only to local Ollama, has no cloud fallback list, and disables
LiteLLM's retries to avoid multiplying ChemEZ's bounded retries. It requires a
working separate gateway/model installation. It has been reviewed as an example;
this project does not claim a live LiteLLM deployment was tested on this Mac.

## Other supplied projects

| Project | Fit and current scope |
| --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm) | OpenAI-compatible proxy; local preset, model discovery, and example configuration supplied. |
| [Routerly](https://github.com/Inebrio/Routerly) | OpenAI-compatible `/v1` routes; local preset uses port 3000. Configure its project/token and model aliases in Routerly first. |
| [Portkey](https://github.com/Portkey-AI/gateway) | Default local API is port 8787 `/v1`; direct routes may need Portkey-specific provider/configuration headers. ChemEZ currently exposes Bearer authentication, not arbitrary custom headers. A preconfigured OpenAI-compatible route is required; no claim of complete native Portkey integration. |
| [AIClient2API](https://github.com/justlovemaki/AIClient2API) | Can expose an OpenAI-compatible endpoint. Deploy and authenticate it independently, then enter its documented API base/model alias/key. ChemEZ does not extract or import other clients' login tokens, or bundle this project's code. |
| [API-backend](https://github.com/Kingknight23/API-backend) | The linked README describes general business microservices (book/event/payment/user), not an LLM gateway. No code adopted. |

No external gateway source or dependency is bundled by this change. Consult each
project's current documentation and license when deploying it.

## Authentication and diagnostics

- Remote endpoints require a key. HTTPS is required except for literal loopback
  addresses (`127.0.0.1`, `localhost`, `::1`).
- **No key** mode must be selected explicitly, and is restricted to a loopback
  compatible gateway. It does not access or persist credentials.
- Model discovery calls the configured base URL plus `/models`. It lists gateway
  aliases; it does not prove quota or upstream inference availability. Gateways
  without that route can still be used with a manually entered alias.
- **Save & test** validates a complete ChemEZ-format answer through the chosen
  route. Chemistry blocks remain locally validated before rendering.
- Explicit HTTP 502/503 rejections may retry twice with backoff/jitter, using the
  same endpoint, alias and key. A numeric Retry-After up to 10 seconds is honored;
  a longer value stops retries. Total time remains bounded. Timeouts, partial
  streams, authentication failures and free-quota errors do not auto-retry.
- A gateway may implement additional routing/retries itself. Configure it to use
  only the upstream models and budgets you intend.

Verification uses mocked HTTP plus the packaged Electron smoke against a local
OpenAI-compatible server. Actual third-party deployments remain unverified.
