import * as vscode from 'vscode';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getFolderName, createFolderQuickPickItems, isBrowseOption, isClaudeProcess } from './utils';

const execAsync = promisify(exec);

interface SavedTerminal {
    cwd: string;
    name?: string;
}

interface TerminalState {
    terminals: SavedTerminal[];
    savedAt: number;
    gracefulExit: boolean;
}

const TERMINAL_STATE_KEY = 'terminalGridState';
const SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const ICON_UPDATE_INTERVAL_MS = 3000; // Update icons every 3 seconds

let saveInterval: NodeJS.Timeout | undefined;
let iconUpdateInterval: NodeJS.Timeout | undefined;
let terminalCwdMap: Map<string, string> = new Map();

// Icons for terminal creation
const TERMINAL_ICON = new vscode.ThemeIcon('terminal', new vscode.ThemeColor('terminal.ansiGreen'));

// Status bar item for showing Claude status
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Check if a terminal is running Claude Code
 */
async function isTerminalRunningClaude(terminal: vscode.Terminal): Promise<boolean> {
    try {
        const pid = await terminal.processId;
        if (!pid) return false;

        // Get child processes of this terminal's shell
        const { stdout } = await execAsync(
            `pgrep -P ${pid} | xargs -I{} ps -o comm= -p {} 2>/dev/null || true`
        );

        // Check if any child process is Claude
        const processes = stdout.trim().split('\n').filter(p => p.trim());
        return processes.some(p => isClaudeProcess(p));
    } catch {
        return false;
    }
}

/**
 * Update status bar with Claude terminal count
 */
