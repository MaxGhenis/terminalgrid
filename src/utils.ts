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
