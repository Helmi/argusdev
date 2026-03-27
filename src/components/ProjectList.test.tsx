import React from 'react';
import {render} from 'ink-testing-library';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Project} from '../types/index.js';

const {
	mockFetchProjects,
	mockFetchSessions,
	mockOn,
	mockOff,
	mockValidatePath,
	mockAddProject,
	mockRemoveProject,
} = vi.hoisted(() => ({
	mockFetchProjects: vi.fn(),
	mockFetchSessions: vi.fn(),
	mockOn: vi.fn(),
	mockOff: vi.fn(),
	mockValidatePath: vi.fn(),
	mockAddProject: vi.fn(),
	mockRemoveProject: vi.fn(),
}));

// Mock node-pty to avoid native module loading issues
vi.mock('node-pty', () => ({
	spawn: vi.fn(),
}));

// Import the actual component code but skip the useInput hook
vi.mock('ink', async () => {
	const actual = await vi.importActual<typeof import('ink')>('ink');
	return {
		...actual,
		useInput: vi.fn(),
	};
});

// Mock SelectInput to render items as simple text
vi.mock('ink-select-input', async () => {
	const React = await vi.importActual<typeof import('react')>('react');
	const {Text, Box} = await vi.importActual<typeof import('ink')>('ink');

	return {
		default: ({items}: {items: Array<{label: string; value: string}>}) => {
			return React.createElement(
				Box,
				{flexDirection: 'column'},
				items.map((item: {label: string}, index: number) =>
					React.createElement(Text, {key: index}, item.label),
				),
			);
		},
	};
});

// Mock TextInputWrapper to render as simple text
vi.mock('./TextInputWrapper.js', async () => {
	const React = await vi.importActual<typeof import('react')>('react');
	const {Text} = await vi.importActual<typeof import('ink')>('ink');

	return {
		default: ({value, placeholder}: {value?: string; placeholder?: string}) => {
			return React.createElement(Text, {}, value || placeholder || '');
		},
	};
});

vi.mock('./tuiApiClient.js', () => ({
	tuiApiClient: {
		fetchProjects: mockFetchProjects,
		fetchSessions: mockFetchSessions,
		on: mockOn,
		off: mockOff,
		validatePath: mockValidatePath,
		addProject: mockAddProject,
		removeProject: mockRemoveProject,
	},
	worktreeBelongsToProject: vi.fn((worktreePath: string, projectPath: string) =>
		worktreePath.startsWith(projectPath),
	),
}));

const {default: ProjectList} = await import('./ProjectList.js');

describe('ProjectList', () => {
	const mockOnSelectProject = vi.fn();
	const mockOnDismissError = vi.fn();
	const mockProjects: Project[] = [
		{
			name: 'project1',
			path: '/projects/project1',
			lastAccessed: Date.now(),
			isValid: true,
		},
		{
			name: 'project2',
			path: '/projects/project2',
			lastAccessed: Date.now() - 1000,
			isValid: true,
		},
		{
			name: 'project3',
			path: '/projects/project3',
			lastAccessed: Date.now() - 2000,
			isValid: true,
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchProjects.mockResolvedValue(mockProjects);
		mockFetchSessions.mockResolvedValue([]);
		mockValidatePath.mockResolvedValue({
			path: '/tmp',
			exists: true,
			isDirectory: true,
			isGitRepo: true,
		});
		mockAddProject.mockResolvedValue(undefined);
		mockRemoveProject.mockResolvedValue(undefined);
	});

	it('should render project list with correct title', async () => {
		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		expect(lastFrame()).toContain('░▒▓███████▓▒░');
		expect(lastFrame()).toContain('Select a project:');
	});

	it('should display projects from registry', async () => {
		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('project1');
		expect(frame).toContain('project2');
		expect(frame).toContain('project3');
	});

	it('should display empty state when no projects', async () => {
		mockFetchProjects.mockResolvedValue([]);

		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('No projects tracked yet.');
		expect(frame).toContain('argusdev add /path/to/project');
	});

	it('should display invalid project indicator', async () => {
		const projectsWithInvalid: Project[] = [
			{
				name: 'valid-project',
				path: '/projects/valid',
				lastAccessed: Date.now(),
				isValid: true,
			},
			{
				name: 'invalid-project',
				path: '/projects/invalid',
				lastAccessed: Date.now(),
				isValid: false,
			},
		];
		mockFetchProjects.mockResolvedValue(projectsWithInvalid);

		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('⚠️');
	});

	it('should show number shortcuts for projects 0-9', async () => {
		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('0 ❯ project1');
		expect(frame).toContain('1 ❯ project2');
		expect(frame).toContain('2 ❯ project3');
	});

	it('should show add project option', async () => {
		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error={null}
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('Add Project');
	});

	it('should display error when provided', async () => {
		const {lastFrame} = render(
			<ProjectList
				onSelectProject={mockOnSelectProject}
				error="Test error message"
				onDismissError={mockOnDismissError}
			/>,
		);

		await new Promise(resolve => setTimeout(resolve, 50));

		const frame = lastFrame();
		expect(frame).toContain('Error');
		expect(frame).toContain('Test error message');
	});
});
