import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import ConfigureShortcuts from './ConfigureShortcuts.js';
import ConfigureStatusHooks from './ConfigureStatusHooks.js';
import ConfigureWorktreeHooks from './ConfigureWorktreeHooks.js';
import ConfigureWorktree from './ConfigureWorktree.js';
import ConfigureOther from './ConfigureOther.js';
import {shortcutManager} from '../services/shortcutManager.js';
import Header from './Header.js';

interface ConfigurationProps {
	onComplete: () => void;
	onQuit?: () => void;
}

type ConfigView =
	| 'menu'
	| 'shortcuts'
	| 'statusHooks'
	| 'worktreeHooks'
	| 'worktree'
	| 'other';

interface MenuItem {
	label: string;
	value: string;
}

const Configuration: React.FC<ConfigurationProps> = ({onComplete, onQuit}) => {
	const [view, setView] = useState<ConfigView>('menu');

	const menuItems: MenuItem[] = [
		{
			label: 'S - Shortcuts',
			value: 'shortcuts',
		},
		{
			label: 'H - Status Hooks',
			value: 'statusHooks',
		},
		{
			label: 'T - Worktree Hooks',
			value: 'worktreeHooks',
		},
		{
			label: 'W - Worktree Settings',
			value: 'worktree',
		},
		{
			label: 'A - Agents (configure in WebUI)',
			value: 'agents-info',
		},
		{
			label: 'O - Other & Experimental',
			value: 'other',
		},
		{
			label: 'B - Back to Main Menu',
			value: 'back',
		},
		{
			label: 'Q - Quit',
			value: 'quit',
		},
	];

	const handleSelect = (item: MenuItem) => {
		if (item.value === 'back') {
			onComplete();
		} else if (item.value === 'quit') {
			if (onQuit) {
				onQuit();
			} else {
				process.exit(0);
			}
		} else if (item.value === 'shortcuts') {
			setView('shortcuts');
		} else if (item.value === 'statusHooks') {
			setView('statusHooks');
		} else if (item.value === 'worktreeHooks') {
			setView('worktreeHooks');
		} else if (item.value === 'worktree') {
			setView('worktree');
		} else if (item.value === 'agents-info') {
			// No-op - agents are configured in WebUI
			// The menu item is informational only
		} else if (item.value === 'other') {
			setView('other');
		}
	};

	const handleSubMenuComplete = () => {
		setView('menu');
	};

	// Handle hotkeys (only when in menu view)
	useInput((input, key) => {
		if (view !== 'menu') return; // Only handle hotkeys in menu view

		const keyPressed = input.toLowerCase();

		switch (keyPressed) {
			case 's':
				setView('shortcuts');
				break;
			case 'h':
				setView('statusHooks');
				break;
			case 't':
				setView('worktreeHooks');
				break;
			case 'w':
				setView('worktree');
				break;
			case 'a':
				// Agents are configured in WebUI - no action needed
				break;
			case 'o':
				setView('other');
				break;
			case 'b':
				onComplete();
				break;
			case 'q':
				if (onQuit) {
					onQuit();
				} else {
					process.exit(0);
				}
				break;
		}

		// Handle escape key
		if (shortcutManager.matchesShortcut('cancel', input, key)) {
			onComplete();
		}
	});

	if (view === 'shortcuts') {
		return <ConfigureShortcuts onComplete={handleSubMenuComplete} />;
	}

	if (view === 'statusHooks') {
		return <ConfigureStatusHooks onComplete={handleSubMenuComplete} />;
	}

	if (view === 'worktreeHooks') {
		return <ConfigureWorktreeHooks onComplete={handleSubMenuComplete} />;
	}

	if (view === 'worktree') {
		return <ConfigureWorktree onComplete={handleSubMenuComplete} />;
	}

	if (view === 'other') {
		return <ConfigureOther onComplete={handleSubMenuComplete} />;
	}

	return (
		<Box flexDirection="column">
			<Header subtitle="Global Config" />

			<Box marginBottom={1}>
				<Text dimColor>Select a configuration option:</Text>
			</Box>

			<SelectInput
				items={menuItems}
				onSelect={handleSelect}
				isFocused={true}
				limit={10}
			/>

			<Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
				<Text dimColor>
					These settings apply globally. For project-specific hooks, create a
					.argusdev.json file in the project root.
				</Text>
			</Box>
		</Box>
	);
};

export default Configuration;
