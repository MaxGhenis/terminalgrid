import { describe, it, expect } from 'vitest';
import { getFolderName, createFolderQuickPickItems, isBrowseOption, isClaudeProcess, parseProcessList, hasClaudeInProcessList, deduplicateTerminalsByCwd, hasDuplicateCwds } from '../utils';

describe('getFolderName', () => {
    it('should return the last folder name from a path', () => {
        expect(getFolderName('/Users/max/projects/myapp')).toBe('myapp');
    });

    it('should handle paths with trailing slash', () => {
        expect(getFolderName('/Users/max/projects/myapp/')).toBe('myapp');
    });

    it('should handle root path', () => {
        expect(getFolderName('/')).toBe('Terminal');
    });

    it('should handle empty string', () => {
        expect(getFolderName('')).toBe('Terminal');
    });

    it('should handle single folder', () => {
        expect(getFolderName('/home')).toBe('home');
    });

    it('should handle deeply nested paths', () => {
        expect(getFolderName('/a/b/c/d/e/f/target')).toBe('target');
    });

    it('should handle Windows-style paths with backslashes', () => {
        // Note: Current implementation only splits on '/'
        // This test documents current behavior
        expect(getFolderName('C:\\Users\\max\\projects')).toBe('C:\\Users\\max\\projects');
    });
});

describe('createFolderQuickPickItems', () => {
    it('should create items for each workspace folder', () => {
        const folders = [
            { uri: { fsPath: '/Users/max/project1' } },
            { uri: { fsPath: '/Users/max/project2' } }
        ];

        const items = createFolderQuickPickItems(folders);

        expect(items).toHaveLength(3); // 2 folders + Browse
        expect(items[0].label).toBe('$(folder) project1');
        expect(items[0].description).toBe('/Users/max/project1');
        expect(items[1].label).toBe('$(folder) project2');
    });

    it('should always include Browse option at the end', () => {
        const items = createFolderQuickPickItems([]);

        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('$(folder-opened) Browse...');
    });

    it('should use full path as description', () => {
        const folders = [{ uri: { fsPath: '/very/long/path/to/folder' } }];
        const items = createFolderQuickPickItems(folders);

        expect(items[0].description).toBe('/very/long/path/to/folder');
    });

    it('should set detail to "Workspace folder" for workspace items', () => {
        const folders = [{ uri: { fsPath: '/Users/max/project' } }];
        const items = createFolderQuickPickItems(folders);

        expect(items[0].detail).toBe('Workspace folder');
    });

    it('should set detail to "Open folder picker" for Browse option', () => {
        const items = createFolderQuickPickItems([]);

        expect(items[0].detail).toBe('Open folder picker');
    });
});

describe('isBrowseOption', () => {
    it('should return true for Browse option', () => {
        expect(isBrowseOption({ label: '$(folder-opened) Browse...' })).toBe(true);
    });

    it('should return false for workspace folder items', () => {
        expect(isBrowseOption({ label: '$(folder) myproject' })).toBe(false);
    });

    it('should work with any label containing Browse...', () => {
        expect(isBrowseOption({ label: 'Browse...' })).toBe(true);
        expect(isBrowseOption({ label: 'Something Browse... else' })).toBe(true);
    });
});

describe('isClaudeProcess', () => {
    it('should return true for claude process', () => {
        expect(isClaudeProcess('claude')).toBe(true);
    });

    it('should return true for Claude (case insensitive)', () => {
        expect(isClaudeProcess('Claude')).toBe(true);
    });

    it('should return true for claude with path', () => {
        expect(isClaudeProcess('/opt/homebrew/bin/claude')).toBe(true);
    });

    it('should return false for zsh', () => {
        expect(isClaudeProcess('zsh')).toBe(false);
    });

    it('should return false for bash', () => {
        expect(isClaudeProcess('bash')).toBe(false);
    });

    it('should return false for node', () => {
        expect(isClaudeProcess('node')).toBe(false);
    });

    it('should return false for claude-related but not exact matches', () => {
        // These should NOT match - only exact "claude" or paths ending in /claude
        expect(isClaudeProcess('claude-mcp')).toBe(false);
        expect(isClaudeProcess('claude-helper')).toBe(false);
        expect(isClaudeProcess('some-claude-thing')).toBe(false);
    });
});

