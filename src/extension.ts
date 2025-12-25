import * as vscode from 'vscode';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getFolderName, createFolderQuickPickItems, isBrowseOption, isClaudeProcess, deduplicateTerminalsByCwd, hasDuplicateCwds, inferCwdFromName } from './utils';

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

// Shell integration cwd access type (for terminals with shell integration enabled)
interface ShellIntegrationCwd {
    shellIntegration?: {
        cwd?: vscode.Uri | string;
    };
}

const TERMINAL_STATE_KEY = 'terminalGridState';
const SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const ICON_UPDATE_INTERVAL_MS = 3000; // Update icons every 3 seconds

let saveInterval: NodeJS.Timeout | undefined;
let iconUpdateInterval: NodeJS.Timeout | undefined;
const terminalCwdMap: Map<string, string> = new Map();

// Icons for terminal creation
const TERMINAL_ICON = new vscode.ThemeIcon('terminal', new vscode.ThemeColor('terminal.ansiGreen'));

// Status bar item for showing Claude status
let statusBarItem: vscode.StatusBarItem | undefined;

interface ClaudeStatus {
    hasClaude: boolean;
    isActive: boolean;  // true if Claude is running tools (has children)
}

/**
 * Check if a terminal is running Claude Code and if it's actively working
 */
async function getClaudeStatus(terminal: vscode.Terminal): Promise<ClaudeStatus> {
    try {
        const pid = await terminal.processId;
        if (!pid) {
            return { hasClaude: false, isActive: false };
        }

        // Get child processes of this terminal's shell
        const { stdout } = await execAsync(
            `pgrep -P ${pid} | xargs -I{} ps -o pid=,comm= -p {} 2>/dev/null || true`
        );

        // Find Claude process
        const lines = stdout.trim().split('\n').filter(p => p.trim());
        let claudePid: number | null = null;

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const childPid = parseInt(parts[0], 10);
            const comm = parts.slice(1).join(' ');
            if (isClaudeProcess(comm)) {
                claudePid = childPid;
                break;
            }
        }

        if (!claudePid) {
            return { hasClaude: false, isActive: false };
        }

        // Check if Claude has active tool processes (not just MCP servers)
        // Get child process names, not just count
        const { stdout: claudeChildInfo } = await execAsync(
            `pgrep -P ${claudePid} 2>/dev/null | xargs -I{} ps -o comm= -p {} 2>/dev/null || echo ""`
        );

        const childProcesses = claudeChildInfo.trim().split('\n').filter(p => p.trim());

        // Filter out persistent/background processes that don't indicate active work
        const backgroundProcesses = ['node', 'npx', 'npm', 'mcp', 'uvx', 'uv', 'python', 'python3', 'claude'];
        const activeChildren = childProcesses.filter(proc => {
            const name = proc.toLowerCase();
            // Exclude known background processes first (including nested claude binary)
            if (backgroundProcesses.some(bg => name.includes(bg))) {
                return false;
            }
            // These indicate active tool use
            if (name.includes('bash') || name.includes('zsh')) {
                return true;
            }
            if (name.includes('git') || name.includes('grep') || name.includes('find')) {
                return true;
            }
            if (name.includes('cat') || name.includes('ls') || name.includes('rm')) {
                return true;
            }
            // Unknown process - could be active tool, count it
            return true;
        });

        return { hasClaude: true, isActive: activeChildren.length > 0 };
    } catch {
        return { hasClaude: false, isActive: false };
    }
}

// Track terminal status for quick display
interface TerminalStatus {
    terminal: vscode.Terminal;
    name: string;
    hasClaude: boolean;
    isActive: boolean;  // Claude is actively running tools
}

let lastTerminalStatuses: TerminalStatus[] = [];

/**
 * Update status bar with Claude terminal count
 */
