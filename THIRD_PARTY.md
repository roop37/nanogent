# Third-party dependencies

Direct dependencies are pinned; `pnpm-lock.yaml` has the full graph. All are permissively licensed.

| Package | License | Used for |
| --- | --- | --- |
| `@anthropic-ai/sdk` | MIT | Claude Messages API client and types |
| `zod` | MIT | Runtime validation |
| `@biomejs/biome` | MIT OR Apache-2.0 | Lint and format |
| `typescript` | Apache-2.0 | Compiler |
| `turbo` | MIT | Workspace tasks |
| `vitest` | MIT | Tests |
| `@types/node` | MIT | Node types |
| `drizzle-orm` | Apache-2.0 | Typed Postgres queries and transactions |
| `drizzle-kit` | MIT | Postgres schema migrations |
| `pg` | MIT | Worker and test Postgres connections |
| `@types/pg` | MIT | node-postgres types |
| `@daytonaio/sdk` | Apache-2.0 | Daytona sandbox client |
| `next` | MIT | App Router dashboard and route handlers |
| `react`, `react-dom` | MIT | Web rendering and browser state |
| `@types/react`, `@types/react-dom` | MIT | React types |
| `@neon/auth` | Apache-2.0 | Managed Better Auth Next.js session and browser SDK |
| `@neondatabase/serverless` | MIT | Neon WebSocket Postgres connections |
| `ws`, `@types/ws` | MIT | Node WebSocket transport and types |
| `server-only` | MIT | Prevent server modules from entering browser bundles |
| `tailwindcss`, `@tailwindcss/postcss` | MIT | Web styles and CSS build |
| `@radix-ui/react-slot` | MIT | shadcn/ui button composition |
| `class-variance-authority` | Apache-2.0 | Component variants |
| `clsx`, `tailwind-merge` | MIT | Conditional Tailwind classes |
| `@playwright/test` | Apache-2.0 | Local browser smoke tests |

The web button, input, textarea, badge and card components are adapted from shadcn/ui's MIT-licensed New York registry.
Its license is included in `apps/web/components/ui/LICENSE`.

| Package | License | Used for |
| --- | --- | --- |
| `lucide-react` | ISC | Interface icons |
| `cmdk` | MIT | Keyboard command palette |
| `@radix-ui/react-dialog`, `@radix-ui/react-popover` | MIT | Focus-managed dialogs, drawer and menus |
| `@radix-ui/react-tooltip`, `@radix-ui/react-tabs` | MIT | Accessible tooltips and tabs |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | MIT packaging; SIL OFL-1.1 fonts | Self-hosted UI and code fonts |
