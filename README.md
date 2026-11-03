Violentmonkey userscript that adds "Not interested" and "Don't recommend channel" buttons over YouTube video thumbnails. It supports Russian and English YouTube interfaces and invokes YouTube's existing feedback menu actions.

Install [Violentmonkey](https://violentmonkey.github.io/get-it/), open the [userscript](https://raw.githubusercontent.com/sashokey/youtube-quick-feedback/master/youtube-quick-feedback.user.js), and confirm installation. Reload YouTube.

Hover over a video thumbnail and click the desired feedback button. The action must be available in that video's YouTube menu.

Buttons appear on Home, Search, Watch, Subscriptions, Trending and Explore recommendation cards. Watch history, advertisement cards and unsupported routes are excluded. If a feedback action is missing from the native menu, the script shows Unavailable instead of choosing another action. YouTube handles feedback and its native Undo control.

The authoritative source is [youtube-quick-feedback.src.ts](youtube-quick-feedback.src.ts). Node.js 24 and the pinned dependencies in package-lock.json provide the reproducible build:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run build
npm run check
```

`build` type-checks all TypeScript and bundles a classic script before minifying it with ten compression passes. `check` runs type-aware linting, strict type checking, syntax and metadata validation, distribution reproducibility checks, and browser behavioral tests against both the unminified compiled bundle and the minified installable file. GitHub Actions runs the same checks with `npm ci`.

The controlled fixtures are based on inspected YouTube cards and native menus. They cover both feedback actions, Undo, dynamic and replaced cards, repeated execution, navigation and user cancellation, stale completions, and observer cleanup. Idle observation is limited to the native page manager and stops on excluded routes. A separate menu observer runs only while a bounded native operation is pending. The tests never submit feedback to a live account.

All authored TypeScript, including tests and helpers, uses `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and type-aware unsafe-operation lint rules. `allowJs` is disabled. `skipLibCheck` applies only to overlapping third-party browser declarations; authored files remain checked. Dependencies and tool versions are pinned in `package-lock.json`.
