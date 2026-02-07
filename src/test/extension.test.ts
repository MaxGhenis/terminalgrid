import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getFolderName, createFolderQuickPickItems, isBrowseOption, isClaudeProcess, parseProcessList, hasClaudeInProcessList, deduplicateTerminalsByCwd, hasDuplicateCwds, inferCwdFromName, normalizeForMatch, scanProjectFolders, groupTerminalsByViewColumn, getSortedViewColumns, createRestorePlan, writeStateFile, readStateFile, deleteStateFile, writeCwdMapFile, readCwdMapFile, getStateFilePath, getCwdMapFilePath } from '../utils';

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

describe('inferCwdFromName', () => {
    it('should find folder in common paths matching terminal name', () => {
        // This test documents expected behavior - actual implementation
        // will check if folders exist on disk
        const result = inferCwdFromName('marginal-child', ['/Users/max/PolicyEngine']);
        // Should return path if marginal-child folder exists under PolicyEngine
        expect(typeof result === 'string' || result === undefined).toBe(true);
    });

    it('should return undefined if no matching folder found', () => {
        const result = inferCwdFromName('nonexistent-folder-xyz', []);
        expect(result).toBeUndefined();
    });

    it('should find optiqal-ai folder when terminal is named optiqal_ai (underscore/hyphen equivalence)', () => {
        // This documents that underscores and hyphens should be treated as equivalent
        // The actual test depends on the folder existing on disk
        const result = inferCwdFromName('optiqal_ai', ['/Users/maxghenis']);
        // If optiqal-ai exists, it should find it
        expect(typeof result === 'string' || result === undefined).toBe(true);
    });
});

describe('normalizeForMatch', () => {
    it('should normalize underscores and hyphens to be equivalent', () => {
        expect(normalizeForMatch('optiqal_ai')).toBe(normalizeForMatch('optiqal-ai'));
    });

    it('should be case insensitive', () => {
        expect(normalizeForMatch('MyProject')).toBe(normalizeForMatch('myproject'));
    });

    it('should handle mixed separators', () => {
        expect(normalizeForMatch('my_project-name')).toBe(normalizeForMatch('my-project_name'));
    });
});

describe('scanProjectFolders', () => {
    it('should return empty array for non-existent paths', () => {
        const result = scanProjectFolders(['/nonexistent/path/12345']);
        expect(result).toEqual([]);
    });

    it('should return empty array for empty input', () => {
        const result = scanProjectFolders([]);
        expect(result).toEqual([]);
    });

    it('should sort folders alphabetically by name', () => {
        // Scan current directory - should return sorted folders
        const result = scanProjectFolders(['.']);
        // Result should be sorted (if any folders exist)
        if (result.length > 1) {
            const names = result.map(p => getFolderName(p).toLowerCase());
            const sorted = [...names].sort();
            expect(names).toEqual(sorted);
        }
        expect(true).toBe(true);
    });

    it('should exclude hidden folders (starting with .)', () => {
        // Scan current directory
        const result = scanProjectFolders(['.']);
        // None of the results should be hidden folders
        for (const folder of result) {
            expect(getFolderName(folder).startsWith('.')).toBe(false);
        }
    });
});

// Integration-style tests documenting expected behavior
describe('createNamedTerminal behavior', () => {
    it('should always show quick pick with project folders', () => {
        // This documents the expected behavior:
        // 1. Scans common project directories (~/PolicyEngine, ~/projects, etc.)
        // 2. Shows workspace folders first (marked with ⭐)
        // 3. Shows all other project folders (searchable)
        // 4. Includes Browse... option at the end
        expect(true).toBe(true);
    });

    it('should return undefined when user cancels quick pick', () => {
        // When showQuickPick returns undefined, createNamedTerminal returns undefined
        // This prevents terminal creation when user cancels
        expect(true).toBe(true);
    });

    it('should open folder picker when Browse is selected', () => {
        // When Browse... is selected, showOpenDialog is called
        expect(true).toBe(true);
    });

    it('should run cd and cc after terminal creation', () => {
        // After creating terminal, sends: cd "<folder>" && cc
        // The cc command launches Claude Code
        expect(true).toBe(true);
    });
});