async function updateStatusBar() {
    if (!statusBarItem) return;

    let claudeCount = 0;
    let shellCount = 0;

    for (const terminal of vscode.window.terminals) {
        try {
            const isRunningClaude = await isTerminalRunningClaude(terminal);
            if (isRunningClaude) {
                claudeCount++;
            } else {
                shellCount++;
            }
        } catch {
            shellCount++;
        }
    }

    if (claudeCount > 0 || shellCount > 0) {
        statusBarItem.text = `$(terminal) ${claudeCount > 0 ? `🟡${claudeCount}` : ''}${shellCount > 0 ? ` 🟢${shellCount}` : ''}`;
        statusBarItem.tooltip = `Claude: ${claudeCount} | Shell: ${shellCount}`;
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

function getTerminalKey(terminal: vscode.Terminal): string {
    // Use terminal name + creation order as key since processId is async
    return `${terminal.name}-${terminal.creationOptions?.name || 'default'}`;
}

async function configureTerminalSettings() {
    const config = vscode.workspace.getConfiguration('terminalgrid');
    const globalConfig = vscode.workspace.getConfiguration();

    const enableInEditor = config.get('enableTerminalsInEditor', true);
    const enablePersistent = config.get('enablePersistentSessions', true);

    // Configure terminal location and persistence
    if (enableInEditor) {
        await globalConfig.update('terminal.integrated.defaultLocation', 'editor', vscode.ConfigurationTarget.Global);
    }

    if (enablePersistent) {
        await globalConfig.update('terminal.integrated.enablePersistentSessions', true, vscode.ConfigurationTarget.Global);
        await globalConfig.update('terminal.integrated.hideOnStartup', 'never', vscode.ConfigurationTarget.Global);
    }

    // Enable shell integration for directory tracking
    await globalConfig.update('terminal.integrated.shellIntegration.enabled', true, vscode.ConfigurationTarget.Global);

    // Configure terminal profile based on autoLaunchCommand
    const autoLaunchCommand = config.get<string>('autoLaunchCommand', '').trim();

    const platform = os.platform();
    const profileKey = platform === 'darwin' ? 'terminal.integrated.profiles.osx' :
                       platform === 'win32' ? 'terminal.integrated.profiles.windows' :
                       'terminal.integrated.profiles.linux';

    const defaultProfileKey = platform === 'darwin' ? 'terminal.integrated.defaultProfile.osx' :
                               platform === 'win32' ? 'terminal.integrated.defaultProfile.windows' :
                               'terminal.integrated.defaultProfile.linux';

    const shell = platform === 'win32' ? 'powershell.exe' :
                  platform === 'darwin' ? 'zsh' : 'bash';

    const profiles = globalConfig.get(profileKey) || {};

    if (!autoLaunchCommand) {
        // Just use default shell
        await globalConfig.update(defaultProfileKey, shell, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('TerminalGrid configured with default shell');
        return;
    }

    // Build shell args to launch the command
    let shellArgs: string[];
    if (platform === 'win32') {
        shellArgs = ['-NoExit', '-Command', `& '${autoLaunchCommand}'`];
    } else {
        shellArgs = ['-l', '-c', `source ~/.${shell}rc 2>/dev/null; ${autoLaunchCommand}; exec ${shell}`];
    }

    const updatedProfiles = {
        ...profiles,
        'TerminalGrid': {
            path: shell,
            args: shellArgs
        },
        [shell]: {
            path: shell
        }
    };

    await globalConfig.update(profileKey, updatedProfiles, vscode.ConfigurationTarget.Global);
    await globalConfig.update(defaultProfileKey, 'TerminalGrid', vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage('TerminalGrid configured!');
}

function getTerminalCwd(terminal: vscode.Terminal): string | undefined {
    // Try shell integration first (most reliable)
    const shellIntegration = (terminal as any).shellIntegration;
    if (shellIntegration?.cwd) {
        const cwdUri = shellIntegration.cwd;
        if (cwdUri instanceof vscode.Uri) {
            return cwdUri.fsPath;
        }
        return String(cwdUri);
    }

    // Fall back to stored cwd from our tracking
    return terminalCwdMap.get(getTerminalKey(terminal));
}

function collectTerminalState(): SavedTerminal[] {
    const terminals: SavedTerminal[] = [];

    for (const terminal of vscode.window.terminals) {
        const cwd = getTerminalCwd(terminal);
        if (cwd) {
            terminals.push({
                cwd,
                name: terminal.name
            });
        }
    }

    return terminals;
}

async function saveTerminalState(context: vscode.ExtensionContext, gracefulExit: boolean = false) {
    const terminals = collectTerminalState();

    if (terminals.length === 0 && !gracefulExit) {
        // Don't save empty state unless it's a graceful exit
        return;
    }

    const state: TerminalState = {
        terminals,
        savedAt: Date.now(),
        gracefulExit
    };

    await context.globalState.update(TERMINAL_STATE_KEY, state);
    console.log(`TerminalGrid: Saved ${terminals.length} terminal states`);
}

async function restoreTerminals(context: vscode.ExtensionContext): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('terminalgrid');
    const enableRestore = config.get('enableDirectoryRestore', true);

    if (!enableRestore) {
        return false;
    }

    const state = context.globalState.get<TerminalState>(TERMINAL_STATE_KEY);

    if (!state) {
        return false;
    }

    // If last session exited gracefully, VS Code's built-in persistence should handle it
    if (state.gracefulExit) {
        console.log('TerminalGrid: Last session exited gracefully, skipping restore');
        await context.globalState.update(TERMINAL_STATE_KEY, undefined);
        return false;
    }

    // Check if state is recent (within last hour)
    const ageMs = Date.now() - state.savedAt;
    const maxAgeMs = 60 * 60 * 1000; // 1 hour

    if (ageMs > maxAgeMs) {
        console.log('TerminalGrid: Saved state too old, skipping restore');
        await context.globalState.update(TERMINAL_STATE_KEY, undefined);
        return false;
    }

    if (state.terminals.length === 0) {
        return false;
    }

    const autoLaunchCommand = config.get<string>('autoLaunchCommand', '').trim();
    const autoNameByFolder = config.get('autoNameByFolder', true);

    // Check if there are already terminals open (VS Code restored them)
    if (vscode.window.terminals.length > 0) {
        console.log('TerminalGrid: VS Code restored terminals, but we need to replace them with correct cwds/names');

        // Kill VS Code's restored terminals - they have wrong cwds and names
        const existingTerminals = [...vscode.window.terminals];
        for (const terminal of existingTerminals) {
            terminal.dispose();
        }

        // Wait for terminals to close
        await new Promise(resolve => setTimeout(resolve, 500));

        // Now create our terminals with correct cwds and names
        console.log(`TerminalGrid: Creating ${state.terminals.length} terminals with saved cwds/names`);

        for (const savedTerminal of state.terminals) {
            const terminalName = savedTerminal.name ||
                (autoNameByFolder ? getFolderName(savedTerminal.cwd) : undefined);

            const terminalOptions: vscode.TerminalOptions = {
                cwd: savedTerminal.cwd,
                name: terminalName,
                iconPath: TERMINAL_ICON
            };

            console.log(`TerminalGrid: Creating terminal "${terminalName}" in ${savedTerminal.cwd}`);
            const terminal = vscode.window.createTerminal(terminalOptions);

            // Track the cwd immediately
            terminalCwdMap.set(getTerminalKey(terminal), savedTerminal.cwd);

            if (autoLaunchCommand) {
                setTimeout(() => {
                    terminal.sendText(autoLaunchCommand);
                }, 500);
            }
        }

        vscode.window.showInformationMessage(
            `TerminalGrid: Restored ${state.terminals.length} terminal(s) with saved directories`
        );

        await context.globalState.update(TERMINAL_STATE_KEY, undefined);
        return true;
    }

    console.log(`TerminalGrid: Restoring ${state.terminals.length} terminals from crash`);

    for (const savedTerminal of state.terminals) {
        // Use saved name, or auto-generate from folder if enabled
        const terminalName = savedTerminal.name ||
            (autoNameByFolder ? getFolderName(savedTerminal.cwd) : undefined);

        const terminalOptions: vscode.TerminalOptions = {
            cwd: savedTerminal.cwd,
            name: terminalName,
            iconPath: TERMINAL_ICON
        };

        console.log(`TerminalGrid: Restoring terminal "${terminalName}" in ${savedTerminal.cwd}`);
        const terminal = vscode.window.createTerminal(terminalOptions);

        // Track the cwd immediately
        terminalCwdMap.set(getTerminalKey(terminal), savedTerminal.cwd);

        // If there's an auto-launch command, run it after a short delay
        if (autoLaunchCommand) {
            setTimeout(() => {
                terminal.sendText(autoLaunchCommand);
            }, 500);
        }

        terminal.show();
    }

    // Clear the saved state after restore
    await context.globalState.update(TERMINAL_STATE_KEY, undefined);

    vscode.window.showInformationMessage(
        `TerminalGrid: Restored ${state.terminals.length} terminal(s) from previous session`
    );

    return true;
}

function startPeriodicSave(context: vscode.ExtensionContext) {
    if (saveInterval) {
        clearInterval(saveInterval);
    }

    saveInterval = setInterval(() => {
        saveTerminalState(context);
    }, SAVE_INTERVAL_MS);
}

function trackTerminalCwd(terminal: vscode.Terminal) {
    const key = getTerminalKey(terminal);

    // Try shell integration first (most reliable when shell is active)
    const shellIntegration = (terminal as any).shellIntegration;
    if (shellIntegration?.cwd) {
        const cwd = shellIntegration.cwd;
        const cwdPath = cwd instanceof vscode.Uri ? cwd.fsPath : String(cwd);
        terminalCwdMap.set(key, cwdPath);
        console.log(`TerminalGrid: Tracked cwd via shell integration: ${cwdPath}`);
        return;
    }

    // Try to get cwd from creation options
    const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
    if (creationOptions?.cwd) {
        const cwd = creationOptions.cwd;
        const cwdPath = cwd instanceof vscode.Uri ? cwd.fsPath : String(cwd);
        terminalCwdMap.set(key, cwdPath);
        console.log(`TerminalGrid: Tracked cwd via creationOptions: ${cwdPath}`);
        return;
    }

    // Fall back to workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const cwdPath = workspaceFolders[0].uri.fsPath;
        // Only set if we don't already have a cwd for this terminal
        if (!terminalCwdMap.has(key)) {
            terminalCwdMap.set(key, cwdPath);
            console.log(`TerminalGrid: Tracked cwd via workspace folder: ${cwdPath}`);
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('TerminalGrid is now active');

    // Check if this is first activation
    const hasConfigured = context.globalState.get('hasConfigured', false);
    const autoConfig = vscode.workspace.getConfiguration('terminalgrid').get('autoConfigureOnInstall', true);

    if (!hasConfigured && autoConfig) {
        await configureTerminalSettings();
        await context.globalState.update('hasConfigured', true);
    }

    // Try to restore terminals from crash
    const restored = await restoreTerminals(context);

    // Start periodic state saving
    startPeriodicSave(context);

    // Create status bar item for Claude/shell count
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Start periodic status bar updates
    iconUpdateInterval = setInterval(updateStatusBar, ICON_UPDATE_INTERVAL_MS);
    // Initial update
    updateStatusBar();

    // Track terminal cwds via shell integration
    context.subscriptions.push(
        vscode.window.onDidChangeTerminalShellIntegration((e) => {
            trackTerminalCwd(e.terminal);
        })
    );

    // Track when terminals are opened
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal((terminal) => {
            // Try to track cwd when terminal opens
            setTimeout(() => trackTerminalCwd(terminal), 1000);
        })
    );

    // Track when terminals are closed
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            terminalCwdMap.delete(getTerminalKey(terminal));
        })
    );

    // Register setup command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.setup', async () => {
            await configureTerminalSettings();
            await context.globalState.update('hasConfigured', true);
        })
    );

    // Helper to create a new terminal with folder selection
    const createNamedTerminal = async (skipFolderPrompt: boolean = false) => {
        const config = vscode.workspace.getConfiguration('terminalgrid');
        const autoNameByFolder = config.get('autoNameByFolder', true);
        const promptForFolder = config.get('promptForFolder', true);

        const options: vscode.TerminalOptions = {};
        let selectedFolder: string | undefined;

        if (promptForFolder && !skipFolderPrompt) {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            const homeDir = os.homedir();

            // Use extracted utility to create quick pick items
            const items = createFolderQuickPickItems(workspaceFolders);

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select folder for new terminal',
                title: 'TerminalGrid: New Terminal'
            });

            if (!selected) {
                return undefined; // User cancelled
            }

            if (isBrowseOption(selected)) {
                // Open folder picker dialog
                const folderUri = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    defaultUri: vscode.Uri.file(homeDir),
                    title: 'Select folder for terminal'
                });

                if (!folderUri || folderUri.length === 0) {
                    return undefined; // User cancelled
                }

                selectedFolder = folderUri[0].fsPath;
            } else {
                selectedFolder = selected.description;
            }
        } else {
            // Use first workspace folder if available
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                selectedFolder = workspaceFolders[0].uri.fsPath;
            }
        }

        if (selectedFolder) {
            options.cwd = selectedFolder;
            if (autoNameByFolder) {
                options.name = getFolderName(selectedFolder);
            }
        }

        // Always set icon
        options.iconPath = TERMINAL_ICON;

        console.log(`TerminalGrid: Creating terminal "${options.name}" in ${options.cwd}`);
        const terminal = vscode.window.createTerminal(options);
        terminal.show();

        // Immediately track the cwd so it's saved even if shell integration doesn't report it
        if (selectedFolder) {
            terminalCwdMap.set(getTerminalKey(terminal), selectedFolder);
            console.log(`TerminalGrid: Tracked new terminal cwd: ${selectedFolder}`);
        }

        return terminal;
    };

    // Register split down and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitDownAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
            createNamedTerminal();
        })
    );

    // Register split right and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitRightAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorRight');
            createNamedTerminal();
        })
    );

    // Register open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.openTerminal', async () => {
            createNamedTerminal();
        })
    );

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('terminalgrid.autoLaunchCommand')) {
                await configureTerminalSettings();
            }
        })
    );
}

export async function deactivate() {
    // Stop periodic saves
    if (saveInterval) {
        clearInterval(saveInterval);
        saveInterval = undefined;
    }

    // Stop icon updates
    if (iconUpdateInterval) {
        clearInterval(iconUpdateInterval);
        iconUpdateInterval = undefined;
    }

    // Note: We can't reliably save state here during a crash
    // The periodic saves handle crash recovery
    // For graceful exits, we mark it so VS Code's built-in persistence takes over

    console.log('TerminalGrid deactivating');
}
