# 0002: Own the agent loop

The loop is where permissions, limits, history handling and cost accounting happen, so we write it ourselves on top of
`@anthropic-ai/sdk` and use the SDK for transport and types only.

The client is injected so tests can replay scripted responses without calling the API. History is append-only:
assistant content, including thinking blocks, goes back unchanged. The API key is read from
`NANOGENT_ANTHROPIC_API_KEY` when the brain starts and never reaches the sandbox or the event log.

Defaults depend on `NANOGENT_ENV`: Haiku at medium effort for development and tests, Sonnet at high effort in production (the hosted service offers no other model there).
Server-side refusal fallback is on in production only and is never sent for Haiku, which doesn't support it.

Cost: more code to maintain than an off-the-shelf runner. In return the tests are deterministic and the safety and
accounting rules live in one place.