async function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }

    let activeCount = 0;    // Claude running tools
    let standbyCount = 0;   // Claude idle
    let shellCount = 0;     // No Claude
    const statuses: TerminalStatus[] = [];

    for (const terminal of vscode.window.terminals) {
        try {
            const claudeStatus = await getClaudeStatus(terminal);
            statuses.push({
                terminal,
                name: terminal.name,
                hasClaude: claudeStatus.hasClaude,
                isActive: claudeStatus.isActive
            });
            if (claudeStatus.hasClaude) {
                if (claudeStatus.isActive) {
                    activeCount++;
                } else {
                    standbyCount++;
                }
            } else {
                shellCount++;
            }
        } catch {
            statuses.push({
                terminal,
                name: terminal.name,
                hasClaude: false,
                isActive: false
            });
            shellCount++;
        }
    }

    lastTerminalStatuses = statuses;

    if (activeCount > 0 || standbyCount > 0 || shellCount > 0) {
        // 🟡 = active Claude, 🟢 = standby Claude, ⚪ = shell
        let text = '$(terminal)';
        if (activeCount > 0) {
            text += ` 🟡${activeCount}`;
        }
        if (standbyCount > 0) {
            text += ` 🟢${standbyCount}`;
        }
        if (shellCount > 0) {
            text += ` ⚪${shellCount}`;
        }
        statusBarItem.text = text;

        // Build tooltip showing which terminals are which
        const activeTerminals = statuses.filter(s => s.hasClaude && s.isActive).map(s => s.name);
        const standbyTerminals = statuses.filter(s => s.hasClaude && !s.isActive).map(s => s.name);
        const shellTerminals = statuses.filter(s => !s.hasClaude).map(s => s.name);

        let tooltip = '';
        if (activeTerminals.length > 0) {
            tooltip += `🟡 Running: ${activeTerminals.join(', ')}`;
        }
        if (standbyTerminals.length > 0) {
            if (tooltip) { tooltip += '\n'; }
            tooltip += `🟢 Standby: ${standbyTerminals.join(', ')}`;
        }
        if (shellTerminals.length > 0) {
            if (tooltip) { tooltip += '\n'; }
            tooltip += `⚪ Shell: ${shellTerminals.join(', ')}`;
        }
        tooltip += '\n\nClick to show terminal list';
        statusBarItem.tooltip = tooltip;
        statusBarItem.command = 'terminalgrid.showTerminalStatus';
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

async function getProcessCwd(pid: number): Promise<string | undefined> {
    try {
        const platform = os.platform();
        console.log(`TerminalGrid: getProcessCwd called for PID ${pid} on ${platform}`);

        if (platform === 'darwin') {
            // First check the process itself (VS Code might return shell PID directly)
            let cmd = `lsof -p ${pid} -Fn 2>/dev/null | grep -A1 '^fcwd' | grep '^n' | cut -c2-`;
            try {
                const { stdout } = await execAsync(cmd);
                const cwd = stdout.trim();
                console.log(`TerminalGrid: PID ${pid} direct cwd: "${cwd}"`);
                if (cwd && cwd.length > 0 && cwd !== os.homedir() && cwd !== '/') {
                    return cwd;
                }
            } catch {
                console.log(`TerminalGrid: Failed to get cwd for PID ${pid}`);
            }

            // Find child shell processes (the actual shell running in the terminal)
            const { stdout: childPids } = await execAsync(`pgrep -P ${pid} 2>/dev/null || echo ""`);
            const children = childPids.trim().split('\n').filter(p => p.trim());
            console.log(`TerminalGrid: Child PIDs of ${pid}: [${children.join(', ')}]`);

            // Check each child process for its cwd
            for (const childPid of children) {
                cmd = `lsof -p ${childPid} -Fn 2>/dev/null | grep -A1 '^fcwd' | grep '^n' | cut -c2-`;
                try {
                    const { stdout } = await execAsync(cmd);
                    const cwd = stdout.trim();
                    console.log(`TerminalGrid: Child ${childPid} cwd: "${cwd}"`);
                    if (cwd && cwd.length > 0 && cwd !== os.homedir() && cwd !== '/') {
                        return cwd;
                    }
                } catch {
                    // Continue to next child
                }

                // Also check grandchildren (shell might spawn subprocesses)
                const { stdout: grandchildPids } = await execAsync(`pgrep -P ${childPid} 2>/dev/null || echo ""`);
                const grandchildren = grandchildPids.trim().split('\n').filter(p => p.trim());
                for (const gcPid of grandchildren) {
                    cmd = `lsof -p ${gcPid} -Fn 2>/dev/null | grep -A1 '^fcwd' | grep '^n' | cut -c2-`;
                    try {
                        const { stdout } = await execAsync(cmd);
                        const cwd = stdout.trim();
                        console.log(`TerminalGrid: Grandchild ${gcPid} cwd: "${cwd}"`);
                        if (cwd && cwd.length > 0 && cwd !== os.homedir() && cwd !== '/') {
                            return cwd;
                        }
                    } catch {
                        // Continue
                    }
                }
            }

            // Last resort: return home dir cwd if that's all we have
            cmd = `lsof -p ${pid} -Fn 2>/dev/null | grep -A1 '^fcwd' | grep '^n' | cut -c2-`;
            try {
                const { stdout } = await execAsync(cmd);
                const cwd = stdout.trim();
                if (cwd && cwd.length > 0) {
                    return cwd;
                }
            } catch {
                // Fall through
            }
        } else if (platform === 'linux') {
            // Similar approach for Linux
            const { stdout: childPids } = await execAsync(`pgrep -P ${pid} 2>/dev/null || echo ""`);
            const children = childPids.trim().split('\n').filter(p => p.trim());

            for (const childPid of children.reverse()) {
                try {
                    const { stdout } = await execAsync(`readlink -f /proc/${childPid}/cwd 2>/dev/null`);
                    const cwd = stdout.trim();
                    if (cwd && cwd.length > 0 && cwd !== os.homedir()) {
                        return cwd;
                    }
                } catch {
                    // Continue
                }
            }

            const { stdout } = await execAsync(`readlink -f /proc/${pid}/cwd 2>/dev/null`);
            const cwd = stdout.trim();
            if (cwd && cwd.length > 0) {
                return cwd;
            }
        }
    } catch (error) {
        console.log(`TerminalGrid: getProcessCwd error for PID ${pid}:`, error);
    }
    return undefined;
}

async function getTerminalCwd(terminal: vscode.Terminal): Promise<string | undefined> {
    // Try shell integration first (most reliable when available)
    const shellIntegration = (terminal as unknown as ShellIntegrationCwd).shellIntegration;
    if (shellIntegration?.cwd) {
        const cwdUri = shellIntegration.cwd;
        if (cwdUri instanceof vscode.Uri) {
            return cwdUri.fsPath;
        }
        return String(cwdUri);
    }

    // Try stored cwd from our tracking
    const storedCwd = terminalCwdMap.get(getTerminalKey(terminal));
    if (storedCwd) {
        return storedCwd;
    }

    // Try to get cwd from the terminal's process
    const pid = await terminal.processId;
    if (pid) {
        const processCwd = await getProcessCwd(pid);
        if (processCwd) {
            // Cache it for future use
            terminalCwdMap.set(getTerminalKey(terminal), processCwd);
            return processCwd;
        }
    }

    return undefined;
}

async function collectTerminalState(): Promise<SavedTerminal[]> {
    const terminals: SavedTerminal[] = [];

    // Get common search paths for inferring cwd from name
    const homeDir = os.homedir();
    const searchPaths = [
        homeDir,
        `${homeDir}/PolicyEngine`,
        `${homeDir}/projects`,
        `${homeDir}/code`,
        `${homeDir}/dev`,
        `${homeDir}/Documents`,
    ];

    // Add workspace folders to search paths
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            searchPaths.push(folder.uri.fsPath);
            // Also add parent of workspace folder
            const parent = folder.uri.fsPath.split('/').slice(0, -1).join('/');
            if (parent && !searchPaths.includes(parent)) {
                searchPaths.push(parent);
            }
        }
    }

    for (const terminal of vscode.window.terminals) {
        let cwd = await getTerminalCwd(terminal);

        if (!cwd) {
            // Try to infer cwd from terminal name
            const inferredCwd = inferCwdFromName(terminal.name, searchPaths);
            if (inferredCwd) {
                cwd = inferredCwd;
                console.log(`TerminalGrid: Inferred cwd for "${terminal.name}": ${cwd}`);
            }
        }

        if (cwd) {
            terminals.push({
                cwd,
                name: terminal.name
            });
            console.log(`TerminalGrid: Collected terminal "${terminal.name}" with cwd: ${cwd}`);
        } else {
            // Last resort: save with home dir so terminal isn't lost
            terminals.push({
                cwd: homeDir,
                name: terminal.name
            });
            console.log(`TerminalGrid: Saved terminal "${terminal.name}" with fallback home dir`);
        }
    }

    return terminals;
}

