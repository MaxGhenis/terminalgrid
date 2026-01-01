import * as vscode from 'vscode';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getFolderName, isClaudeProcess, deduplicateTerminalsByCwd, hasDuplicateCwds, inferCwdFromName, scanProjectFolders, createRestorePlan } from './utils';

const execAsync = promisify(exec);

interface SavedTerminal {
    cwd: string;
    name?: string;
    viewColumn?: number;  // Which editor group (1-based)
}

// VS Code editor layout structure (from vscode.getEditorLayout)
interface EditorLayout {
    orientation: number;  // 0 = horizontal, 1 = vertical
    groups: Array<EditorLayoutGroup | EditorLayout>;
}

interface EditorLayoutGroup {
    size?: number;
    groups?: Array<EditorLayoutGroup | EditorLayout>;
}

interface TerminalState {
    terminals: SavedTerminal[];
    savedAt: number;
    gracefulExit: boolean;
    editorLayout?: EditorLayout;  // Save the grid layout structure
}

// Shell integration cwd access type (for terminals with shell integration enabled)
interface ShellIntegrationCwd {
    shellIntegration?: {
        cwd?: vscode.Uri | string;
    };
}

const TERMINAL_STATE_KEY = 'terminalGridState';
const CWD_MAP_KEY = 'terminalCwdMap';  // Persist CWD map across restarts
const SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const ICON_UPDATE_INTERVAL_MS = 3000; // Update icons every 3 seconds

let saveInterval: NodeJS.Timeout | undefined;
let iconUpdateInterval: NodeJS.Timeout | undefined;
const terminalCwdMap: Map<string, string> = new Map();

// Load CWD map from persistent storage
function loadCwdMap(context: vscode.ExtensionContext) {
    const savedMap = context.globalState.get<Record<string, string>>(CWD_MAP_KEY);
    if (savedMap) {
        for (const [key, value] of Object.entries(savedMap)) {
            terminalCwdMap.set(key, value);
        }
        console.log(`TerminalGrid: Loaded ${terminalCwdMap.size} CWD entries from storage`);
    }
}

// Save CWD map to persistent storage
function saveCwdMap(context: vscode.ExtensionContext) {
    const mapObj: Record<string, string> = {};
    for (const [key, value] of terminalCwdMap.entries()) {
        mapObj[key] = value;
    }
    context.globalState.update(CWD_MAP_KEY, mapObj);
    console.log(`TerminalGrid: Saved ${terminalCwdMap.size} CWD entries to storage`);
}

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

        // Get all process info (ps is more reliable than pgrep -P on macOS)
        const { stdout: psOutput } = await execAsync(`ps -eo pid,ppid,comm 2>/dev/null || echo ""`);
        const getChildPids = (parentPid: number): Array<{pid: number, comm: string}> => {
            return psOutput.trim().split('\n')
                .map(line => line.trim().split(/\s+/))
                .filter(parts => parts.length >= 3 && parseInt(parts[1], 10) === parentPid)
                .map(parts => ({ pid: parseInt(parts[0], 10), comm: parts.slice(2).join(' ') }));
        };

        // Find Claude process among children
        const children = getChildPids(pid);
        let claudePid: number | null = null;

        for (const child of children) {
            if (isClaudeProcess(child.comm)) {
                claudePid = child.pid;
                break;
            }
        }

        if (!claudePid) {
            return { hasClaude: false, isActive: false };
        }

        // Check if Claude has active tool processes (not just MCP servers)
        const claudeChildren = getChildPids(claudePid);
        const childProcesses = claudeChildren.map(c => c.comm);

        // Look for processes that indicate active tool use
        // MCP servers run as node/python, so we need to look for shell/tool processes
        const activeChildren = childProcesses.filter(proc => {
            const name = proc.toLowerCase();

            // Shell processes indicate active command execution
            if (name.includes('bash') || name.includes('zsh') || name === 'sh' || name === '-zsh' || name === '-bash') {
                return true;
            }
            // Common CLI tools indicate active work
            if (name.includes('git') || name.includes('grep') || name.includes('find') || name.includes('rg')) {
                return true;
            }
            if (name.includes('cat') || name.includes('ls') || name.includes('rm') || name.includes('mv') || name.includes('cp')) {
                return true;
            }
            if (name.includes('curl') || name.includes('wget') || name.includes('ssh')) {
                return true;
            }
            // Exclude known background/MCP processes
            if (name.includes('node') || name.includes('npm') || name.includes('npx')) {
                return false;
            }
            if (name.includes('python') || name.includes('uvx') || name.includes('mcp')) {
                return false;
            }
            if (name.includes('claude')) {
                return false;
            }
            // Unknown process - could be active tool, count it
            return true;
        });

        console.log(`TerminalGrid Status: Claude PID ${claudePid} children: [${childProcesses.join(', ')}], active: [${activeChildren.join(', ')}]`);

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

