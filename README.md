# <img src="packaging/visualgit.png" width="44" height="44" align="absmiddle" alt="Visual Git icon" /> Visual Git

Visual Git is a local web app that draws a project's Git history as a map and explains it in plain words. It is made for people who do not know Git yet.

## Install

Visual Git runs entirely on your own computer. Neither installer needs administrator rights or sudo.

### Windows

1. Get `visual-git-<version>.zip` (see [Making a release](#making-a-release)) and unzip it anywhere.
2. Double-click `install.cmd`. If Windows shows "Windows protected your PC", choose **More info → Run anyway**.

The installer copies Visual Git to `%LOCALAPPDATA%\VisualGit`, adds a Start Menu shortcut and the `visualgit` command for your user, and asks for the name and email Git puts on save points. Only when they are missing, it downloads private copies of Node.js (from nodejs.org, checksum verified) and Git (MinGit, from the Git for Windows releases) into that same folder. Nothing system-wide changes. `uninstall.cmd` removes it all.

No internet on that machine? Put the Node.js "Windows Binary (.zip)" and a MinGit `.zip` next to `install.cmd` before running it, and the installer uses them instead of downloading.

To try it without installing, double-click `visualgit.cmd` (needs Node.js 20+ and Git already present).

### macOS and Linux

```bash
tar -xzf visual-git-<version>.tar.gz
sh visual-git/install.sh
```

This installs to `~/.local/share/visual-git` with the command at `~/.local/bin/visualgit`, and downloads a private Node.js only if Node 20+ is missing. Remove it with `sh ~/.local/share/visual-git/install.sh --uninstall`.

### With npm (if Node.js is already installed)

```bash
npm install -g /path/to/visual-git   # a checkout or a packed .tgz
```

On Windows a global npm install goes into your user profile and also needs no admin rights. The installed package has no runtime dependencies.

## Command line

```bash
visualgit                  # open the repository in the current directory
visualgit /path/to/repo    # open a specific repository
visualgit --port 5000      # use a specific port
visualgit --no-open        # don't open the browser; just print the URL
visualgit --read-only      # turn off every action that changes the repository
visualgit --version
visualgit --help
```

Started outside a repository (for example from the Start Menu), it opens a screen for picking a project folder. It picks the first free port starting at 4127 and serves the UI and the API from that single port.

## Making a release

```bash
npm install
npm run release
```

This builds the UI, bundles the server into one dependency-free file (`build/cli.mjs`), and writes `release/visual-git/` plus `release/visual-git-<version>.zip` (Windows) and `.tar.gz` (macOS/Linux). The archives are about 1 MB and work on any machine with or without Node.js. The installer and launcher sources live in `packaging/`.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL printed by the terminal, then enter an absolute path to a local repository, for example:

```text
/Users/you/Documents/Projects/some-repo
```

Looking around never changes a repository. Visual Git only changes one when you confirm one of its built-in actions (include or leave out files, save a commit, switch branch, create a branch). Start it with `--read-only` to turn those off.

## What It Shows

- A rail map of history: one row per commit (oldest at the top), one coloured track per branch, tracks reused once a branch has merged, dated headings, and a "You are here" marker on the checked-out commit
- Plain wording first with the Git term beside it ("Save point (commit)"); every term opens its entry in the built-in Guide and glossary
- A status line that says which branch you are on, how many files are unsaved, and the next step
- Unsaved edits drawn as a dashed stop after "You are here", grouped into ready to save, not included yet, and new files, with per-file diffs
- Safe actions, each showing what will happen and the equivalent Git command: stage, unstage, commit, switch branch, create a branch (also from any commit)
- Per-commit changed files with inline and side-by-side diffs, branch comparison with map highlighting, search with match stepping, follow-a-branch tracing
- Three looks: Transit map (default), Logbook, and Blueprint
- Live `.git` watching, folder autocomplete, keyboard navigation (`j`/`k`/`p`/`/`/`d`), and shareable `?path=&commit=` URLs

## Scripts

```bash
npm test
npm run build
npm run dev
npm start          # run the CLI against the current directory
npm run release    # build the installable archives in release/
```
