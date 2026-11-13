---
name: visual-git
description: Visualize, view, or explore a local Git repository's commit history or branch graph. Run, start, or troubleshoot Visual Git.
---

# Visual Git Skill

Guidance for setup, launching, and troubleshooting Visual Git, a read-only local web app that renders a local Git repository's commit graph.

## When to use this skill

Activate this skill when the user wants to:
- Visualize, view, or explore a local Git repository's commit history or branch graph.
- Run, start, or open Visual Git (`visualgit`).
- Install, link, or set up the `visualgit` command.
- Troubleshoot Visual Git (port in use, blank page, "not a Git repository", build missing).

Do **NOT** use this skill for:
- Remote/hosted Git browsing (e.g. GitHub/GitLab).
- Editing or modifying repository contents.
- General Git operations (commit, checkout, push, pull) unrelated to this viewer.

## Background info

- **Stack**: React 19 + Vite 7 frontend, Express server, TypeScript run via `tsx`.
- **Server**: One server process serves both the built static UI and the API on a single port.
- **Entry point**: The CLI entry is `bin/visualgit.mjs` (registers the `tsx` loader, imports `server/cli.ts`). Reusable Express factory is `server/app.ts`.
- **Query parameters**: The frontend reads `?path=<repo>` from the URL and auto-loads that repository.
- **Port**: Default search starts at `4127` and picks the first free port.
- **Read-only**: Reassure users it does not modify their repository.

## How to use it

### 1. First-time Setup
From the project directory, run:
```bash
npm install
npm run build
npm link
```
*Note*: `dist/` must exist before linking. `npm install` runs the build via the `prepare` hook, but running `npm run build` explicitly after `npm link` ensures the build is up to date.

### 2. Run against a repository
- Run on the current directory:
  ```bash
  visualgit
  ```
- Run on a specific repository:
  ```bash
  visualgit "/path/to/repo"
  ```
- Run on a specific port:
  ```bash
  visualgit --port <port_number>
  ```
- Run in headless or non-interactive environments (prints URL only, does not open a browser):
  ```bash
  visualgit --no-open
  ```
- Show help:
  ```bash
  visualgit --help
  ```

### 3. Run without installing globally
From the project directory:
```bash
npm start
```
Or run the entry script directly:
```bash
node bin/visualgit.mjs "/path/to/repo" --no-open
```

### 4. Development mode
Starts Vite + the API with hot reloading:
```bash
npm run dev
```
Open the Vite dev URL, then enter the absolute path to a local repository in the UI.

### 5. Verify a change
Before reporting success for any code changes, ensure both tests and builds pass:
```bash
npm test
npm run build
```

## Operating Guidance

- **Validate Git Repository**: Always verify that the target path contains a `.git` folder (or is a valid Git repository via `git rev-parse --git-dir`) before launching Visual Git. If it isn't, report a clear error and ask for a valid path.
- **Handling Browser Open**: If the user asks to launch or run Visual Git, run the tool *without* the `--no-open` flag (e.g. `visualgit`) so it automatically opens the web browser window on their local machine, and also display the printed URL in your chat response. Use `--no-open` only when explicitly requested or in fully headless environments.
- **Avoid Port Conflicts**: Do not kill existing processes on a port. If a port is in use, either pick another one using `--port <n>` or let the auto-search find one starting at `4127`.
- **Read-Only**: Never run or suggest commands that edit/write to the inspected repository.
- **Path Quoting**: Always wrap repository paths in double quotes to handle spaces and special characters.

## Troubleshooting

- **Error: `... is not a Git repository.`**
  - *Cause*: The specified path does not contain a `.git` directory.
  - *Solution*: Pass a valid git repository path or run the command inside one.
- **Error: `Port already in use`**
  - *Cause*: The selected port is occupied by another process.
  - *Solution*: Use `--port <n>` with a different port, or let the CLI find an available one.
- **Blank page or 404 on assets**
  - *Cause*: The `dist/` folder is missing or stale.
  - *Solution*: Run `npm run build` from the project directory.
- **Error: `visualgit: command not found`**
  - *Cause*: `npm link` was not run, or the global node bin directory is not in the system's `PATH`.
  - *Solution*: Run `npm link` inside the project folder, or run the command via `node bin/visualgit.mjs`.
- **Browser didn't open**
  - *Cause*: OS/environment doesn't support launching the browser window.
  - *Solution*: Open the printed URL manually in the browser.
