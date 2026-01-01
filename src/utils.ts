/**
 * Extract the folder name from a path
 * @param cwd - The directory path
 * @returns The last folder name, or 'Terminal' if empty
 */
export function getFolderName(cwd: string): string {
    const parts = cwd.split('/').filter(p => p.length > 0);
    return parts[parts.length - 1] || 'Terminal';
}

/**
 * Create QuickPickItems for folder selection
 * @param workspaceFolders - Array of workspace folders
 * @returns Array of QuickPickItem-like objects
 */
export function createFolderQuickPickItems(
    workspaceFolders: readonly { uri: { fsPath: string } }[]
): { label: string; description: string; detail: string }[] {
    const items: { label: string; description: string; detail: string }[] = [];

    for (const folder of workspaceFolders) {
        items.push({
            label: `$(folder) ${getFolderName(folder.uri.fsPath)}`,
            description: folder.uri.fsPath,
            detail: 'Workspace folder'
        });
    }

    items.push({
        label: '$(folder-opened) Browse...',
        description: 'Select a different folder',
        detail: 'Open folder picker'
    });

    return items;
}

/**
 * Check if a QuickPickItem is the "Browse..." option
 * @param item - The selected item
 * @returns true if it's the browse option
 */
export function isBrowseOption(item: { label: string }): boolean {
    return item.label.includes('Browse...');
}

/**
 * Check if a process name indicates Claude Code is running
 * @param processName - The process command name
 * @returns true if it's a Claude-related process
 */
export function isClaudeProcess(processName: string): boolean {
    const name = processName.toLowerCase().trim();
    // Match exact "claude" or paths ending in /claude
    return name === 'claude' || name.endsWith('/claude');
}

/**
 * Parse ps command output into process list
 * @param stdout - Output from ps command
 * @returns Array of process info objects
 */
export function parseProcessList(stdout: string): { pid: number; comm: string }[] {
    return stdout
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
            const parts = line.trim().split(/\s+/);
            return { pid: parseInt(parts[0], 10), comm: parts[1] || '' };
        })
        .filter(p => !isNaN(p.pid));
}

/**
 * Check if any process in a list is Claude
 * @param processes - Array of process info
 * @returns true if any process is Claude-related
 */
export function hasClaudeInProcessList(processes: { comm: string }[]): boolean {
    return processes.some(p => isClaudeProcess(p.comm));
}

/**
 * Deduplicate terminals by CWD, keeping first occurrence
 * @param terminals - Array of saved terminal objects with cwd
 * @returns Array with duplicate cwds removed
 */
export function deduplicateTerminalsByCwd<T extends { cwd: string }>(terminals: T[]): T[] {
    const seenCwds = new Set<string>();
    return terminals.filter(t => {
        if (seenCwds.has(t.cwd)) {
            return false;
        }
        seenCwds.add(t.cwd);
        return true;
    });
}

/**
 * Check if any terminals have duplicate CWDs
 * @param terminals - Array of terminal-like objects with cwd
 * @returns true if duplicates exist
 */
export function hasDuplicateCwds<T extends { cwd: string }>(terminals: T[]): boolean {
    const cwds = terminals.map(t => t.cwd);
    return new Set(cwds).size < cwds.length;
}

/**
 * Normalize a name for fuzzy matching - lowercase and treat underscores/hyphens as equivalent
 * @param name - Name to normalize
 * @returns Normalized name for comparison
 */
export function normalizeForMatch(name: string): string {
    return name.toLowerCase().trim().replace(/[-_]/g, '-');
}

/**
 * Scan directories and return all subdirectories as project folders
 * @param searchPaths - Parent directories to scan
 * @returns Array of folder paths sorted alphabetically
 */
export function scanProjectFolders(searchPaths: string[]): string[] {
    let fs: typeof import('fs');
    let path: typeof import('path');
    try {
        fs = require('fs');
        path = require('path');
    } catch {
        return [];
    }

    const folders: Set<string> = new Set();

    for (const searchPath of searchPaths) {
        try {
            if (!fs.existsSync(searchPath)) {
                continue;
            }
            const entries = fs.readdirSync(searchPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    folders.add(path.join(searchPath, entry.name));
                }
            }
        } catch {
            // Path doesn't exist or isn't readable, continue
        }
    }

    return Array.from(folders).sort((a, b) =>
        getFolderName(a).toLowerCase().localeCompare(getFolderName(b).toLowerCase())
    );
}

/**
 * Saved terminal state with layout info
 */
export interface SavedTerminalInfo {
    cwd: string;
    name?: string;
    viewColumn?: number;
}

/**
 * Group terminals by their viewColumn (editor group)
 * @param terminals - Array of saved terminals with optional viewColumn
 * @returns Map from viewColumn to terminals in that group
 */
export function groupTerminalsByViewColumn<T extends { viewColumn?: number }>(
    terminals: T[]
): Map<number, T[]> {
    const groups = new Map<number, T[]>();
    for (const terminal of terminals) {
        const group = terminal.viewColumn || 1;
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group)!.push(terminal);
    }
    return groups;
}

/**
 * Get sorted unique viewColumn numbers from terminals
 * @param terminals - Array of saved terminals with optional viewColumn
 * @returns Sorted array of unique viewColumn numbers
 */
export function getSortedViewColumns<T extends { viewColumn?: number }>(terminals: T[]): number[] {
    const columns = new Set<number>();
    for (const terminal of terminals) {
        columns.add(terminal.viewColumn || 1);
    }
    return Array.from(columns).sort((a, b) => a - b);
}

/**
 * Create a restore plan that maps terminals to their target group positions
 * @param terminals - Array of saved terminals with optional viewColumn
 * @returns Array of groups, each containing terminals to create in that position
 */
export function createRestorePlan<T extends { viewColumn?: number }>(
    terminals: T[]
): { groupIndex: number; originalViewColumn: number; terminals: T[] }[] {
    const groups = groupTerminalsByViewColumn(terminals);
    const sortedColumns = getSortedViewColumns(terminals);

    return sortedColumns.map((viewColumn, index) => ({
        groupIndex: index + 1,  // VS Code groups are 1-indexed
        originalViewColumn: viewColumn,
        terminals: groups.get(viewColumn) || []
    }));
}

/**
 * Try to infer CWD from terminal name by searching common paths
 * @param name - Terminal name (e.g., "marginal-child" or "optiqal_ai")
 * @param searchPaths - Paths to search for matching folders
 * @returns Path if found, undefined otherwise
 */
export function inferCwdFromName(name: string, searchPaths: string[]): string | undefined {
    // Import fs dynamically to avoid issues in test environment
    let fs: typeof import('fs');
    let path: typeof import('path');
    try {
        fs = require('fs');
        path = require('path');
    } catch {
        return undefined;
    }

    // Normalize name for matching (handles underscore/hyphen equivalence)
    const normalizedName = normalizeForMatch(name);

    for (const searchPath of searchPaths) {
        try {
            // Check if folder with exact name exists
            const exactPath = path.join(searchPath, name);
            if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
                return exactPath;
            }

            // Check subdirectories for matching name (with fuzzy underscore/hyphen matching)
            const entries = fs.readdirSync(searchPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && normalizeForMatch(entry.name) === normalizedName) {
                    return path.join(searchPath, entry.name);
                }
            }
        } catch {
            // Path doesn't exist or isn't readable, continue
        }
    }

    return undefined;
}
