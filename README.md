# TerminalGrid

Transform VS Code into a powerful terminal workspace with keyboard-driven grid management and optional auto-launch for AI coding tools.

## Features

- **🎹 Keyboard-Driven Grid Management**: Create complex terminal layouts with simple shortcuts
- **🚀 Optional Auto-Launch**: Automatically start CLI tools (Claude Code, Aider, etc.) in every terminal
- **🖼️ Image Support**: Paste screenshots directly into terminals (unlike native terminal grids)
- **💾 Persistent Sessions**: Your terminal sessions persist across VS Code restarts
- **⚙️ Flexible Configuration**: Use with any CLI tool or just for grid management

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
2. Choose your preset via `TerminalGrid: Select Tool Preset` command
3. Start creating your grid!

## Presets

TerminalGrid comes with built-in presets for popular AI coding tools:

### **None** (Default)
Plain terminals with grid management only. Perfect if you just want better keyboard shortcuts.

### **Claude Code**
Auto-launches [Claude Code](https://docs.claude.com/en/docs/claude-code) with `--dangerously-skip-permissions`. Anthropic's AI pair programmer with agentic capabilities.

### **Codex CLI**
Auto-launches [Codex CLI](https://github.com/openai/codex). OpenAI's terminal coding agent. Open source, runs locally.

### **Gemini CLI**
Auto-launches [Gemini CLI](https://cloud.google.com/gemini). Google's free AI coding assistant (60 requests/min with free account).

### **GitHub Copilot CLI**
Auto-launches GitHub Copilot in the terminal (GitHub/Microsoft). Requires `gh` CLI and Copilot subscription.

### **Aider**
Auto-launches [Aider](https://aider.chat). Open source AI pair programming with Git integration and multi-file editing.

### **OpenHands**
Auto-launches [OpenHands](https://github.com/All-Hands-AI/OpenHands). Open source AI coding agent.

### **Custom**
Configure your own command:
```json
{
  "terminalgrid.preset": "custom",
  "terminalgrid.customCommand": "/path/to/your/tool",
  "terminalgrid.customCommandArgs": "--your-flags"
}
```

## Configuration

Access settings via `Preferences > Settings > TerminalGrid`:

### **`terminalgrid.preset`**
Select which tool to auto-launch:
- `none` - Plain terminal (default)
- `claude-code` - Auto-launch Claude Code
- `aider` - Auto-launch Aider
- `custom` - Custom command

### **`terminalgrid.customCommand`**
Path to custom command (when preset is `custom`)

### **`terminalgrid.customCommandArgs`**
Arguments for custom command

### **`terminalgrid.enableTerminalsInEditor`**
Open terminals in editor area for full grid control (default: `true`)

### **`terminalgrid.enablePersistentSessions`**
Restore terminal sessions across restarts (default: `true`)

### **`terminalgrid.autoConfigureOnInstall`**
Auto-configure settings on first install (default: `true`)

## Quick Setup

1. **Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. **Run** `TerminalGrid: Select Tool Preset`
3. **Choose** your preferred tool or "None" for plain terminals

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

1. Set preset to `claude-code`
2. Open VS Code in your project root
3. `Cmd+K Cmd+Right` → Claude Code starts in right pane
4. `Cmd+K Cmd+Down` in left pane → Claude Code starts below
5. `Cmd+K Cmd+Down` in right pane → Claude Code starts below
6. **2x2 grid of Claude Code sessions ready!**

## Example Workflow: Development (No Auto-Launch)

```
┌─────────────────┬─────────────────┐
│  npm run dev    │  git status     │
├─────────────────┼─────────────────┤
│  pytest         │  python shell   │
└─────────────────┴─────────────────┘
```

1. Keep preset as `none`
2. Use `Cmd+K Cmd+Down/Right/N` to quickly create your grid
3. Enjoy keyboard-driven terminal management!

## Requirements

- VS Code 1.80.0 or higher
- Optional: CLI tools you want to auto-launch (Claude Code, Aider, etc.)

## What It Configures

TerminalGrid automatically sets up:

1. **Terminal Location**: Moves terminals to editor area for full split control
2. **Terminal Profile**: Creates profile with optional auto-launch
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
