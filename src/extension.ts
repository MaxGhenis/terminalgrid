import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

interface ToolPreset {
    name: string;
    command: string;
    args?: string;
    commonPaths: string[];
}

const PRESETS: Record<string, ToolPreset> = {
    'claude-code': {
        name: 'Claude Code',
        command: 'claude',
        args: '--dangerously-skip-permissions',
        commonPaths: [
            `${os.homedir()}/.claude/local/node_modules/.bin/claude`,
            '/usr/local/bin/claude',
            '/opt/homebrew/bin/claude'
        ]
    },
    'aider': {
        name: 'Aider',
        command: 'aider',
        args: '',
        commonPaths: [
            `${os.homedir()}/.local/bin/aider`,
            '/usr/local/bin/aider',
            '/opt/homebrew/bin/aider'
        ]
    },
    'gemini-cli': {
        name: 'Gemini CLI',
        command: 'gemini',
        args: '',
        commonPaths: [
            `${os.homedir()}/.local/bin/gemini`,
            '/usr/local/bin/gemini',
            '/opt/homebrew/bin/gemini',
            `${os.homedir()}/.npm-global/bin/gemini`
        ]
    },
    'github-copilot': {
        name: 'GitHub Copilot CLI',
        command: 'gh',
        args: 'copilot',
        commonPaths: [
            '/usr/local/bin/gh',
            '/opt/homebrew/bin/gh',
            `${os.homedir()}/.local/bin/gh`
        ]
    },
    'codex': {
        name: 'Codex CLI',
        command: 'codex',
        args: '',
        commonPaths: [
            `${os.homedir()}/.local/bin/codex`,
            '/usr/local/bin/codex',
            '/opt/homebrew/bin/codex',
            `${os.homedir()}/.cargo/bin/codex`
        ]
    },
    'openhands': {
        name: 'OpenHands',
        command: 'openhands',
        args: '',
        commonPaths: [
            `${os.homedir()}/.local/bin/openhands`,
            '/usr/local/bin/openhands',
            '/opt/homebrew/bin/openhands'
        ]
    }
};

async function findCommandPath(commandName: string, commonPaths: string[]): Promise<string | undefined> {
    // Try `which` first
    try {
        const { stdout } = await execAsync(`which ${commandName}`);
        return stdout.trim();
    } catch (error) {
        // Try common paths
        for (const path of commonPaths) {
            try {
                await execAsync(`test -f ${path}`);
                return path;
            } catch {
                continue;
            }
        }
    }
    return undefined;
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

    // Configure terminal profile based on preset
    const preset = config.get<string>('preset', 'none');

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

    if (preset === 'none') {
        // Just use default shell
        await globalConfig.update(defaultProfileKey, shell, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('TerminalGrid configured with default shell');
        return;
    }

    let command: string = '';
    let args: string = '';
    let profileName: string = 'TerminalGrid';

    if (preset === 'custom') {
        command = config.get<string>('customCommand', '');
        args = config.get<string>('customCommandArgs', '');

        if (!command) {
            vscode.window.showErrorMessage('Custom command not configured. Please set terminalgrid.customCommand');
            return;
        }
        profileName = 'TerminalGrid (Custom)';
    } else if (PRESETS[preset]) {
        const presetConfig = PRESETS[preset];
        const detectedPath = await findCommandPath(presetConfig.command, presetConfig.commonPaths);

        if (!detectedPath) {
            vscode.window.showErrorMessage(
                `${presetConfig.name} not found. Please install it or use custom preset.`
            );
            return;
        }

        command = detectedPath;
        args = presetConfig.args || '';
        profileName = `TerminalGrid (${presetConfig.name})`;
    }

    // Build shell args to launch the command
    let shellArgs: string[];
    const fullCommand = args ? `${command} ${args}` : command;

    if (platform === 'win32') {
        shellArgs = ['-NoExit', '-Command', `& '${fullCommand}'`];
    } else {
        shellArgs = ['-l', '-c', `source ~/.${shell}rc 2>/dev/null; ${fullCommand}; exec ${shell}`];
    }

    const updatedProfiles = {
        ...profiles,
        [profileName]: {
            path: shell,
            args: shellArgs
        },
        [shell]: {
            path: shell
        }
    };

    await globalConfig.update(profileKey, updatedProfiles, vscode.ConfigurationTarget.Global);
    await globalConfig.update(defaultProfileKey, profileName, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(`TerminalGrid configured with ${profileName}!`);
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

    // Register setup command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.setup', async () => {
            await configureTerminalSettings();
            await context.globalState.update('hasConfigured', true);
        })
    );

    // Register preset selection command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.selectPreset', async () => {
            const items = [
                { label: 'None', description: 'Plain terminal, no auto-launch', value: 'none' },
                { label: 'GitHub Copilot CLI', description: '20M+ users, 90% of Fortune 100', value: 'github-copilot' },
                { label: 'Claude Code', description: 'AI pair programming (Anthropic)', value: 'claude-code' },
                { label: 'Codex CLI', description: 'OpenAI\'s terminal coding agent', value: 'codex' },
                { label: 'Aider', description: 'AI pair programming with Git integration', value: 'aider' },
                { label: 'Gemini CLI', description: 'Google\'s free AI assistant (60 req/min)', value: 'gemini-cli' },
                { label: 'OpenHands', description: 'Open source AI coding agent', value: 'openhands' },
                { label: 'Custom', description: 'Custom command (configure in settings)', value: 'custom' }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select tool to auto-launch in terminals'
            });

            if (selected) {
                const config = vscode.workspace.getConfiguration('terminalgrid');
                await config.update('preset', selected.value, vscode.ConfigurationTarget.Global);
                await configureTerminalSettings();
            }
        })
    );

    // Register split down and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitDownAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
            await vscode.commands.executeCommand('workbench.action.terminal.new');
        })
    );

    // Register split right and open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.splitRightAndOpenTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.splitEditorRight');
            await vscode.commands.executeCommand('workbench.action.terminal.new');
        })
    );

    // Register open terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('terminalgrid.openTerminal', async () => {
            await vscode.commands.executeCommand('workbench.action.terminal.new');
        })
    );

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('terminalgrid')) {
                // Optionally reconfigure when settings change
                // await configureTerminalSettings();
            }
        })
    );
}

export function deactivate() {}
