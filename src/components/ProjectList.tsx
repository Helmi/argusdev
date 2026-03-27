import React, {useState, useEffect, useRef, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {GitProject, Project, SessionState} from '../types/index.js';
import TextInputWrapper from './TextInputWrapper.js';
import {useSearchMode} from '../hooks/useSearchMode.js';
import Header from './Header.js';
import {
	tuiApiClient,
	type ApiSession,
	worktreeBelongsToProject,
} from './tuiApiClient.js';

type ValidationState = 'idle' | 'checking' | 'valid' | 'invalid' | 'not-found';

interface ProjectListProps {
	onSelectProject: (project: GitProject) => void;
	onOpenConfiguration?: () => void;
	error: string | null;
	onDismissError: () => void;
	webConfig?: {
		url: string;
		externalUrl?: string;
		hostname?: string;
		port: number;
		configDir: string;
		isCustomConfigDir: boolean;
	};
}

interface MenuItem {
	label: string;
	value: string;
	project?: GitProject;
}

function formatProjectSessionCounts(
	projectPath: string,
	sessions: ApiSession[],
): string {
	const counts: Record<SessionState, number> = {
		idle: 0,
		busy: 0,
		waiting_input: 0,
		pending_auto_approval: 0,
	};
	let total = 0;

	for (const session of sessions) {
		if (!worktreeBelongsToProject(session.path, projectPath)) {
			continue;
		}
		counts[session.state]++;
		total++;
	}

	if (total === 0) {
		return '';
	}

	const parts: string[] = [];
	if (counts.idle > 0) {
		parts.push(`${counts.idle} Idle`);
	}
	if (counts.busy > 0) {
		parts.push(`${counts.busy} Busy`);
	}
	if (counts.waiting_input > 0) {
		parts.push(`${counts.waiting_input} Waiting`);
	}

	return parts.length > 0 ? ` (${parts.join(' / ')})` : '';
}

const ProjectList: React.FC<ProjectListProps> = ({
	onSelectProject,
	onOpenConfiguration,
	error,
	onDismissError,
	webConfig,
}) => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [sessions, setSessions] = useState<ApiSession[]>([]);
	const [items, setItems] = useState<MenuItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [addingProject, setAddingProject] = useState(false);
	const [addProjectPath, setAddProjectPath] = useState('');
	const [addProjectError, setAddProjectError] = useState<string | null>(null);
	const [validationState, setValidationState] =
		useState<ValidationState>('idle');
	const validationAbortRef = useRef<AbortController | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState<Project | null>(
		null,
	);
	const [highlightedItem, setHighlightedItem] = useState<MenuItem | null>(null);
	const limit = 10;

	const displayError = error || addProjectError;
	const {isSearchMode, searchQuery, selectedIndex, setSearchQuery} =
		useSearchMode(items.length, {
			isDisabled: !!displayError || addingProject || !!confirmingDelete,
			skipInTest: false,
		});

	const loadProjects = useCallback(async () => {
		setLoading(true);
		try {
			const [loadedProjects, loadedSessions] = await Promise.all([
				tuiApiClient.fetchProjects(),
				tuiApiClient.fetchSessions(),
			]);
			setProjects(loadedProjects);
			setSessions(loadedSessions);
		} catch (loadError) {
			setAddProjectError(
				`Failed to load projects: ${
					loadError instanceof Error ? loadError.message : String(loadError)
				}`,
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadProjects();
	}, [loadProjects]);

	useEffect(() => {
		const handleSessionUpdate = () => {
			tuiApiClient
				.fetchSessions()
				.then(setSessions)
				.catch(() => {
					/* ignore transient socket refresh failures */
				});
		};

		tuiApiClient.on('session_update', handleSessionUpdate);
		return () => {
			tuiApiClient.off('session_update', handleSessionUpdate);
		};
	}, []);

	useEffect(() => {
		if (!addingProject || !addProjectPath.trim()) {
			setValidationState('idle');
			return;
		}

		const path = addProjectPath.trim();

		if (validationAbortRef.current) {
			validationAbortRef.current.abort();
		}

		setValidationState('checking');

		const abortController = new AbortController();
		validationAbortRef.current = abortController;

		const timeoutId = setTimeout(async () => {
			if (abortController.signal.aborted) return;

			try {
				const result = await tuiApiClient.validatePath(path);
				if (abortController.signal.aborted) return;

				if (!result.exists) {
					setValidationState('not-found');
					return;
				}

				setValidationState(result.isGitRepo ? 'valid' : 'invalid');
			} catch {
				if (abortController.signal.aborted) return;
				setValidationState('invalid');
			}
		}, 300);

		return () => {
			clearTimeout(timeoutId);
			abortController.abort();
		};
	}, [addingProject, addProjectPath]);

	useEffect(() => {
		const menuItems: MenuItem[] = [];
		let currentIndex = 0;

		const filteredProjects = searchQuery
			? projects.filter(project =>
					project.name.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: projects;

		filteredProjects.forEach(project => {
			const countsFormatted = formatProjectSessionCounts(
				project.path,
				sessions,
			);
			const invalidIndicator = project.isValid === false ? ' ⚠️' : '';
			const numberPrefix =
				!isSearchMode && currentIndex < 10 ? `${currentIndex} ❯ ` : '❯ ';

			menuItems.push({
				label: numberPrefix + project.name + invalidIndicator + countsFormatted,
				value: project.path,
				project: {
					path: project.path,
					name: project.name,
					relativePath: project.name,
					isValid: project.isValid ?? true,
				},
			});
			currentIndex++;
		});

		if (!isSearchMode) {
			if (projects.length > 0) {
				menuItems.push({
					label: '─────────────',
					value: 'separator',
				});
			}

			menuItems.push({
				label: `A - Add Project`,
				value: 'add-project',
			});
			menuItems.push({
				label: `D - Remove Project`,
				value: 'remove-project',
			});
			menuItems.push({
				label: `C - Global Config`,
				value: 'settings',
			});
			menuItems.push({
				label: `R - Refresh`,
				value: 'refresh',
			});
			menuItems.push({
				label: `Q - Quit`,
				value: 'exit',
			});
		}

		setItems(menuItems);
	}, [projects, sessions, searchQuery, isSearchMode]);

	const handleAddProject = async () => {
		if (!addProjectPath.trim()) {
			setAddProjectError('Path cannot be empty');
			return;
		}

		if (validationState === 'checking') {
			setAddProjectError('Please wait for validation to complete');
			return;
		}

		if (validationState === 'invalid' || validationState === 'not-found') {
			setAddProjectError(
				validationState === 'not-found'
					? 'Path does not exist'
					: 'Not a valid git repository',
			);
			return;
		}

		try {
			await tuiApiClient.addProject(addProjectPath.trim());
			setAddingProject(false);
			setAddProjectPath('');
			setAddProjectError(null);
			setValidationState('idle');
			await loadProjects();
		} catch (addError) {
			setAddProjectError(
				addError instanceof Error
					? addError.message
					: 'Not a valid git repository',
			);
		}
	};

	const handleRemoveProject = async (project: Project) => {
		try {
			await tuiApiClient.removeProject(project.path);
			setConfirmingDelete(null);
			await loadProjects();
		} catch (removeError) {
			setAddProjectError(
				removeError instanceof Error
					? removeError.message
					: 'Failed to remove project',
			);
		}
	};

	const getHighlightedProject = (): Project | null => {
		if (isSearchMode) {
			const selectableItems = items.filter(item => item.project);
			if (selectedIndex >= 0 && selectedIndex < selectableItems.length) {
				const projectPath = selectableItems[selectedIndex]?.project?.path;
				if (projectPath) {
					return projects.find(p => p.path === projectPath) || null;
				}
			}
			return null;
		}

		if (highlightedItem?.project) {
			return (
				projects.find(p => p.path === highlightedItem.project?.path) || null
			);
		}
		return null;
	};

	useInput((input, key) => {
		if (!process.stdin.setRawMode) {
			return;
		}

		if (confirmingDelete) {
			if (key.escape || input.toLowerCase() === 'n') {
				setConfirmingDelete(null);
			} else if (input.toLowerCase() === 'y') {
				void handleRemoveProject(confirmingDelete);
			}
			return;
		}

		if (addingProject) {
			if (key.escape) {
				setAddingProject(false);
				setAddProjectPath('');
				setAddProjectError(null);
				setValidationState('idle');
			} else if (key.return) {
				void handleAddProject();
			}
			return;
		}

		if (displayError && onDismissError) {
			if (addProjectError) {
				setAddProjectError(null);
			} else {
				onDismissError();
			}
			return;
		}

		if (isSearchMode) {
			return;
		}

		const keyPressed = input.toLowerCase();

		if (/^[0-9]$/.test(keyPressed)) {
			const index = Number.parseInt(keyPressed, 10);
			const selectableItems = items.filter(item => item.project);
			if (
				index < Math.min(10, selectableItems.length) &&
				selectableItems[index]?.project
			) {
				onSelectProject(selectableItems[index].project!);
			}
			return;
		}

		switch (keyPressed) {
			case 'a':
				setAddingProject(true);
				setAddProjectPath(process.cwd());
				break;
			case 'd': {
				const project = getHighlightedProject();
				if (project) {
					setConfirmingDelete(project);
				}
				break;
			}
			case 'c':
				if (onOpenConfiguration) {
					onOpenConfiguration();
				}
				break;
			case 'r':
				void loadProjects();
				break;
			case 'q':
			case 'x':
				onSelectProject({
					path: 'EXIT_APPLICATION',
					name: '',
					relativePath: '',
					isValid: false,
				});
				break;
		}
	});

	const handleSelect = (item: MenuItem) => {
		if (item.value.startsWith('separator')) {
			return;
		}
		if (item.value === 'add-project') {
			setAddingProject(true);
			setAddProjectPath(process.cwd());
			return;
		}
		if (item.value === 'remove-project') {
			const project = getHighlightedProject();
			if (project) {
				setConfirmingDelete(project);
			} else {
				setAddProjectError(
					'Highlight a project first, then press D to remove it',
				);
			}
			return;
		}
		if (item.value === 'settings') {
			onOpenConfiguration?.();
			return;
		}
		if (item.value === 'refresh') {
			void loadProjects();
			return;
		}
		if (item.value === 'exit') {
			onSelectProject({
				path: 'EXIT_APPLICATION',
				name: '',
				relativePath: '',
				isValid: false,
			});
			return;
		}
		if (item.project) {
			onSelectProject(item.project);
		}
	};

	return (
		<Box flexDirection="column">
			<Header webConfig={webConfig} />

			<Box marginBottom={1}>
				<Text dimColor>Select a project:</Text>
			</Box>

			{confirmingDelete ? (
				<Box
					flexDirection="column"
					marginBottom={1}
					borderStyle="round"
					borderColor="red"
					paddingX={1}
				>
					<Text color="red" bold>
						Remove project from list?
					</Text>
					<Text>{confirmingDelete.name}</Text>
					<Text dimColor>{confirmingDelete.path}</Text>
					<Box marginTop={1}>
						<Text>Press </Text>
						<Text color="green" bold>
							Y
						</Text>
						<Text> to confirm, </Text>
						<Text color="yellow" bold>
							N
						</Text>
						<Text> or </Text>
						<Text color="yellow" bold>
							ESC
						</Text>
						<Text> to cancel</Text>
					</Box>
					<Text dimColor>(This only removes from the list, not from disk)</Text>
				</Box>
			) : addingProject ? (
				<Box flexDirection="column" marginBottom={1}>
					<Box marginBottom={1}>
						<Text>Add project path: </Text>
						<TextInputWrapper
							value={addProjectPath}
							onChange={setAddProjectPath}
							focus={true}
							placeholder="Enter path to git repository..."
						/>
						<Text> </Text>
						{validationState === 'idle' && <Text dimColor>...</Text>}
						{validationState === 'checking' && <Text color="yellow">⏳</Text>}
						{validationState === 'valid' && <Text color="green">✓</Text>}
						{validationState === 'invalid' && (
							<Text color="red">✗ not a git repo</Text>
						)}
						{validationState === 'not-found' && (
							<Text color="red">✗ path not found</Text>
						)}
					</Box>
					<Text dimColor>Enter to add, Escape to cancel</Text>
					<Text dimColor>Tip: Run `argusdev add .` from any project directory</Text>
				</Box>
			) : isSearchMode ? (
				<Box marginBottom={1}>
					<Text>Search: </Text>
					<TextInputWrapper
						value={searchQuery}
						onChange={setSearchQuery}
						focus={true}
						placeholder="Type to filter projects..."
					/>
				</Box>
			) : null}

			{loading ? (
				<Box>
					<Text color="yellow">Loading projects...</Text>
				</Box>
			) : (
				<>
					{projects.length === 0 &&
						!displayError &&
						!addingProject &&
						!isSearchMode && (
							<Box flexDirection="column" marginBottom={1}>
								<Box marginBottom={1}>
									<Text color="yellow">No projects tracked yet.</Text>
								</Box>
								<Text dimColor>
									Select an option below or run: argusdev add /path/to/project
								</Text>
							</Box>
						)}

					{isSearchMode && items.length === 0 && (
						<Box>
							<Text color="yellow">No projects match your search</Text>
						</Box>
					)}

					{!addingProject &&
						!(isSearchMode && items.length === 0) &&
						(isSearchMode ? (
							<Box flexDirection="column">
								{items.slice(0, limit).map((item, index) => (
									<Text
										key={item.value}
										color={index === selectedIndex ? 'green' : undefined}
									>
										{index === selectedIndex ? '❯ ' : '  '}
										{item.label}
									</Text>
								))}
							</Box>
						) : (
							<SelectInput
								items={items}
								onSelect={handleSelect}
								onHighlight={setHighlightedItem}
								isFocused={!displayError && !confirmingDelete}
								limit={limit}
								initialIndex={selectedIndex}
							/>
						))}
				</>
			)}

			{displayError && (
				<Box marginTop={1} paddingX={1} borderStyle="round" borderColor="red">
					<Box flexDirection="column">
						<Text color="red" bold>
							Error: {displayError}
						</Text>
						<Text color="gray" dimColor>
							Press any key to dismiss
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default ProjectList;
