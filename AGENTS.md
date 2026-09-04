# Repository Guidelines

## Project Structure & Module Organization

The project is a Phaser 3 game built with Vite and JavaScript ES modules. Runtime code lives under `src/` (simulation, rendering, input, controllers, config, i18n), static assets under `public/assets/`, unit tests under `tests/unit/`, and Playwright tests under `tests/e2e/`. Design and technical docs live in `docs/` (gdd, architecture, acceptance-criteria, development-plan). The earlier Canvas prototype (`index.html`, `styles.css`, `game.js`) has been migrated and remains in git history. Product scope is defined in `REQUIREMENTS.md`; team practices are in `CONTRIBUTING.md`.

## Build, Test, and Development Commands

Use Node.js 22.12 or newer and npm:

```sh
npm install
npm run dev
npm test
npm run test:e2e
npm run build
```

These commands install dependencies, start Vite, run Vitest, run Playwright, and create a static build in `dist/`, respectively. Run `git diff --check` before submitting changes.

## Coding Style & Naming Conventions

Use JavaScript, not TypeScript, with two-space indentation, single quotes, semicolons, `camelCase` identifiers, and kebab-case CSS classes. Keep simulation, rendering, input, and controllers separate. Store tunable rules in configuration instead of magic numbers, and centralize user-visible text for localization. Do not add a UI framework or backend.

## Testing Guidelines

Use Vitest for deterministic simulation, validation, and serialization tests; use Playwright for critical browser flows. Name tests after behavior, such as `combat.test.js`. Test supported desktop browsers and layouts from 1280×720 through 1920×1080. Check performance-sensitive changes against the 500-unit target and fixed-timestep requirement.

## Commit & Pull Request Guidelines

Use concise Conventional Commit subjects such as `feat: add city capture progress`. Keep commits focused. Pull requests must summarize behavior, list verification steps, link the task or issue, and include screenshots or recordings for visual changes. Document unresolved design choices instead of silently treating proposals as requirements. At least one other contributor should review a pull request before merge.