async function saveTerminalState(context: vscode.ExtensionContext, gracefulExit: boolean = false) {
    const terminals = await collectTerminalState();

    // Debug: log what we're trying to save
    console.log(`TerminalGrid: Collecting state - found ${vscode.window.terminals.length} terminals`);
    console.log(`TerminalGrid: terminalCwdMap has ${terminalCwdMap.size} entries:`, Array.from(terminalCwdMap.entries()));
    console.log(`TerminalGrid: Collected ${terminals.length} terminals with cwds:`, terminals);

    if (terminals.length === 0 && !gracefulExit) {
        // Don't save empty state unless it's a graceful exit
        console.log('TerminalGrid: No terminals to save, skipping');
        return;
    }

    const state: TerminalState = {
        terminals,
        savedAt: Date.now(),
        gracefulExit
    };

    await context.globalState.update(TERMINAL_STATE_KEY, state);
    console.log(`TerminalGrid: Saved ${terminals.length} terminal states to globalState`);
}

async function restoreTerminals(context: vscode.ExtensionContext): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('terminalgrid');
    const enableRestore = config.get('enableDirectoryRestore', true);

    console.log('TerminalGrid: restoreTerminals called');
    console.log(`TerminalGrid: enableRestore=${enableRestore}`);
    console.log(`TerminalGrid: Current terminals: ${vscode.window.terminals.length}`);

    if (!enableRestore) {
        console.log('TerminalGrid: Restore disabled, skipping');
        return false;
    }

    const state = context.globalState.get<TerminalState>(TERMINAL_STATE_KEY);
    console.log('TerminalGrid: Loaded state from globalState:', state);

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

    // Deduplicate terminals by CWD (keep first occurrence with each unique cwd)
    const uniqueTerminals = deduplicateTerminalsByCwd(state.terminals);
    console.log(`TerminalGrid: Deduplicated ${state.terminals.length} -> ${uniqueTerminals.length} terminals`);

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
        console.log(`TerminalGrid: Creating ${uniqueTerminals.length} terminals with saved cwds/names`);

        for (const savedTerminal of uniqueTerminals) {
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
            `TerminalGrid: Restored ${uniqueTerminals.length} terminal(s) with saved directories`
        );

        await context.globalState.update(TERMINAL_STATE_KEY, undefined);
        return true;
    }

    console.log(`TerminalGrid: Restoring ${uniqueTerminals.length} terminals from crash`);

    for (const savedTerminal of uniqueTerminals) {
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

        // Don't call terminal.show() - it can create empty editor groups
    }

    // Clear the saved state after restore
    await context.globalState.update(TERMINAL_STATE_KEY, undefined);

    vscode.window.showInformationMessage(
        `TerminalGrid: Restored ${uniqueTerminals.length} terminal(s) from previous session`
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

async function trackTerminalCwd(terminal: vscode.Terminal) {
    const key = getTerminalKey(terminal);

    // Try shell integration first (most reliable when shell is active)
    const shellIntegration = (terminal as unknown as ShellIntegrationCwd).shellIntegration;
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

    // Try to get cwd from the terminal's process (most reliable for VS Code-restored terminals)
    const pid = await terminal.processId;
    if (pid) {
        const processCwd = await getProcessCwd(pid);
        if (processCwd) {
            terminalCwdMap.set(key, processCwd);
            console.log(`TerminalGrid: Tracked cwd via process ${pid}: ${processCwd}`);
            return;
        }
    }

    // Try to match terminal name to a workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // Check if terminal name matches any workspace folder name
        const terminalName = terminal.name.toLowerCase();
        for (const folder of workspaceFolders) {
            const folderName = getFolderName(folder.uri.fsPath).toLowerCase();
            if (terminalName.includes(folderName) || folderName.includes(terminalName)) {
                terminalCwdMap.set(key, folder.uri.fsPath);
                console.log(`TerminalGrid: Tracked cwd via name match: ${folder.uri.fsPath} (terminal: ${terminal.name})`);
                return;
            }
        }

        // Fall back to first workspace folder
        const cwdPath = workspaceFolders[0].uri.fsPath;
        if (!terminalCwdMap.has(key)) {
            terminalCwdMap.set(key, cwdPath);
            console.log(`TerminalGrid: Tracked cwd via workspace folder fallback: ${cwdPath}`);
        }
    } else {
        console.log(`TerminalGrid: No cwd found for terminal "${terminal.name}" (no workspace folders)`);
    }
}

