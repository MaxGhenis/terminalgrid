# Development Guide

## Testing the Extension Locally

1. **Open the extension project in VS Code:**
   ```bash
   code /Users/maxghenis/PolicyEngine/claude-code-superterminal-extension
   ```

2. **Install dependencies (if not already done):**
   ```bash
   npm install
   ```

3. **Compile the TypeScript code:**
   ```bash
   npm run compile
   ```

4. **Launch the Extension Development Host:**
   - Press `F5` in VS Code
   - OR: Run > Start Debugging
   - This will open a new VS Code window with the extension loaded

5. **Test the functionality:**
   - In the Extension Development Host window, open any folder
   - The extension should automatically detect your claude installation
   - Try the keyboard shortcuts:
     - `Cmd+K Cmd+N` - Open new Claude Code terminal
     - `Cmd+K Cmd+Right` - Split right and open terminal
     - `Cmd+K Cmd+Down` - Split down and open terminal
   - Check that Claude Code launches automatically in new terminals

## Development Workflow

### Watch mode for automatic compilation:
```bash
npm run watch
```

This will recompile TypeScript files automatically when you make changes.

### Making changes:
1. Edit files in `src/extension.ts`
2. The watch command will recompile automatically
3. In the Extension Development Host window, run `Developer: Reload Window` to reload the extension

## Publishing to VS Code Marketplace

### Prerequisites

1. **Create a Visual Studio Marketplace publisher account:**
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with your Microsoft account
   - Create a publisher with ID `maxghenis` (must match `package.json`)

2. **Install vsce (Visual Studio Code Extensions manager):**
   ```bash
   npm install -g @vscode/vsce
   ```

3. **Create a Personal Access Token:**
   - Go to https://dev.azure.com/
   - User Settings > Personal Access Tokens > New Token
   - Name: "VS Code Marketplace"
   - Organization: All accessible organizations
   - Scopes: Custom defined > Marketplace > Manage
   - Create and save the token

### Publishing Steps

1. **Login to vsce:**
   ```bash
   vsce login maxghenis
   ```
   Enter your Personal Access Token when prompted.

2. **Package the extension (optional - for testing):**
   ```bash
   vsce package
   ```
   This creates a `.vsix` file you can share or install manually.

3. **Publish to Marketplace:**
   ```bash
   vsce publish
   ```

   Or publish with a version bump:
   ```bash
   vsce publish patch  # 0.1.0 -> 0.1.1
   vsce publish minor  # 0.1.0 -> 0.2.0
   vsce publish major  # 0.1.0 -> 1.0.0
   ```

### Manual Installation from .vsix

If you want to install the extension locally without publishing:

```bash
# Package the extension
vsce package

# Install in VS Code
code --install-extension claude-code-superterminal-0.1.0.vsix
```

## Project Structure

```
claude-code-superterminal-extension/
├── src/
│   └── extension.ts          # Main extension code
├── out/                       # Compiled JavaScript (generated)
├── node_modules/             # Dependencies (generated)
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
├── .gitignore
├── .vscodeignore            # Files to exclude from package
├── README.md                # User-facing documentation
├── LICENSE
└── DEVELOPMENT.md           # This file
```

## Debugging

1. **Set breakpoints** in `src/extension.ts`
2. **Press F5** to launch Extension Development Host
3. **Trigger commands** in the Extension Development Host
4. Breakpoints will pause execution in the main VS Code window

## Common Issues

### Extension not activating
- Check the Output panel (View > Output) and select "Extension Host"
- Look for error messages related to "claude-code-superterminal"

### Commands not working
- Verify the extension is activated: check the Extensions view
- Try reloading the Extension Development Host window
- Check that keybindings aren't conflicting with other extensions

### Claude path not detected
- Run `Claude Code Superterminal: Setup` command manually
- Configure the path in Settings > Claude Code Superterminal > Claude Path

## Next Steps

- Add tests using VS Code's testing framework
- Add CI/CD for automated building and publishing
- Add telemetry (optional) for usage analytics
- Create demo GIF/video for README

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
