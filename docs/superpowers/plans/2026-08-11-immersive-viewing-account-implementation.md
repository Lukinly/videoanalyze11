# 十一 videoanalysis Immersive Viewing and Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved blue-violet immersive video workspace, move credit and account actions to `/account`, and rename the visible product brand to “十一 videoanalysis”.

**Architecture:** Keep the existing root-page state machine: no uploaded video renders a compact welcome/upload page, while an uploaded video renders a viewport-height `WatchingWorkspace`. Add a route-selected `AccountPage` without introducing a router dependency, and isolate playback-follow calculations in pure functions so chapter/transcript synchronization can be tested independently.

**Tech Stack:** React 19, TypeScript, Vite 7, Vitest, Testing Library, existing Fastify APIs and native HTML video controls.

## Global Constraints

- Brand copy is exactly `十一 videoanalysis`.
- Root page before upload contains only welcome, upload, navigation, and necessary analysis feedback.
- Desktop watching layout fills the viewport below the navigation; the right rail scrolls independently.
- Narrow screens stack video above the right rail and use natural page scrolling.
- Right rail defaults to `章节笔记`, also provides `逐字稿`, and keeps search available.
- Clicking chapters, transcript rows, or search results seeks without changing play/pause state.
- Playback highlights the active chapter and transcript segment.
- User scrolling temporarily suspends automatic follow and resumes after a short idle period.
- `/account` contains credits, top-up requests, ledger/history, email, password change, and logout.
- Do not change API billing, analysis, summary, or authentication semantics.
- Do not guess at the separate no-audio root cause in this plan.

---

### Task 1: Playback Follow Model

**Files:**
- Create: `apps/web/src/viewing/playback-follow.ts`
- Test: `apps/web/src/viewing/playback-follow.test.ts`

**Interfaces:**
- Consumes: current playback time plus chapter or transcript items with `start` and `end` numbers.
- Produces: `findActiveTimedItem<T extends TimedItem>(items: T[], currentTime: number): T | undefined` and `FOLLOW_RESUME_DELAY_MS`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { findActiveTimedItem, FOLLOW_RESUME_DELAY_MS } from "./playback-follow";