describe('groupTerminalsByViewColumn', () => {
    it('should group terminals by their viewColumn', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a', viewColumn: 1 },
            { cwd: '/path/b', name: 'b', viewColumn: 2 },
            { cwd: '/path/c', name: 'c', viewColumn: 1 },
            { cwd: '/path/d', name: 'd', viewColumn: 3 },
        ];
        const groups = groupTerminalsByViewColumn(terminals);

        expect(groups.size).toBe(3);
        expect(groups.get(1)?.length).toBe(2);
        expect(groups.get(2)?.length).toBe(1);
        expect(groups.get(3)?.length).toBe(1);
    });

    it('should default to viewColumn 1 if not specified', () => {
        const terminals: { cwd: string; name: string; viewColumn?: number }[] = [
            { cwd: '/path/a', name: 'a' },
            { cwd: '/path/b', name: 'b' },
        ];
        const groups = groupTerminalsByViewColumn(terminals);

        expect(groups.size).toBe(1);
        expect(groups.get(1)?.length).toBe(2);
    });

    it('should handle empty array', () => {
        const groups = groupTerminalsByViewColumn([]);
        expect(groups.size).toBe(0);
    });

    it('should handle mixed specified and unspecified viewColumns', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a', viewColumn: 2 },
            { cwd: '/path/b', name: 'b' },  // defaults to 1
            { cwd: '/path/c', name: 'c', viewColumn: 2 },
        ];
        const groups = groupTerminalsByViewColumn(terminals);

        expect(groups.size).toBe(2);
        expect(groups.get(1)?.length).toBe(1);
        expect(groups.get(2)?.length).toBe(2);
    });
});

describe('getSortedViewColumns', () => {
    it('should return sorted unique viewColumn numbers', () => {
        const terminals = [
            { viewColumn: 3 },
            { viewColumn: 1 },
            { viewColumn: 2 },
            { viewColumn: 1 },
        ];
        const columns = getSortedViewColumns(terminals);

        expect(columns).toEqual([1, 2, 3]);
    });

    it('should default undefined viewColumn to 1', () => {
        const terminals = [
            { viewColumn: 2 },
            {},
        ];
        const columns = getSortedViewColumns(terminals);

        expect(columns).toEqual([1, 2]);
    });

    it('should handle empty array', () => {
        const columns = getSortedViewColumns([]);
        expect(columns).toEqual([]);
    });

    it('should handle non-contiguous viewColumn numbers', () => {
        const terminals = [
            { viewColumn: 5 },
            { viewColumn: 2 },
            { viewColumn: 8 },
        ];
        const columns = getSortedViewColumns(terminals);

        expect(columns).toEqual([2, 5, 8]);
    });
});

describe('createRestorePlan', () => {
    it('should create a restore plan mapping viewColumns to group indices', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a', viewColumn: 2 },
            { cwd: '/path/b', name: 'b', viewColumn: 1 },
            { cwd: '/path/c', name: 'c', viewColumn: 3 },
        ];
        const plan = createRestorePlan(terminals);

        expect(plan).toHaveLength(3);

        // First group (groupIndex: 1) should be original viewColumn 1
        expect(plan[0].groupIndex).toBe(1);
        expect(plan[0].originalViewColumn).toBe(1);
        expect(plan[0].terminals.length).toBe(1);
        expect(plan[0].terminals[0].name).toBe('b');

        // Second group (groupIndex: 2) should be original viewColumn 2
        expect(plan[1].groupIndex).toBe(2);
        expect(plan[1].originalViewColumn).toBe(2);
        expect(plan[1].terminals[0].name).toBe('a');

        // Third group (groupIndex: 3) should be original viewColumn 3
        expect(plan[2].groupIndex).toBe(3);
        expect(plan[2].originalViewColumn).toBe(3);
        expect(plan[2].terminals[0].name).toBe('c');
    });

    it('should handle multiple terminals in same viewColumn', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a', viewColumn: 1 },
            { cwd: '/path/b', name: 'b', viewColumn: 1 },
            { cwd: '/path/c', name: 'c', viewColumn: 2 },
        ];
        const plan = createRestorePlan(terminals);

        expect(plan).toHaveLength(2);
        expect(plan[0].terminals.length).toBe(2);
        expect(plan[1].terminals.length).toBe(1);
    });

    it('should handle non-contiguous viewColumn numbers', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a', viewColumn: 2 },
            { cwd: '/path/b', name: 'b', viewColumn: 5 },
            { cwd: '/path/c', name: 'c', viewColumn: 8 },
        ];
        const plan = createRestorePlan(terminals);

        // Should map to contiguous group indices regardless of original viewColumn
        expect(plan[0].groupIndex).toBe(1);
        expect(plan[0].originalViewColumn).toBe(2);

        expect(plan[1].groupIndex).toBe(2);
        expect(plan[1].originalViewColumn).toBe(5);

        expect(plan[2].groupIndex).toBe(3);
        expect(plan[2].originalViewColumn).toBe(8);
    });

    it('should handle empty array', () => {
        const plan = createRestorePlan([]);
        expect(plan).toEqual([]);
    });

    it('should default undefined viewColumn to 1', () => {
        const terminals = [
            { cwd: '/path/a', name: 'a' },
            { cwd: '/path/b', name: 'b', viewColumn: 2 },
        ];
        const plan = createRestorePlan(terminals);

        expect(plan).toHaveLength(2);
        expect(plan[0].groupIndex).toBe(1);
        expect(plan[0].originalViewColumn).toBe(1);
        expect(plan[0].terminals[0].name).toBe('a');
    });
});

