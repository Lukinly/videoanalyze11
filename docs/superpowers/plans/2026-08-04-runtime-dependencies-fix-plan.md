# Runtime Dependencies Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the API migration and worker containers can resolve their production dependencies, including `pg`, at runtime.

**Architecture:** Use pnpm’s injected workspace packages and deploy command during the existing build stage to create a standalone production dependency tree for each workspace package. Build the shared domain package first and expose compiled JavaScript for production Node imports. Copy the deploy tree into each runtime image instead of copying only the workspace root `node_modules`.

**Tech Stack:** Docker multi-stage builds, pnpm 11, Node.js 22, Vitest.

## Global Constraints

- Preserve the existing build commands, migration command, and service interfaces.
- Do not remove or recreate named Docker volumes.
- Keep API and worker runtime images independently deployable.

### Task 1: Add a regression assertion

**Files:**
- Modify: `tests/acceptance/deployment-config.test.ts`

- [x] Add an assertion that both API and worker Dockerfiles use `pnpm deploy` and do not rely solely on copying `/workspace/node_modules` into the runtime image.
- [x] Run `corepack pnpm vitest run tests/acceptance/deployment-config.test.ts` and confirm the new assertion fails against the current Dockerfiles.

### Task 2: Produce standalone runtime dependencies

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `apps/worker/Dockerfile`

- [x] Enable pnpm workspace injection for install/deploy and add `pnpm --config.inject-workspace-packages=true --filter <workspace-package> deploy --prod /workspace/deploy` after each package build.
- [x] Persist `injectWorkspacePackages: true` in `pnpm-workspace.yaml`, align `pnpm-lock.yaml`, and force the pnpm 11 legacy deploy implementation required by a shared workspace lockfile.
- [x] Disable dependency lifecycle scripts during deploy, matching the install stage and avoiding pnpm 11 rejection of the optional `msgpackr-extract` build script.
- [x] Build `@videoanalyze/domain` before API/worker builds so its compiled package is available in the deployed workspace dependency.
- [x] Deploy `@videoanalyze/domain` separately and materialize that relocatable package (including `zod`) into API/worker deploy trees instead of retaining a workspace symlink.
- [x] Make `@videoanalyze/domain` use `src` only under the development condition and `dist` for production imports.
- [x] Replace the root `node_modules` runtime copy with the corresponding `/workspace/deploy` copy.
- [x] Preserve compiled output, migration SQL files, FFmpeg installation, entrypoints, and exposed ports.
- [x] Re-run the targeted acceptance test and the API/worker build checks.

### Task 3: Verify the deployment fix

**Files:**
- No additional files.

- [x] Run `corepack pnpm vitest run tests/acceptance/deployment-config.test.ts`.
- [x] Run `corepack pnpm typecheck` and `corepack pnpm lint`.
- [x] Generate temporary API and worker production deploy trees and confirm runtime imports for `pg`, `bullmq`, and `@videoanalyze/domain`.
- [x] Relocate the generated API tree to a different directory and re-run imports, proving no runtime dependency relies on the original build path.
- [ ] Run `sudo docker compose -f infra/docker-compose.yml build api worker migrate` when Docker access is available, then run the migration service and confirm `pg` resolves; the current sandbox cannot access the host Docker socket without the user's sudo password.
