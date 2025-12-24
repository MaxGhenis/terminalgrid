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