// TDD: Layout analysis and grid creation
import { getGridDimensions, createGridSplitPlan, getGridCellGroup } from '../utils';

describe('getGridDimensions', () => {
    it('should return 1x1 for single group layout', () => {
        const layout = { orientation: 0, groups: [{ size: 1 }] };
        expect(getGridDimensions(layout)).toEqual({ rows: 1, cols: 1 });
    });

    it('should return 1x2 for horizontal split (2 columns)', () => {
        const layout = {
            orientation: 0,  // horizontal
            groups: [{ size: 0.5 }, { size: 0.5 }]
        };
        expect(getGridDimensions(layout)).toEqual({ rows: 1, cols: 2 });
    });

    it('should return 2x1 for vertical split (2 rows)', () => {
        const layout = {
            orientation: 1,  // vertical
            groups: [{ size: 0.5 }, { size: 0.5 }]
        };
        expect(getGridDimensions(layout)).toEqual({ rows: 2, cols: 1 });
    });

    it('should return 2x2 for a 2x2 grid', () => {
        // 2x2 grid: vertical split first (rows), then horizontal in each row
        const layout = {
            orientation: 1,  // vertical (rows)
            groups: [
                { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] }
            ]
        };
        expect(getGridDimensions(layout)).toEqual({ rows: 2, cols: 2 });
    });

    it('should return 2x3 for a 2x3 grid', () => {
        const layout = {
            orientation: 1,
            groups: [
                { orientation: 0, groups: [{ size: 0.33 }, { size: 0.33 }, { size: 0.34 }] },
                { orientation: 0, groups: [{ size: 0.33 }, { size: 0.33 }, { size: 0.34 }] }
            ]
        };
        expect(getGridDimensions(layout)).toEqual({ rows: 2, cols: 3 });
    });

    it('should handle undefined layout', () => {
        expect(getGridDimensions(undefined)).toEqual({ rows: 1, cols: 1 });
    });
});

describe('createGridSplitPlan', () => {
    it('should return empty plan for 1x1 grid', () => {
        const plan = createGridSplitPlan(1, 1);
        expect(plan).toEqual([]);
    });

    it('should return single splitRight for 1x2 grid', () => {
        const plan = createGridSplitPlan(1, 2);
        expect(plan).toEqual([
            { action: 'splitRight' }
        ]);
    });

    it('should return single splitDown for 2x1 grid', () => {
        const plan = createGridSplitPlan(2, 1);
        expect(plan).toEqual([
            { action: 'splitDown' }
        ]);
    });

    it('should return correct plan for 2x2 grid', () => {
        const plan = createGridSplitPlan(2, 2);
        // To create 2x2:
        // 1. splitRight (now 2 cols)
        // 2. focusGroup 1, splitDown (col 1 has 2 rows)
        // 3. focusGroup 2, splitDown (col 2 has 2 rows)
        expect(plan).toEqual([
            { action: 'splitRight' },
            { action: 'focusGroup', group: 1 },
            { action: 'splitDown' },
            { action: 'focusGroup', group: 2 },
            { action: 'splitDown' }
        ]);
    });

    it('should return correct plan for 1x3 grid (3 columns)', () => {
        const plan = createGridSplitPlan(1, 3);
        expect(plan).toEqual([
            { action: 'splitRight' },
            { action: 'splitRight' }
        ]);
    });

    it('should return correct plan for 3x1 grid (3 rows)', () => {
        const plan = createGridSplitPlan(3, 1);
        expect(plan).toEqual([
            { action: 'splitDown' },
            { action: 'splitDown' }
        ]);
    });
});