describe("playback follow", () => {
  const items = [{ id: "a", start: 0, end: 10 }, { id: "b", start: 10, end: 20 }];
  it("finds the item containing the current time", () => {
    expect(findActiveTimedItem(items, 12)?.id).toBe("b");
  });
  it("returns no item outside known time ranges", () => {
    expect(findActiveTimedItem(items, 25)).toBeUndefined();
  });
  it("uses a positive idle delay before resuming follow", () => {
    expect(FOLLOW_RESUME_DELAY_MS).toBeGreaterThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/viewing/playback-follow.test.ts`

Expected: FAIL because `playback-follow.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

```ts
export type TimedItem = { start: number; end: number };
export const FOLLOW_RESUME_DELAY_MS = 3000;

export function findActiveTimedItem<T extends TimedItem>(items: T[], currentTime: number): T | undefined {
  return items.find((item) => currentTime >= item.start && currentTime < item.end);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/viewing/playback-follow.test.ts`

Expected: PASS.

### Task 2: Interactive Right Rail

**Files:**
- Create: `apps/web/src/viewing/ViewingSidebar.tsx`
- Create: `apps/web/src/viewing/ViewingSidebar.test.tsx`
- Modify: `apps/web/src/chapters/ChapterList.tsx`
- Modify: `apps/web/src/chapters/ChapterList.test.tsx`
- Modify: `apps/web/src/transcript/TranscriptPanel.tsx`

**Interfaces:**
- Consumes: `AnalysisRun`, `currentTime`, `runId`, and `onSeek(seconds)`.
- Produces: `ViewingSidebar` with `章节笔记` and `逐字稿` tabs, active item IDs, search, AI summary, and temporary auto-follow suspension.

- [ ] **Step 1: Add failing chapter detail and sidebar interaction tests**

```tsx
render(<ViewingSidebar run={runFixture} currentTime={12} onSeek={seek} />);
expect(screen.getByRole("tab", { name: "章节笔记", selected: true })).toBeVisible();
expect(screen.getByText("章节要点")).toBeVisible();
await user.click(screen.getByRole("tab", { name: "逐字稿" }));
expect(screen.getByRole("button", { name: /00:12 内容/ })).toHaveClass("is-active");
```

Extend the chapter fixture with `bullets: [{ text: "章节要点", sourceSegmentIds: ["s1"] }]` and assert clicking its chapter still calls `seek(start)`.

- [ ] **Step 2: Run the sidebar and chapter tests and verify they fail**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/viewing/ViewingSidebar.test.tsx src/chapters/ChapterList.test.tsx`

Expected: FAIL because the sidebar and bullet rendering do not exist.

- [ ] **Step 3: Extend chapter presentation without changing seek semantics**

Change the chapter view type to include:

```ts
bullets?: Array<{ text: string; sourceSegmentIds: string[] }>;
active?: boolean;
```

Render bullets below the summary, apply `is-active` to the active chapter, and add `data-follow-id={chapter.id}` to the chapter list item.

- [ ] **Step 4: Implement the viewing sidebar**

Use `findActiveTimedItem` for chapters and transcript segments. Keep a scroll viewport ref and a `following` ref. On manual scroll, set following false and restore it after `FOLLOW_RESUME_DELAY_MS`; when active ID changes and following is enabled, call:

```ts
viewport.querySelector<HTMLElement>(`[data-follow-id="${CSS.escape(activeId)}"]`)
  ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
```

Render `SummaryPanel` and `ChapterList` in the chapter tab, and `TranscriptPanel` in the transcript tab. Render `SearchPanel` above the tab viewport.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/viewing/ViewingSidebar.test.tsx src/chapters/ChapterList.test.tsx src/transcript/TranscriptPanel.test.tsx`

Expected: PASS.

### Task 3: Immersive Watching Workspace and Root State

**Files:**
- Create: `apps/web/src/viewing/WatchingWorkspace.tsx`
- Create: `apps/web/src/viewing/WatchingWorkspace.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/player/VideoPlayer.tsx`

**Interfaces:**
- Consumes: current user, credits, uploaded video, analysis run, and completion/logout callbacks.
- Produces: `WatchingWorkspace` with large player, compact metadata/progress, current playback time, and `ViewingSidebar`.

- [ ] **Step 1: Write failing root-state and viewing tests**

Mock API authentication and render `App`. Assert the initial authenticated state contains the welcome heading and upload control but not `积分余额`, `章节`, or `逐字稿`. Render `WatchingWorkspace` with a video and assert the video and both right-rail tabs exist.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/app.test.tsx src/viewing/WatchingWorkspace.test.tsx`

Expected: FAIL because `WatchingWorkspace` does not exist and the current root renders all panels.

- [ ] **Step 3: Implement `WatchingWorkspace`**

Store `currentTime` from `VideoPlayer.onTimeUpdate`. Pass the same player ref seek callback to `ViewingSidebar`. Keep `AnalysisProgress` visually compact inside the player column and call the existing completion callback so final transcript/summary data replaces the run.

- [ ] **Step 4: Simplify authenticated root rendering**

Replace the current all-in-one `Workspace` with:

```tsx
return video
  ? <WatchingWorkspace {...watchingProps} />
  : <HomePage {...homeProps} />;
```

`HomePage` contains the navigation, concise welcome, `UploadVideo`, and no credit request/history panel. Preserve upload-to-analysis behavior and admin navigation.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/app.test.tsx src/viewing/WatchingWorkspace.test.tsx`

Expected: PASS.

### Task 4: Account Page and Brand

**Files:**
- Create: `apps/web/src/account/AccountPage.tsx`
- Create: `apps/web/src/account/AccountPage.test.tsx`
- Create: `apps/web/src/brand/Brand.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/auth/LoginPage.tsx`
- Modify: `apps/web/src/auth/RegisterPage.tsx`
- Modify: `apps/web/src/auth/ResetPasswordPage.tsx`
- Modify: `apps/web/src/auth/VerifyEmailPage.tsx`

**Interfaces:**
- Consumes: `PublicUser`, `onLogout`, `onPasswordChanged`, and the existing `CreditsPanel`/password API.
- Produces: `/account` page and consistent `十一 videoanalysis` brand rendering.

- [ ] **Step 1: Write failing account and brand tests**

```tsx
render(<AccountPage user={user} onLogout={logout} onPasswordChanged={changed} />);
expect(screen.getByRole("heading", { name: "个人中心" })).toBeVisible();
expect(screen.getByText(user.email)).toBeVisible();
expect(screen.getByText("积分余额")).toBeVisible();
expect(screen.getByRole("button", { name: "保存新密码" })).toBeVisible();
expect(screen.getByText("十一 videoanalysis")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/account/AccountPage.test.tsx`

Expected: FAIL because `AccountPage` does not exist.

- [ ] **Step 3: Implement reusable brand and account page**

`Brand` renders the blue-violet mark plus exact copy. `AccountPage` renders profile summary, `CreditsPanel`, an inline change-password form using `api.changePassword`, a home link, and logout. It must not reuse the full-screen reset-token page layout.

- [ ] **Step 4: Select `/account` in `App` and replace visible legacy brand copy**

Handle `/account` after authentication and forced password change checks. Replace visible `videoanalyze` lockups in the listed authentication pages with `Brand`.

- [ ] **Step 5: Run the account and authentication tests**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/account/AccountPage.test.tsx src/auth`

Expected: PASS.

### Task 5: Approved Blue-Violet Responsive Styling

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/app.test.tsx`
- Test: `apps/web/src/viewing/WatchingWorkspace.test.tsx`

**Interfaces:**
- Consumes: semantic class names from Tasks 2–4.
- Produces: approved second-preview visual hierarchy and responsive behavior.

- [ ] **Step 1: Add stable layout-class assertions**

Assert the watching root has `watching-shell`, the player area has `watching-stage`, the right rail has `viewing-sidebar`, and the account root has `account-shell`. These assertions protect the CSS contract without testing pixel values in jsdom.

- [ ] **Step 2: Run tests and verify missing CSS-contract classes fail**

Run: `corepack pnpm --filter @videoanalyze/web test -- src/app.test.tsx src/viewing/WatchingWorkspace.test.tsx src/account/AccountPage.test.tsx`

Expected: FAIL for any missing required class.

- [ ] **Step 3: Implement the visual system**

Define blue-violet color tokens, gradient primary actions, a deep video stage, viewport-height desktop watching grid, fixed-width right rail with internal scroll, active blue-violet timeline states, and account-page cards. Remove obsolete orange-centric watching styles while preserving readable auth/admin states.

- [ ] **Step 4: Add responsive behavior**

At the existing narrow breakpoint, set the watching shell to natural height, use a single column, make the video stage non-sticky, and give the sidebar a bounded readable minimum height. Ensure the navigation wraps without hiding the account entry.

- [ ] **Step 5: Run all Web tests**

Run: `corepack pnpm --filter @videoanalyze/web test`

Expected: all Web tests PASS.

### Task 6: UI Verification

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes: completed UI implementation.
- Produces: evidence that unit, type, lint, build, and responsive contracts hold.

- [ ] **Step 1: Run Web tests and full type checking**

Run: `corepack pnpm --filter @videoanalyze/web test && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 2: Run lint and Web build**

Run: `corepack pnpm lint && corepack pnpm --filter @videoanalyze/web build`

Expected: PASS.

- [ ] **Step 3: Run the existing browser smoke test when its environment is available**

Run: `corepack pnpm --filter @videoanalyze/web exec playwright test e2e/v0.spec.ts`

Expected: PASS with the login entry point and no browser console errors.

- [ ] **Step 4: Review scoped diffs**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; unrelated pre-existing worktree changes remain untouched.
