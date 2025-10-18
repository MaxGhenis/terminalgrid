# Turning VS Code into a Claude Code Superterminal

*Or: How I stopped looking at code and learned to love concurrent AI sessions*

## The Realization

**I basically don't look at code in VS Code anymore.**

I review PRs on GitHub (though we're building agents for that too—check out our [review agent custom slash command](https://github.com/PolicyEngine/policyengine-us/tree/master/.claude/commands)). The rest of my time? It's just lots of Claude Code sessions running concurrently—reviewing colleagues' contributions, drafting grant applications, writing economics papers, checking emails, scheduling meetings. Technical and non-technical work, all happening in parallel across 5-6 sessions.

Claude Code isn't just a coding tool. It's a **general-purpose AI workspace**. And I realized I was using the wrong interface for it.

I briefly tried using a native terminal grid without VS Code—more lightweight, especially since my VS Code often crashes under the weight of multiple sessions. But there was one dealbreaker: **you can't paste images in native terminals**. I do this constantly with screenshots, and Claude Code's ability to analyze images is non-negotiable for my workflow.

The solution? **Stop treating VS Code like an IDE. Treat it like a Claude Code superterminal.**

## The Setup

With Claude's help (meta!), I transformed VS Code into a purpose-built interface for managing multiple Claude Code sessions. Here's how:

### 1. Terminals in the Editor Area

By default, VS Code's terminal lives in a bottom panel with limited split options. Move it to the editor area for full control:

**Settings** (Cmd+, → settings.json):
```json
{
  "terminal.integrated.defaultLocation": "editor"
}
```

Now terminals are full-class citizens in your editor space with complete horizontal and vertical split control.

### 2. Auto-Launch Claude Code

Create a terminal profile that automatically launches Claude Code with permissions skipped:

```json
{
  "terminal.integrated.profiles.osx": {
    "Claude Code": {
      "path": "zsh",
      "args": [
        "-l",
        "-c",
        "source ~/.zshrc 2>/dev/null; /Users/YOUR_USERNAME/.claude/local/node_modules/.bin/claude --dangerously-skip-permissions; exec zsh"
      ]
    }
  },
  "terminal.integrated.defaultProfile.osx": "Claude Code"
}
```

*(Replace `YOUR_USERNAME` with your actual username. Find your claude path with `which claude`.)*

Every new terminal now launches straight into Claude Code—no permission prompts, no friction.

### 3. Keyboard-Driven Grid Management

Add custom keybindings for lightning-fast grid creation (**keybindings.json**):

```json
[
  {
    "key": "cmd+k cmd+down",
    "command": "runCommands",
    "args": {
      "commands": [
        "workbench.action.splitEditorDown",
        "workbench.action.terminal.new"
      ]
    }
  },
  {
    "key": "cmd+k cmd+right",
    "command": "runCommands",
    "args": {
      "commands": [
        "workbench.action.splitEditorRight",
        "workbench.action.terminal.new"
      ]
    }
  },
  {
    "key": "cmd+k cmd+n",
    "command": "workbench.action.terminal.new"
  }
]
```

**Cmd+K Cmd+Down**: Split down and open Claude Code
**Cmd+K Cmd+Right**: Split right and open Claude Code
**Cmd+K Cmd+N**: New terminal with Claude Code
**Cmd+1/2/3/4**: Jump between terminal panes

### 4. Persistent Sessions

Keep your Claude Code sessions alive across VS Code restarts:

```json
{
  "terminal.integrated.hideOnStartup": "never",
  "terminal.integrated.enablePersistentSessions": true
}
```

Close VS Code, reopen it—your Claude sessions are right where you left them.

## The Workflow

Now my setup looks like this:

```
┌─────────────────┬─────────────────┐
│  Claude Code    │  Claude Code    │
│  (Policy work)  │  (PR review)    │
├─────────────────┼─────────────────┤
│  Claude Code    │  Claude Code    │
│  (Grant draft)  │  (Email/admin)  │
└─────────────────┴─────────────────┘
```

I keep one VS Code window open in the PolicyEngine root folder. No more multiple VS Code instances. No more crashes from overloaded windows. Just a clean grid of concurrent AI sessions, each focused on a different task.

When I need to paste a screenshot for Claude to analyze? Cmd+V. Works perfectly.

When I need another session? **Cmd+K Cmd+Right**. Instant split with Claude Code ready.

## The Bigger Picture

This isn't just about my setup—it's about rethinking how we interact with AI coding tools. We're still in the early days of this technology, and most of our interfaces are inherited from previous paradigms. We treat Claude Code like a better terminal, when maybe it should be the *entire* interface.

At PolicyEngine, we've fully embraced this shift. We use subagents for everything—agents encoding policies work independently from agents writing tests and verifying results, improving accuracy. We're building custom slash commands for code reviews so we spend less time on GitHub and more time orchestrating AI workflows.

When your primary job becomes **managing concurrent AI agents** rather than writing code directly, your tools need to evolve accordingly.

## Try It Yourself

### The Easy Way: TerminalGrid Extension

I've packaged this entire setup into a VS Code extension called [**TerminalGrid**](https://github.com/MaxGhenis/terminalgrid). Install it from the Marketplace and it handles everything automatically:

1. Search "TerminalGrid" in VS Code Extensions
2. Run `TerminalGrid: Select Tool Preset`
3. Choose "Claude Code" (or "None" for just grid management, or "Aider", or your own custom tool)
4. Start using the keyboard shortcuts!

The extension works with any CLI tool—Claude Code, Aider, or your own custom commands. You can even use it just for the grid management without auto-launch.

### The Manual Way: Configure It Yourself

If you prefer full control, follow the configuration in the Appendix below. It takes five minutes to set up manually.

---

Either way, you'll go from managing terminals to orchestrating a grid of AI collaborators.

And if you find strategies for using AI that improve productivity, creativity, and token-efficiency, I'd love to hear them. We're all figuring this out together.

---

*Max Ghenis leads PolicyEngine, where we use AI to model tax and benefit policies. We're hiring engineers who want to work at the intersection of policy, economics, and cutting-edge AI. [Learn more →](https://policyengine.org)*

---

## Appendix: Full Configuration

**settings.json** (Cmd+, → "Open Settings (JSON)"):
```json
{
  "terminal.integrated.defaultLocation": "editor",
  "terminal.integrated.hideOnStartup": "never",
  "terminal.integrated.enablePersistentSessions": true,
  "terminal.integrated.profiles.osx": {
    "Claude Code": {
      "path": "zsh",
      "args": [
        "-l",
        "-c",
        "source ~/.zshrc 2>/dev/null; ~/.claude/local/node_modules/.bin/claude --dangerously-skip-permissions; exec zsh"
      ]
    },
    "zsh": {
      "path": "zsh"
    }
  },
  "terminal.integrated.defaultProfile.osx": "Claude Code"
}
```

**keybindings.json** (Cmd+Shift+P → "Preferences: Open Keyboard Shortcuts (JSON)"):
```json
[
  {
    "key": "cmd+k cmd+down",
    "command": "runCommands",
    "args": {
      "commands": [
        "workbench.action.splitEditorDown",
        "workbench.action.terminal.new"
      ]
    }
  },
  {
    "key": "cmd+k cmd+right",
    "command": "runCommands",
    "args": {
      "commands": [
        "workbench.action.splitEditorRight",
        "workbench.action.terminal.new"
      ]
    }
  },
  {
    "key": "cmd+k cmd+n",
    "command": "workbench.action.terminal.new"
  }
]
```
