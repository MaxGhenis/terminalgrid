# TerminalGrid

Transform VS Code into a powerful terminal workspace with keyboard-driven grid management and optional auto-launch for CLI tools.

## Features

- **🎹 Keyboard-Driven Grid Management**: Create complex terminal layouts with simple shortcuts
- **🚀 Optional Auto-Launch**: Run any command in every new terminal (AI tools, dev servers, etc.)
- **🖼️ Image Support**: Paste screenshots directly into terminals (unlike native terminal grids)
- **💾 Persistent Sessions**: Your terminal sessions persist across VS Code restarts
- **⚙️ Simple Configuration**: One setting to rule them all

## Why TerminalGrid?

If you're doing a lot of AI-driven coding, you probably run multiple concurrent AI sessions—different agents working on different parts of your codebase, testing different approaches, or handling separate tasks simultaneously.

TerminalGrid gives you the interface AI coding workflows need:
- **Run 5-6 concurrent AI coding sessions** in a clean grid layout
- **Paste screenshots** for visual debugging and UI feedback
- **Avoid crashes** from multiple VS Code instances
- **Manage everything from one workspace** instead of scattered terminals

This works whether you're using AI agents purely for coding, or (like me) also for reviewing PRs, drafting docs, and other non-coding tasks.

**But it's also great for regular development!** Use it just for the keyboard shortcuts and grid management, even without auto-launch.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K Cmd+Down` (Mac)<br>`Ctrl+K Ctrl+Down` (Win/Linux) | Split down and open terminal |
| `Cmd+K Cmd+Right` (Mac)<br>`Ctrl+K Ctrl+Right` (Win/Linux) | Split right and open terminal |
| `Cmd+K Cmd+N` (Mac)<br>`Ctrl+K Ctrl+N` (Win/Linux) | Open new terminal |
| `Cmd+1/2/3/4` (Mac)<br>`Ctrl+1/2/3/4` (Win/Linux) | Jump to specific terminal pane |

## Installation

1. Install from VS Code Marketplace: Search for "TerminalGrid"
2. Configure your auto-launch command (or leave empty for plain terminals)
3. Start creating your grid!

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