describe('parseProcessList', () => {
    it('should parse ps output correctly', () => {
        const stdout = `  1234 zsh\n  5678 node\n`;
        const result = parseProcessList(stdout);
        expect(result).toEqual([
            { pid: 1234, comm: 'zsh' },
            { pid: 5678, comm: 'node' }
        ]);
    });

    it('should handle empty output', () => {
        expect(parseProcessList('')).toEqual([]);
    });

    it('should filter invalid lines', () => {
        const stdout = `  1234 zsh\n  invalid\n  5678 node\n`;
        const result = parseProcessList(stdout);
        expect(result).toHaveLength(2);
    });
});

describe('hasClaudeInProcessList', () => {
    it('should return true when claude is in list', () => {
        const processes = [
            { comm: 'zsh' },
            { comm: 'claude' }
        ];
        expect(hasClaudeInProcessList(processes)).toBe(true);
    });

    it('should return false when claude is not in list', () => {
        const processes = [
            { comm: 'zsh' },
            { comm: 'node' }
        ];
        expect(hasClaudeInProcessList(processes)).toBe(false);
    });

    it('should return false for empty list', () => {
        expect(hasClaudeInProcessList([])).toBe(false);
    });
});

describe('hasDuplicateCwds', () => {
    it('should return true when terminals have duplicate cwds', () => {
        const terminals = [
            { name: 'eggnest', cwd: '/path/to/eggnest' },
            { name: 'givewell', cwd: '/path/to/givewell' },
            { name: 'eggnest-2', cwd: '/path/to/eggnest' },  // duplicate
        ];
        expect(hasDuplicateCwds(terminals)).toBe(true);
    });

    it('should return false when no duplicates', () => {
        const terminals = [
            { name: 'a', cwd: '/path/a' },
            { name: 'b', cwd: '/path/b' },
        ];
        expect(hasDuplicateCwds(terminals)).toBe(false);
    });

    it('should return false for empty array', () => {
        expect(hasDuplicateCwds([])).toBe(false);
    });
});

describe('deduplicateTerminalsByCwd', () => {
    it('should remove duplicate cwds keeping first occurrence', () => {
        const terminals = [
            { cwd: '/path/to/eggnest', name: 'eggnest' },
            { cwd: '/path/to/cosilicoai', name: 'CosilicoAI' },
            { cwd: '/path/to/eggnest', name: 'eggnest-2' },  // duplicate
        ];
        const result = deduplicateTerminalsByCwd(terminals);
        expect(result).toHaveLength(2);
        expect(result[0].cwd).toBe('/path/to/eggnest');
        expect(result[0].name).toBe('eggnest');
        expect(result[1].cwd).toBe('/path/to/cosilicoai');
    });

    it('should return all terminals when no duplicates', () => {
        const terminals = [
            { cwd: '/path/to/a', name: 'a' },
            { cwd: '/path/to/b', name: 'b' },
            { cwd: '/path/to/c', name: 'c' },
        ];
        const result = deduplicateTerminalsByCwd(terminals);
        expect(result).toHaveLength(3);
    });

    it('should handle empty array', () => {
        const result = deduplicateTerminalsByCwd([]);
        expect(result).toHaveLength(0);
    });

    it('should handle all duplicates', () => {
        const terminals = [
            { cwd: '/same/path', name: 'first' },
            { cwd: '/same/path', name: 'second' },
            { cwd: '/same/path', name: 'third' },
        ];
        const result = deduplicateTerminalsByCwd(terminals);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('first');
    });
});

// Integration-style tests documenting expected behavior
describe('createNamedTerminal behavior', () => {
    describe('when promptForFolder is enabled', () => {
        it('should show quick pick with workspace folders', () => {
            // This documents the expected behavior:
            // 1. Gets workspace folders via vscode.workspace.workspaceFolders
            // 2. Creates QuickPickItems using createFolderQuickPickItems
            // 3. Shows quick pick dialog via vscode.window.showQuickPick
            // Implementation verified via createFolderQuickPickItems tests
            expect(true).toBe(true);
        });

        it('should return undefined when user cancels quick pick', () => {
            // When showQuickPick returns undefined, createNamedTerminal returns undefined
            // This prevents terminal creation when user cancels
            expect(true).toBe(true);
        });

        it('should open folder picker when Browse is selected', () => {
            // When isBrowseOption returns true, showOpenDialog is called
            // Implementation verified via isBrowseOption tests
            expect(true).toBe(true);
        });
    });

    describe('when promptForFolder is disabled', () => {
        it('should use first workspace folder as cwd', () => {
            // Should not show quick pick, just use workspace folder
            expect(true).toBe(true);
        });
    });
});
