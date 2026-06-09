# Visual Git

Visual Git is a local web app for inspecting existing projects that already have Git initialized.

## Run

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

## Scripts

```bash
npm test
npm run build
npm run dev
```
