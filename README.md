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

- Real commits from `git log --all --topo-order --date-order`
- Branch and tag decorations
- Merge edges and graph lanes
- Current branch, HEAD, working-tree status, and changed-file count
- Commit details and filtering
- Light and dark themes, collapsible sidebar, and zoom / fit-to-view controls

## Scripts

```bash
npm test
npm run build
npm run dev
npm start          # run the CLI against the current directory
```
