Visual Git
==========

See a project's Git history as a map, explained in plain words.

WINDOWS (no admin rights needed)
  1. Unzip this folder anywhere, for example your Desktop.
  2. Double-click install.cmd.
     If Windows shows "Windows protected your PC", click "More info", then
     "Run anyway". That is the normal warning for downloaded scripts and
     does not need admin rights.
     It copies Visual Git into your user profile, adds a Start Menu shortcut
     and the "visualgit" command, and, only if they are missing, downloads
     private copies of Node.js and Git into the same folder.
  3. Open "Visual Git" from the Start Menu, or open a new terminal in any
     project folder and type:  visualgit

  Just trying it? Skip the install and double-click visualgit.cmd.
  That works as long as Node.js and Git are already on the computer.

  No internet on that computer? Download these on another machine, put them
  next to install.cmd, and run install.cmd as usual:
    - Node.js "Windows Binary (.zip)" from https://nodejs.org/en/download
    - "MinGit" 64-bit .zip from https://github.com/git-for-windows/git/releases

  To remove it: double-click uninstall.cmd (or run it from the installed
  folder, %LOCALAPPDATA%\VisualGit).

MACOS AND LINUX (no sudo needed)
  1. Unpack this folder anywhere.
  2. In a terminal:  sh install.sh
  3. In any project folder:  visualgit

  To remove it:  sh install.sh --uninstall

OPTIONS
  visualgit [folder]      open a specific project
  visualgit --read-only   look only; turn off every action that changes a project
  visualgit --help        all options