/**
 * Get the viewColumn (editor group) for a terminal by searching tabGroups
 */
function getTerminalViewColumn(terminal: vscode.Terminal): number | undefined {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            // Terminal tabs use TabInputTerminal
            if (tab.input instanceof vscode.TabInputTerminal) {
                // Match by tab label (terminal name)
                if (tab.label === terminal.name) {
                    console.log(`TerminalGrid: Found terminal "${terminal.name}" in group ${group.viewColumn}`);
                    return group.viewColumn;
                }
            }
        }
    }
    console.log(`TerminalGrid: Could not find terminal "${terminal.name}" in any tab group`);
    return undefined;
}

/**
 * Get the current editor layout structure
 */
async function getEditorLayout(): Promise<EditorLayout | undefined> {
    try {
        const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
        return layout;
    } catch (error) {
        console.log('TerminalGrid: Failed to get editor layout:', error);
        return undefined;
    }
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

            // Find child shell processes using ps (more reliable than pgrep -P on macOS)
            const { stdout: psOutput } = await execAsync(`ps -eo pid,ppid 2>/dev/null || echo ""`);
            const getChildPids = (parentPid: number): string[] => {
                return psOutput.trim().split('\n')
                    .map(line => line.trim().split(/\s+/))
                    .filter(parts => parts.length >= 2 && parseInt(parts[1], 10) === parentPid)
                    .map(parts => parts[0]);
            };

            const children = getChildPids(pid);
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
                const grandchildren = getChildPids(parseInt(childPid, 10));
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
    const homeDir = os.homedir();
    const isValidCwd = (cwd: string | undefined): cwd is string => {
        return !!cwd && cwd !== '/' && cwd !== homeDir;
    };

    // First check our stored CWD - this is the most reliable since we tracked it
    const storedCwd = terminalCwdMap.get(getTerminalKey(terminal));
    if (isValidCwd(storedCwd)) {
        console.log(`TerminalGrid: Using stored CWD for "${terminal.name}": ${storedCwd}`);
        return storedCwd;
    }

    // Try shell integration (but only if it returns a valid non-home path)
    const shellIntegration = (terminal as unknown as ShellIntegrationCwd).shellIntegration;
    if (shellIntegration?.cwd) {
        const cwdUri = shellIntegration.cwd;
        const cwdPath = cwdUri instanceof vscode.Uri ? cwdUri.fsPath : String(cwdUri);
        if (isValidCwd(cwdPath)) {
            // Update our stored map with this valid CWD
            terminalCwdMap.set(getTerminalKey(terminal), cwdPath);
            return cwdPath;
        }
    }

    // Try to get cwd from the terminal's process
    const pid = await terminal.processId;
    if (pid) {
        const processCwd = await getProcessCwd(pid);
        if (isValidCwd(processCwd)) {
            // Cache it for future use
            terminalCwdMap.set(getTerminalKey(terminal), processCwd);
            return processCwd;
        }
    }

    // Return stored CWD even if it's home dir (better than nothing)
    if (storedCwd) {
        return storedCwd;
    }

    return undefined;
}

