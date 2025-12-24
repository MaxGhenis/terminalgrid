# TerminalGrid

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/MaxGhenis.terminalgrid?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=MaxGhenis.terminalgrid)
[![GitHub Release](https://img.shields.io/github/v/release/MaxGhenis/terminalgrid)](https://github.com/MaxGhenis/terminalgrid/releases/latest)

Transform VS Code into a powerful terminal workspace with keyboard-driven grid management and optional auto-launch for CLI tools.

## Features

- **🎹 Keyboard-Driven Grid Management**: Create complex terminal layouts with simple shortcuts
- **🚀 Optional Auto-Launch**: Run any command in every new terminal (AI tools, dev servers, etc.)
- **🖼️ Image Support**: Paste screenshots directly into terminals (unlike native terminal grids)
- **💾 Persistent Sessions**: Your terminal sessions persist across VS Code restarts
- **⚙️ Simple Configuration**: One setting to rule them all

## Why TerminalGrid?

VS Code's integrated terminal only supports horizontal splitting (side-by-side). There's no native way to stack terminals vertically or create complex grids. This has been requested for years in VS Code issues [#56112](https://github.com/microsoft/vscode/issues/56112), [#160501](https://github.com/microsoft/vscode/issues/160501), and [#162710](https://github.com/microsoft/vscode/issues/162710), but hasn't been implemented.

**TerminalGrid solves this** by moving terminals to the editor area, where you get full horizontal and vertical split control.

Additionally, **image pasting in native terminals is unreliable** for Claude Code and other AI tools (see issues [#1361](https://github.com/anthropics/claude-code/issues/1361), [#5392](https://github.com/anthropics/claude-code/issues/5392), [#834](https://github.com/anthropics/claude-code/issues/834)). VS Code's terminal integration provides much better support for pasting screenshots and dragging files.

**For AI-driven coding:**
Run multiple concurrent AI coding sessions in a clean grid layout. Paste screenshots reliably for visual debugging. Manage everything from one workspace instead of scattered terminal windows.

**For regular development:**
Keyboard-driven terminal management is useful even without auto-launch. Quickly create complex grid layouts for dev servers, test runners, log monitoring, and interactive shells.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K Cmd+Down` (Mac)<br>`Ctrl+K Ctrl+Down` (Win/Linux) | Split down and open terminal |
| `Cmd+K Cmd+Right` (Mac)<br>`Ctrl+K Ctrl+Right` (Win/Linux) | Split right and open terminal |
| `Cmd+K Cmd+N` (Mac)<br>`Ctrl+K Ctrl+N` (Win/Linux) | Open new terminal |
| `Cmd+1/2/3/4` (Mac)<br>`Ctrl+1/2/3/4` (Win/Linux) | Jump to specific terminal pane |

## Installation

**VS Code Marketplace (recommended):**

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "TerminalGrid"
4. Click Install

Or install via command line:
```bash
code --install-extension MaxGhenis.terminalgrid
```

**Manual Installation:**

Download the `.vsix` from [GitHub Releases](https://github.com/MaxGhenis/terminalgrid/releases/latest), then:
- In VS Code: Extensions → `...` menu → "Install from VSIX..."

## Configuration

### **`terminalgrid.autoLaunchCommand`**

Command to run when opening a new terminal. Leave empty for plain terminals.

**Examples:**

```json
{
  "terminalgrid.autoLaunchCommand": "claude --dangerously-skip-permissions"
}
```

```json
{
  "terminalgrid.autoLaunchCommand": "aider --auto-commits"
}
```

```json
{
  "terminalgrid.autoLaunchCommand": "codex"
}
```

```json
{
  "terminalgrid.autoLaunchCommand": "gh copilot"
}
```

**Popular AI Coding CLI Tools:**
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)** - `claude` (Anthropic)
- **[Codex CLI](https://github.com/openai/codex)** - `codex` (OpenAI)
- **[Gemini CLI](https://cloud.google.com/gemini)** - `gemini` (Google, free)
- **[GitHub Copilot CLI](https://github.com/features/copilot)** - `gh copilot` (GitHub/Microsoft)
- **[Aider](https://aider.chat)** - `aider` (open source)
- **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** - `openhands` (open source)

### Other Settings

**`terminalgrid.enableTerminalsInEditor`**
Open terminals in editor area for full grid control (default: `true`)

**`terminalgrid.enablePersistentSessions`**
Restore terminal sessions across restarts (default: `true`)

**`terminalgrid.autoConfigureOnInstall`**
Auto-configure settings on first install (default: `true`)

## Quick Setup

1. **Open Settings** (`Cmd+,` / `Ctrl+,`)
2. **Search** for "TerminalGrid"
3. **Set** `Auto Launch Command` to your preferred tool (or leave empty)
4. **Done!** Use the keyboard shortcuts to build your grid

## Example Workflow: Claude Code Superterminal

```
┌─────────────────┬─────────────────┐
│  Claude Code    │  Claude Code    │
│  (Policy work)  │  (PR review)    │
├─────────────────┼─────────────────┤
│  Claude Code    │  Claude Code    │
│  (Grant draft)  │  (Email/admin)  │
└─────────────────┴─────────────────┘
```

**Setup:**
```json
{
  "terminalgrid.autoLaunchCommand": "claude --dangerously-skip-permissions"
}
```

**Usage:**
1. `Cmd+K Cmd+Right` → Claude Code starts in right pane
2. `Cmd+K Cmd+Down` in left pane → Claude Code starts below
3. `Cmd+K Cmd+Down` in right pane → Claude Code starts below
4. **2x2 grid of Claude Code sessions ready!**

## Example Workflow: Development (No Auto-Launch)

```
┌─────────────────┬─────────────────┐
│  npm run dev    │  git status     │
├─────────────────┼─────────────────┤
│  pytest         │  python shell   │
└─────────────────┴─────────────────┘
```

**Setup:**
```json
{
  "terminalgrid.autoLaunchCommand": ""
}
```

Use `Cmd+K Cmd+Down/Right/N` to quickly create your grid!

## Requirements

- VS Code 1.80.0 or higher
- Optional: CLI tools you want to auto-launch

## What It Configures

TerminalGrid automatically sets up:

1. **Terminal Location**: Moves terminals to editor area for full split control
2. **Terminal Profile**: Creates profile with your auto-launch command
3. **Persistent Sessions**: Enables session persistence across restarts
4. **Keyboard Shortcuts**: Adds grid management shortcuts

## Known Issues

- Windows shell initialization may vary by configuration
- If using `--dangerously-skip-permissions` with Claude Code, ensure you trust your workspace

## Contributing

Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/MaxGhenis/terminalgrid).

## Credits

Created by [Max Ghenis](https://maxghenis.com).

Inspired by a workflow developed while leading [PolicyEngine](https://policyengine.org), where we use AI to model tax and benefit policies.

Read the blog post: [Turning VS Code into a Claude Code Superterminal](#) *(coming soon)*

## License

MIT
