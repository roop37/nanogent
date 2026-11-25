# 0001: TypeScript monorepo

Most of this project is orchestration: API calls, tool execution, state and streaming. One language for the CLI, the
engine and the eventual web app keeps types shared and the build simple.

pnpm workspaces and Turborepo, strict TypeScript (ESM, NodeNext, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), plain `tsc` for builds, Biome for lint and format, Vitest for tests, Zod at every
boundary that takes untrusted input. Node 24 in development and CI.