interface CollectedState {
    terminals: SavedTerminal[];
    editorLayout?: EditorLayout;
}

async function collectTerminalState(): Promise<CollectedState> {
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

    // Get editor layout for grid restoration
    const editorLayout = await getEditorLayout();
    if (editorLayout) {
        console.log(`TerminalGrid: Captured editor layout:`, JSON.stringify(editorLayout));
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

        // Get the viewColumn (editor group) for this terminal
        const viewColumn = getTerminalViewColumn(terminal);

        if (cwd) {
            terminals.push({
                cwd,
                name: terminal.name,
                viewColumn
            });
            console.log(`TerminalGrid: Collected terminal "${terminal.name}" with cwd: ${cwd}, viewColumn: ${viewColumn}`);
        } else {
            // Last resort: save with home dir so terminal isn't lost
            terminals.push({
                cwd: homeDir,
                name: terminal.name,
                viewColumn
            });
            console.log(`TerminalGrid: Saved terminal "${terminal.name}" with fallback home dir, viewColumn: ${viewColumn}`);
        }
    }

    return { terminals, editorLayout };
}

async function saveTerminalState(context: vscode.ExtensionContext, gracefulExit: boolean = false) {
    const collected = await collectTerminalState();

    // Debug: log what we're trying to save
    console.log(`TerminalGrid: Collecting state - found ${vscode.window.terminals.length} terminals`);
    console.log(`TerminalGrid: terminalCwdMap has ${terminalCwdMap.size} entries:`, Array.from(terminalCwdMap.entries()));
    console.log(`TerminalGrid: Collected ${collected.terminals.length} terminals with cwds:`, collected.terminals);

    if (collected.terminals.length === 0 && !gracefulExit) {
        // Don't save empty state unless it's a graceful exit
        console.log('TerminalGrid: No terminals to save, skipping');
        return;
    }

    const state: TerminalState = {
        terminals: collected.terminals,
        savedAt: Date.now(),
        gracefulExit,
        editorLayout: collected.editorLayout
    };

    await context.globalState.update(TERMINAL_STATE_KEY, state);
    console.log(`TerminalGrid: Saved ${collected.terminals.length} terminal states with layout to globalState`);
}

/**
 * Create a terminal in a specific editor group
 * @param isCrashRecovery - If true, sends /resume after Claude starts
 */
async function createTerminalInGroup(
    savedTerminal: SavedTerminal,
    autoNameByFolder: boolean,
    autoLaunchCommand: string,
    targetGroup: number,
    isCrashRecovery: boolean = false
): Promise<vscode.Terminal> {
    const terminalName = autoNameByFolder
        ? getFolderName(savedTerminal.cwd)
        : (savedTerminal.name || getFolderName(savedTerminal.cwd));

    // Focus the target group before creating the terminal
    // VS Code groups are 1-indexed
    if (targetGroup > 0) {
        try {
            await vscode.commands.executeCommand(`workbench.action.focusEditorGroup${targetGroup}`);
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
            console.log(`TerminalGrid: Could not focus group ${targetGroup}:`, e);
        }
    }

    const terminalOptions: vscode.TerminalOptions = {
        cwd: savedTerminal.cwd,
        name: terminalName,
        iconPath: TERMINAL_ICON
    };

    console.log(`TerminalGrid: Creating terminal "${terminalName}" in group ${targetGroup}, cwd: ${savedTerminal.cwd}`);
    const terminal = vscode.window.createTerminal(terminalOptions);

    // Track the cwd immediately
    terminalCwdMap.set(getTerminalKey(terminal), savedTerminal.cwd);

    if (autoLaunchCommand) {
        setTimeout(() => {
            terminal.sendText(autoLaunchCommand);
        }, 500);

        // If recovering from crash, send /resume after Claude has time to start
        if (isCrashRecovery) {
            setTimeout(() => {
                // Send /resume with explicit newline to ensure execution
                terminal.sendText('/resume', true);  // true = add newline
                console.log(`TerminalGrid: Sent /resume to "${terminalName}" for crash recovery`);
            }, 5000);  // Wait 5s for Claude to fully initialize
        }
    }

    return terminal;
}

