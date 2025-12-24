# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TerminalGrid is a VS Code extension that enables keyboard-driven terminal grid management by moving terminals to the editor area (where vertical splitting is supported). It optionally auto-launches CLI tools like Claude Code, Aider, or Codex in new terminals.

## Development

Use **bun** instead of npm:

```bash
bun install          # Install dependencies
bun run compile      # Compile TypeScript to out/
bun run watch        # Compile with watch mode
bun run lint         # Run ESLint on src/
bun test             # Run vitest tests
```

## TDD Workflow

Always follow Test-Driven Development:
1. **Red**: Write a failing test first
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Clean up while keeping tests green

Tests are in `src/test/extension.test.ts` using vitest.

## Packaging & Publishing

```bash
bun add -g @vscode/vsce  # Install VS Code Extension CLI
vsce package              # Create .vsix file
```

CI/CD auto-publishes to VS Code Marketplace on push to master.

## Architecture

- `src/extension.ts` - Main extension logic (terminal management, crash recovery, status tracking)
- `src/utils.ts` - Utility functions (folder naming, process detection)
- `package.json` - Extension manifest (commands, keybindings, configuration)

### Key Features

1. **Terminal Grid**: Opens terminals in editor area for full grid control
2. **Crash Recovery**: Saves terminal state every 5s, restores on crash
3. **Status Bar**: Shows Claude session status (🟡 active, 🟢 standby, ⚪ shell)
4. **Auto-naming**: Names terminals by their working directory folder

### Commands

- `Cmd+K Cmd+Down`: Split down + open terminal
- `Cmd+K Cmd+Right`: Split right + open terminal
- `Cmd+K Cmd+N`: Open new terminal
- `Cmd+K Cmd+R`: Refresh terminals (rename by folder)
- Click status bar: Show terminal status list

## Manual Testing

1. Run `bun run compile`
2. Press F5 in VS Code to launch Extension Development Host
3. Test keyboard shortcuts and status bar functionality
