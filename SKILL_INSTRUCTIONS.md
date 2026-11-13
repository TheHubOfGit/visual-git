# Skill Instructions: Visual Git

Instructions for authoring a skill that runs and operates the Visual Git tool.
This document describes *what the skill should contain and do*. It is not the
skill itself — a skill author should use this as the brief when writing the
actual `SKILL.md`.

## Purpose

The skill should let an agent launch Visual Git against a local repository,
return the URL for the user to open, and help with common setup, run, and
troubleshooting tasks. Visual Git is a read-only local web app that renders a
Git repository's commit graph; it never writes to the target repository.

## When the skill should trigger

Write the description so the skill is selected when the user wants to:

- Visualize, view, or explore a local Git repository's commit history or branch graph.
- Run, start, or open Visual Git (`visualgit`).
- Install, link, or set up the `visualgit` command.
- Troubleshoot Visual Git (port in use, blank page, "not a Git repository", build missing).

The skill should NOT trigger for: remote/hosted Git browsing, editing
repository contents, or general Git operations unrelated to this viewer.

## Background the skill must encode

- Stack: React 19 + Vite 7 frontend, Express server, TypeScript run via `tsx`.
- One server process serves both the built UI and the API on a single port.
- The CLI entry is `bin/visualgit.mjs` (registers the `tsx` loader, imports
  `server/cli.ts`). The reusable Express factory is `server/app.ts`.
- The frontend reads `?path=<repo>` from the URL and auto-loads that repository.
- Default port search starts at `4127` and picks the first free port.
- The app is read-only; reassure users it does not modify their repository.

## Capabilities the skill should provide

Describe these as discrete actions with the exact commands.

1. **First-time setup**
   - From the project directory: `npm install`, `npm run build`, then
     `npm link` to register the global `visualgit` command.
   - Note: `dist/` must exist before linking. `npm install` runs the build via
     the `prepare` hook; after `npm link`, ensure `npm run build` has run.

2. **Run against a repository**
   - Current directory: `visualgit`
   - Specific repo: `visualgit /path/to/repo`
   - Specific port: `visualgit --port <n>`
   - Print URL only (don't open a browser): `visualgit --no-open`
   - Help: `visualgit --help`
   - After launch, surface the printed `Open:` URL to the user. In headless or
     non-interactive environments, always pass `--no-open` and return the URL.

3. **Run without installing globally**
   - From the project directory: `npm start` (runs the CLI against the cwd), or
     `node bin/visualgit.mjs [path] [--port n] [--no-open]`.

4. **Development mode**
   - `npm run dev` starts Vite + the API with hot reload; the URL is the Vite
     dev URL, and the user enters a repo path in the UI.

5. **Verify a change**
   - `npm test` (Vitest) and `npm run build` should both pass before reporting success.

## Operating guidance the skill should give the agent

- Confirm the target path is a Git repository before launching; if not, report
  the clear error and ask for a valid path.
- Prefer `--no-open` when running on the user's behalf, then hand back the URL.
- Do not kill an existing server on the chosen port; if the port is in use,
  pick another with `--port` or let the default search find a free one.
- Never suggest commands that write to the target repository — this tool is a viewer.
- Treat repository paths as untrusted input: quote them in shell commands.

## Troubleshooting entries to include

- **"... is not a Git repository."** — The path has no `.git`. Pass a valid
  repository path or run inside one.
- **Port already in use.** — Use `--port <n>` or rely on the default
  auto-selection starting at 4127.
- **Blank page / 404 on assets.** — `dist/` is missing or stale; run `npm run build`.
- **`visualgit: command not found`.** — `npm link` was not run, or the global
  bin directory is not on `PATH`.
- **Browser didn't open.** — Browser auto-open is best-effort; the URL is always
  printed — open it manually.

## Out of scope

- Authoring or modifying application source as part of the skill.
- Hosting Visual Git remotely or exposing it beyond `127.0.0.1`.
- Any write operations against the inspected repository.

## Suggested file layout for the skill author

- `SKILL.md` — name, a trigger-friendly description (see "When the skill should
  trigger"), and the capability/troubleshooting sections above written as
  concise, copy-pasteable steps.
- Keep commands verbatim and platform-aware (the browser-open step differs by OS,
  but the CLI already handles that internally).