/**
 * Restore the editor layout structure
 */
async function restoreEditorLayout(layout: EditorLayout): Promise<boolean> {
    try {
        console.log('TerminalGrid: Restoring editor layout:', JSON.stringify(layout));
        await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
        // Wait for layout to settle
        await new Promise(resolve => setTimeout(resolve, 300));
        return true;
    } catch (error) {
        console.log('TerminalGrid: Failed to restore editor layout:', error);
        return false;
    }
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
        console.log('TerminalGrid: VS Code restored terminals, but we need to replace them with correct cwds/names/layout');

        // Kill VS Code's restored terminals - they have wrong cwds and names
        const existingTerminals = [...vscode.window.terminals];
        for (const terminal of existingTerminals) {
            terminal.dispose();
        }

        // Wait for terminals to close
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Simple approach: create all terminals as tabs in a single group
    // Don't try to restore complex grid layouts - user can arrange manually
    // This avoids blank panels and cascading issues

    console.log(`TerminalGrid: Restoring ${uniqueTerminals.length} terminals (as tabs, user can arrange)`);

    for (const savedTerminal of uniqueTerminals) {
        await createTerminalInGroup(savedTerminal, autoNameByFolder, autoLaunchCommand, 0, true);
        // Small delay between terminals to let VS Code settle
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Clear the saved state after restore
    await context.globalState.update(TERMINAL_STATE_KEY, undefined);

    vscode.window.showInformationMessage(
        `TerminalGrid: Restored ${uniqueTerminals.length} terminal(s) - arrange as needed`
    );

    return true;
}

function startPeriodicSave(context: vscode.ExtensionContext) {
    if (saveInterval) {
        clearInterval(saveInterval);
    }

    saveInterval = setInterval(async () => {
        // Refresh CWD tracking for all terminals before saving
        for (const terminal of vscode.window.terminals) {
            await trackTerminalCwd(terminal);
        }
        saveTerminalState(context);
        // Also persist the CWD map
        saveCwdMap(context);
    }, SAVE_INTERVAL_MS);
}

async function trackTerminalCwd(terminal: vscode.Terminal) {
    const key = getTerminalKey(terminal);
    const homeDir = os.homedir();
    const existingCwd = terminalCwdMap.get(key);

    // Helper to determine if a CWD is "valid" (not home dir or root)
    const isValidCwd = (cwd: string | undefined): cwd is string => {
        return !!cwd && cwd !== '/' && cwd !== homeDir;
    };

    // Try shell integration first (most reliable when shell is active)
    const shellIntegration = (terminal as unknown as ShellIntegrationCwd).shellIntegration;
    console.log(`TerminalGrid: Terminal "${terminal.name}" shell integration:`, {
        hasShellIntegration: !!shellIntegration,
        hasCwd: !!shellIntegration?.cwd,
        cwdValue: shellIntegration?.cwd?.toString(),
        existingCwd
    });
    if (shellIntegration?.cwd) {
        const cwd = shellIntegration.cwd;
        const cwdPath = cwd instanceof vscode.Uri ? cwd.fsPath : String(cwd);
        // Only update if new CWD is valid OR we have no existing valid CWD
        if (isValidCwd(cwdPath) || !isValidCwd(existingCwd)) {
            terminalCwdMap.set(key, cwdPath);
            console.log(`TerminalGrid: Tracked cwd via shell integration: ${cwdPath}`);
        } else {
            console.log(`TerminalGrid: Keeping existing cwd ${existingCwd} (shell integration returned ${cwdPath})`);
        }
        return;
    }

    // Try to get cwd from creation options
    const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
    if (creationOptions?.cwd) {
        const cwd = creationOptions.cwd;
        const cwdPath = cwd instanceof vscode.Uri ? cwd.fsPath : String(cwd);
        if (isValidCwd(cwdPath) || !isValidCwd(existingCwd)) {
            terminalCwdMap.set(key, cwdPath);
            console.log(`TerminalGrid: Tracked cwd via creationOptions: ${cwdPath}`);
        }
        return;
    }

    // Try to get cwd from the terminal's process
    const pid = await terminal.processId;
    if (pid) {
        const processCwd = await getProcessCwd(pid);
        // Only update if detected CWD is valid, never overwrite valid CWD with invalid one
        if (isValidCwd(processCwd)) {
            terminalCwdMap.set(key, processCwd);
            console.log(`TerminalGrid: Tracked cwd via process ${pid}: ${processCwd}`);
            return;
        } else if (isValidCwd(existingCwd)) {
            console.log(`TerminalGrid: Keeping existing valid cwd ${existingCwd} (process returned ${processCwd})`);
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

    // Load persisted CWD map FIRST (before any terminal operations)
    loadCwdMap(context);

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

    // Track CWD after shell commands complete (catches cd commands)
    context.subscriptions.push(
        vscode.window.onDidEndTerminalShellExecution((e) => {
            // Re-track CWD after any command completes
            trackTerminalCwd(e.terminal);
            // Also immediately persist
            saveCwdMap(context);
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

    // Debug command to show current saved state
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.debugState', async () => {
            const state = context.globalState.get<TerminalState>(TERMINAL_STATE_KEY);
            const cwdMapEntries = Array.from(terminalCwdMap.entries());

            let msg = `=== TerminalGrid Debug ===\n`;
            msg += `\nCWD Map (${cwdMapEntries.length} entries):\n`;
            for (const [key, cwd] of cwdMapEntries) {
                msg += `  ${key} -> ${cwd}\n`;
            }

            msg += `\nCurrent Terminals (${vscode.window.terminals.length}):\n`;
            for (const t of vscode.window.terminals) {
                const key = getTerminalKey(t);
                const storedCwd = terminalCwdMap.get(key);
                const viewCol = getTerminalViewColumn(t);
                msg += `  "${t.name}" key=${key} storedCwd=${storedCwd} viewColumn=${viewCol}\n`;
            }

            msg += `\nSaved State:\n`;
            if (state) {
                msg += `  savedAt: ${new Date(state.savedAt).toISOString()}\n`;
                msg += `  gracefulExit: ${state.gracefulExit}\n`;
                msg += `  terminals (${state.terminals.length}):\n`;
                for (const t of state.terminals) {
                    msg += `    "${t.name}" cwd=${t.cwd} viewColumn=${t.viewColumn}\n`;
                }
                msg += `  layout: ${state.editorLayout ? JSON.stringify(state.editorLayout) : 'none'}\n`;
            } else {
                msg += '  (no saved state)\n';
            }

            console.log(msg);
            vscode.window.showInformationMessage('TerminalGrid debug info logged to console (Developer Tools)');
        })
    );

    // Helper to create a new terminal with folder selection
    const createNamedTerminal = async () => {
        const config = vscode.workspace.getConfiguration('terminalgrid');
        const autoNameByFolder = config.get('autoNameByFolder', true);
        const autoLaunchCommand = config.get<string>('autoLaunchCommand', '').trim();
        const projectDirectories = config.get<string[]>('projectDirectories', []);
        const homeDir = os.homedir();

        // Expand ~ in paths and build search paths from config
        const searchPaths: string[] = projectDirectories.map(p =>
            p.startsWith('~') ? p.replace('~', homeDir) : p
        );

        // Add workspace folder parents to search paths
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        for (const folder of workspaceFolders) {
            const parent = folder.uri.fsPath.split('/').slice(0, -1).join('/');
            if (parent && !searchPaths.includes(parent)) {
                searchPaths.push(parent);
            }
        }

        // Get all project folders
        const projectFolders = scanProjectFolders(searchPaths);

        // Build quick pick items
        const items: { label: string; description: string; detail?: string }[] = [];

        // Add workspace folders first (marked as such)
        for (const folder of workspaceFolders) {
            items.push({
                label: `$(folder) ${getFolderName(folder.uri.fsPath)}`,
                description: folder.uri.fsPath,
                detail: '⭐ Workspace folder'
            });
        }

        // Add scanned project folders (excluding workspace folders)
        const workspacePaths = new Set(workspaceFolders.map(f => f.uri.fsPath));
        for (const folderPath of projectFolders) {
            if (!workspacePaths.has(folderPath)) {
                items.push({
                    label: `$(folder) ${getFolderName(folderPath)}`,
                    description: folderPath
                });
            }
        }

        // Add browse option at the end
        items.push({
            label: '$(folder-opened) Browse...',
            description: 'Select a different folder',
            detail: 'Open folder picker'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Type to search project folders...',
            title: 'TerminalGrid: Select Project',
            matchOnDescription: true
        });

        if (!selected) {
            return undefined; // User cancelled
        }

        let selectedFolder: string;

        if (selected.label.includes('Browse...')) {
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
            selectedFolder = selected.description!;
        }

        // Create terminal with folder name AND cwd
        const terminalName = autoNameByFolder ? getFolderName(selectedFolder) : undefined;
        const options: vscode.TerminalOptions = {
            name: terminalName,
            cwd: selectedFolder,  // Set CWD directly so VS Code tracks it
            iconPath: TERMINAL_ICON
        };

        console.log(`TerminalGrid: Creating terminal "${terminalName}" in ${selectedFolder}`);
        const terminal = vscode.window.createTerminal(options);
        terminal.show();

        // Track the cwd
        terminalCwdMap.set(getTerminalKey(terminal), selectedFolder);

        // Run launch command (terminal already starts in the right directory)
        const launchCmd = autoLaunchCommand || 'cc';
        setTimeout(() => {
            terminal.sendText(launchCmd);
        }, 300);

        return terminal;
    };

    // Register split down and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitDownAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
            const terminal = await createNamedTerminal();
            if (!terminal) {
                // User cancelled - close the empty editor group
                await vscode.commands.executeCommand('workbench.action.closeGroup');
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
                await vscode.commands.executeCommand('workbench.action.closeGroup');
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
            const homeDir = os.homedir();

            // Build search paths for name inference
            const searchPaths = [
                homeDir,
                `${homeDir}/PolicyEngine`,
                `${homeDir}/projects`,
                `${homeDir}/code`,
                `${homeDir}/dev`,
            ];
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    searchPaths.push(folder.uri.fsPath);
                    const parent = folder.uri.fsPath.split('/').slice(0, -1).join('/');
                    if (parent && !searchPaths.includes(parent)) {
                        searchPaths.push(parent);
                    }
                }
            }

            for (const terminal of terminals) {
                const pid = await terminal.processId;
                console.log(`TerminalGrid Refresh: Terminal "${terminal.name}" has PID: ${pid}`);

                let cwd = await getTerminalCwd(terminal);
                console.log(`TerminalGrid Refresh: Terminal "${terminal.name}" detected cwd: ${cwd}`);

                // If CWD detection failed, try to infer from terminal name
                if (!cwd || cwd === '/' || cwd === homeDir) {
                    const inferredCwd = inferCwdFromName(terminal.name, searchPaths);
                    if (inferredCwd) {
                        cwd = inferredCwd;
                        console.log(`TerminalGrid Refresh: Inferred cwd from name "${terminal.name}": ${cwd}`);
                    }
                }

                // Always preserve terminals - use home dir as last resort
                const finalCwd = cwd || homeDir;
                const newName = autoNameByFolder ? getFolderName(finalCwd) : terminal.name;
                terminalInfos.push({ cwd: finalCwd, name: newName });
                console.log(`TerminalGrid Refresh: Will recreate "${terminal.name}" as "${newName}" in ${finalCwd}`);
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
