# Visual Git

Visual Git is a local web app for inspecting existing projects that already have Git initialized.

## Command line

Install the `visualgit` command globally from this project directory:

```bash
npm install
npm run build      # builds the frontend into dist/ (also runs automatically on install)
npm link           # registers the global `visualgit` command
```

Then, from anywhere:

```bash
visualgit                  # open the repository in the current directory
visualgit /path/to/repo    # open a specific repository
visualgit --port 5000      # use a specific port
visualgit --no-open        # don't open the browser; just print the URL
visualgit --help
```

The command starts a local server, prints the URL, and opens it in your browser:

```text
  Visual Git is running.

  Repository:  /Users/you/Documents/Projects/some-repo
  Open:        http://127.0.0.1:4127/?path=%2FUsers%2Fyou%2F...

  Press Ctrl+C to stop.
```

It picks the first free port starting at 4127, serves the built UI and the API
from that single port, and loads the target repository automatically.

To uninstall the global command: `npm unlink -g visual-git`.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL printed by the terminal, then enter an absolute path to a local repository, for example:

```text
/Users/you/Documents/Projects/some-repo
```

The app reads repository data through the local `git` CLI and does not write to the selected repository.

## What It Shows

- Top-down topological commit diagram from local branches, remote branches, tags, and `HEAD`
- Automatic default-branch detection and structured ref badges
- Per-commit changed files with `+/-` counts and inline unified diff viewer
- Working-tree status and working-copy file diffs
- Branch comparison (`base...head` ahead/behind counts, graph highlighting, and file diffs)
- Cards and Compact density views, virtualized scrolling, interactive minimap, and zoom / fit controls
- Live `.git` watching for automatic updates, folder autocomplete, search match stepping, keyboard navigation (`j`/`k`/`p`/`/`/`d`), and shareable `?path=&commit=` URLs
- Light and dark themes with a collapsible sidebar

## Scripts

```bash
npm test
npm run build
npm run dev
npm start          # run the CLI against the current directory
```
