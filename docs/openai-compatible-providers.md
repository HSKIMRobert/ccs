# OpenAI-Compatible Proxy Developer Contract

The canonical
[OpenAI-Compatible Provider Routing guide](https://docs.ccs.kaitran.ca/features/proxy/openai-compatible-providers)
owns user setup and workflows. This local contract retains runtime and
configuration invariants used by source, tests, and operators.

## Profile-Scoped Insecure TLS

`CCS_OPENAI_PROXY_INSECURE` is read from an OpenAI-compatible profile env.
Truthy values are `1`, `true`, `yes`, and `on` (case-insensitive). When enabled,
the local proxy disables upstream certificate verification for that profile,
including request-time routing to another insecure profile.

This flag weakens TLS verification. Keep it explicit and profile-scoped; never
make it a global default or infer it from a failed certificate check. The live
resolution and dispatcher contracts are in
[`profile-router.ts`](../src/proxy/profile-router.ts) and
[`proxy-server.ts`](../src/proxy/server/proxy-server.ts).

## Request Timeout

`CCS_OPENAI_PROXY_REQUEST_TIMEOUT_MS` controls the upstream request timeout in
milliseconds:

- default: `600000` (10 minutes);
- accepted: values whose `Number.parseInt` result is positive;
- missing, invalid, zero, or negative values: fall back to the default.

Upstream Undici header/body timeouts must stay above the request timeout so they
do not terminate slow self-hosted inference first. The current implementation
adds a 30-second grace ceiling. Source of truth:
[`messages-route.ts`](../src/proxy/server/messages-route.ts).

## Compatibility Boundary

These variables configure the local Anthropic-to-OpenAI proxy. They do not
convert a non-compatible profile into a compatible one, bypass local proxy
authentication, or authorize remote binding. Keep profile detection, adaptive
port selection, passthrough mode, request-time routing, and scenario routing
documented in the public guide.

Focused behavior locks live in `tests/unit/proxy/` and
`tests/integration/proxy/`.