/**
 * Check for duplicate terminals and remove them
 * This handles cases where VS Code's built-in persistence restored terminals incorrectly
 */
async function deduplicateExistingTerminals() {
    const terminals = vscode.window.terminals;
    if (terminals.length < 2) {
        return;
    }

    // Collect terminal info with cwds
    const terminalInfos: { terminal: vscode.Terminal; cwd: string; name: string }[] = [];
    for (const terminal of terminals) {
        const cwd = await getTerminalCwd(terminal);
        if (cwd) {
            terminalInfos.push({ terminal, cwd, name: terminal.name });
        }
    }

    // Check for duplicates
    if (!hasDuplicateCwds(terminalInfos)) {
        console.log('TerminalGrid: No duplicate terminals found');
        return;
    }

    console.log(`TerminalGrid: Found duplicate terminals, deduplicating...`);

    // Get unique terminals (keep first occurrence of each cwd)
    const seenCwds = new Set<string>();
    const toKeep: typeof terminalInfos = [];
    const toRemove: vscode.Terminal[] = [];

    for (const info of terminalInfos) {
        if (seenCwds.has(info.cwd)) {
            toRemove.push(info.terminal);
            console.log(`TerminalGrid: Will remove duplicate "${info.name}" (${info.cwd})`);
        } else {
            seenCwds.add(info.cwd);
            toKeep.push(info);
        }
    }

    // Dispose duplicates
    for (const terminal of toRemove) {
        terminal.dispose();
    }

    if (toRemove.length > 0) {
        vscode.window.showInformationMessage(
            `TerminalGrid: Removed ${toRemove.length} duplicate terminal(s)`
        );
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
    await restoreTerminals(context);

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

    // Track ALL existing terminals at startup (important for crash recovery)
    console.log(`TerminalGrid: Tracking ${vscode.window.terminals.length} existing terminals at startup`);
    for (const terminal of vscode.window.terminals) {
        await trackTerminalCwd(terminal);
    }

    // Check for and fix duplicate terminals (VS Code may have restored incorrectly)
    await deduplicateExistingTerminals();

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
            const terminal = await createNamedTerminal();
            if (!terminal) {
                // User cancelled - close the empty editor group
                await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
            }
        })
    );

    // Register split right and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitRightAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorRight');
            const terminal = await createNamedTerminal();
            if (!terminal) {
                // User cancelled - close the empty editor group
                await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
            }
        })
    );

    // Register open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.openTerminal', async () => {
            createNamedTerminal();
        })
    );

    // Register show terminal status command - shows which terminals are running Claude
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.showTerminalStatus', async () => {
            // Force a refresh to get current status
            await updateStatusBar();

            if (lastTerminalStatuses.length === 0) {
                vscode.window.showInformationMessage('No terminals open');
                return;
            }

            const items = lastTerminalStatuses.map(status => {
                let icon = '⚪';
                let desc = 'Shell';
                if (status.hasClaude) {
                    if (status.isActive) {
                        icon = '🟡';
                        desc = 'Claude running';
                    } else {
                        icon = '🟢';
                        desc = 'Claude standby';
                    }
                }
                return {
                    label: `${icon} ${status.name}`,
                    description: desc,
                    terminal: status.terminal
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select terminal to focus',
                title: 'Terminal Status'
            });

            if (selected) {
                selected.terminal.show();
            }
        })
    );

    // Register refresh terminals command - recreates terminals with proper names
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.refreshTerminals', async () => {
            const config = vscode.workspace.getConfiguration('terminalgrid');
            const autoNameByFolder = config.get('autoNameByFolder', true);
            const autoLaunchCommand = config.get<string>('autoLaunchCommand', '').trim();

            const terminals = [...vscode.window.terminals];
            console.log(`TerminalGrid Refresh: Found ${terminals.length} terminals`);

            if (terminals.length === 0) {
                vscode.window.showInformationMessage('No terminals to refresh');
                return;
            }

            // Collect terminal info before disposing
            const terminalInfos: { cwd: string; name: string }[] = [];
            for (const terminal of terminals) {
                const pid = await terminal.processId;
                console.log(`TerminalGrid Refresh: Terminal "${terminal.name}" has PID: ${pid}`);

                const cwd = await getTerminalCwd(terminal);
                console.log(`TerminalGrid Refresh: Terminal "${terminal.name}" cwd: ${cwd}`);

                if (cwd) {
                    const newName = autoNameByFolder ? getFolderName(cwd) : terminal.name;
                    terminalInfos.push({ cwd, name: newName });
                    console.log(`TerminalGrid Refresh: Will recreate "${terminal.name}" as "${newName}" in ${cwd}`);
                } else {
                    console.log(`TerminalGrid Refresh: Skipping "${terminal.name}" - no cwd found`);
                }
            }

            // Dispose old terminals
            for (const terminal of terminals) {
                terminal.dispose();
            }

            // Wait for disposal
            await new Promise(resolve => setTimeout(resolve, 300));

            // Recreate with proper names
            for (const info of terminalInfos) {
                const terminalOptions: vscode.TerminalOptions = {
                    cwd: info.cwd,
                    name: info.name,
                    iconPath: TERMINAL_ICON
                };

                const terminal = vscode.window.createTerminal(terminalOptions);
                terminalCwdMap.set(getTerminalKey(terminal), info.cwd);

                if (autoLaunchCommand) {
                    setTimeout(() => {
                        terminal.sendText(autoLaunchCommand);
                    }, 500);
                }
            }

            vscode.window.showInformationMessage(
                `Refreshed ${terminalInfos.length} terminal(s) with folder names`
            );
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