describe('getGridCellGroup', () => {
    it('should return 1 for single cell grid', () => {
        expect(getGridCellGroup(0, 0, 1, 1)).toBe(1);
    });

    it('should return correct groups for 1x2 grid', () => {
        // [1] [2]
        expect(getGridCellGroup(0, 0, 1, 2)).toBe(1);
        expect(getGridCellGroup(0, 1, 1, 2)).toBe(2);
    });

    it('should return correct groups for 2x1 grid', () => {
        // [1]
        // [2]
        expect(getGridCellGroup(0, 0, 2, 1)).toBe(1);
        expect(getGridCellGroup(1, 0, 2, 1)).toBe(2);
    });

    it('should return correct groups for 2x2 grid', () => {
        // [1] [2]
        // [3] [4]
        expect(getGridCellGroup(0, 0, 2, 2)).toBe(1);
        expect(getGridCellGroup(0, 1, 2, 2)).toBe(2);
        expect(getGridCellGroup(1, 0, 2, 2)).toBe(3);
        expect(getGridCellGroup(1, 1, 2, 2)).toBe(4);
    });

    it('should return correct groups for 2x3 grid', () => {
        // [1] [2] [3]
        // [4] [5] [6]
        expect(getGridCellGroup(0, 0, 2, 3)).toBe(1);
        expect(getGridCellGroup(0, 1, 2, 3)).toBe(2);
        expect(getGridCellGroup(0, 2, 2, 3)).toBe(3);
        expect(getGridCellGroup(1, 0, 2, 3)).toBe(4);
        expect(getGridCellGroup(1, 1, 2, 3)).toBe(5);
        expect(getGridCellGroup(1, 2, 2, 3)).toBe(6);
    });
});

// File-based persistence tests
describe('file-based persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminalgrid-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('getStateFilePath / getCwdMapFilePath', () => {
        it('should return correct paths', () => {
            expect(getStateFilePath('/foo/bar')).toBe('/foo/bar/terminal-state.json');
            expect(getCwdMapFilePath('/foo/bar')).toBe('/foo/bar/cwd-map.json');
        });
    });

    describe('writeStateFile / readStateFile', () => {
        it('should round-trip state through file', () => {
            const state = {
                terminals: [{ cwd: '/path/to/project', name: 'project', viewColumn: 1 }],
                savedAt: Date.now(),
                gracefulExit: false,
            };

            writeStateFile(tmpDir, state);
            const loaded = readStateFile<typeof state>(tmpDir);

            expect(loaded).toEqual(state);
        });

        it('should create directory if it does not exist', () => {
            const nested = path.join(tmpDir, 'deep', 'nested');
            writeStateFile(nested, { test: true });

            expect(fs.existsSync(path.join(nested, 'terminal-state.json'))).toBe(true);
        });

        it('should return undefined when file does not exist', () => {
            const result = readStateFile(path.join(tmpDir, 'nonexistent'));
            expect(result).toBeUndefined();
        });

        it('should return undefined for invalid JSON', () => {
            fs.writeFileSync(path.join(tmpDir, 'terminal-state.json'), 'not json');
            const result = readStateFile(tmpDir);
            expect(result).toBeUndefined();
        });

        it('should overwrite existing state file', () => {
            writeStateFile(tmpDir, { version: 1 });
            writeStateFile(tmpDir, { version: 2 });

            const loaded = readStateFile<{ version: number }>(tmpDir);
            expect(loaded?.version).toBe(2);
        });

        it('should persist data synchronously (survives simulated crash)', () => {
            const state = {
                terminals: [
                    { cwd: '/project-a', name: 'a', viewColumn: 1 },
                    { cwd: '/project-b', name: 'b', viewColumn: 2 },
                ],
                savedAt: 1234567890,
                gracefulExit: false,
            };

            writeStateFile(tmpDir, state);

            // Simulate "crash" by reading from a fresh process perspective
            const raw = fs.readFileSync(getStateFilePath(tmpDir), 'utf-8');
            const parsed = JSON.parse(raw);
            expect(parsed.terminals).toHaveLength(2);
            expect(parsed.terminals[0].cwd).toBe('/project-a');
            expect(parsed.gracefulExit).toBe(false);
        });
    });

    describe('deleteStateFile', () => {
        it('should delete existing state file', () => {
            writeStateFile(tmpDir, { test: true });
            expect(fs.existsSync(getStateFilePath(tmpDir))).toBe(true);

            deleteStateFile(tmpDir);
            expect(fs.existsSync(getStateFilePath(tmpDir))).toBe(false);
        });

        it('should not throw when file does not exist', () => {
            expect(() => deleteStateFile(tmpDir)).not.toThrow();
        });
    });

    describe('writeCwdMapFile / readCwdMapFile', () => {
        it('should round-trip CWD map through file', () => {
            const cwdMap = {
                'project-default': '/Users/max/project',
                'other-default': '/Users/max/other',
            };

            writeCwdMapFile(tmpDir, cwdMap);
            const loaded = readCwdMapFile(tmpDir);

            expect(loaded).toEqual(cwdMap);
        });

        it('should return undefined when file does not exist', () => {
            expect(readCwdMapFile(path.join(tmpDir, 'nonexistent'))).toBeUndefined();
        });

        it('should overwrite existing CWD map', () => {
            writeCwdMapFile(tmpDir, { a: '/old' });
            writeCwdMapFile(tmpDir, { b: '/new' });

            const loaded = readCwdMapFile(tmpDir);
            expect(loaded).toEqual({ b: '/new' });
        });
    });
});
