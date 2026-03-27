// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://helmi.github.io',
	base: '/argusdev',
	integrations: [
		starlight({
			title: 'ArgusDev',
			tagline: 'The All-Seeing Dashboard for Coding Agents',
			logo: {
				src: './public/logo.svg',
				alt: 'ArgusDev Logo',
			},
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Helmi/argusdev' }],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start', slug: 'getting-started/quick-start' },
					],
				},
				{
					label: 'Features',
					items: [
						{ label: 'Session Management', slug: 'features/session-management' },
						{ label: 'Multi-Agent Support', slug: 'features/multi-agent' },
						{ label: 'Git Worktrees', slug: 'features/git-worktrees' },
						{ label: 'Multi-Project', slug: 'features/multi-project' },
						{ label: 'Status Detection', slug: 'features/status-detection' },
						{ label: 'Auto-Approval', slug: 'features/auto-approval' },
						{ label: 'Session Data Copying', slug: 'features/session-data-copying' },
						{ label: 'Devcontainer Support', slug: 'features/devcontainer' },
					],
				},
				{
					label: 'Configuration',
					items: [
						{ label: 'Agent Profiles', slug: 'configuration/agent-profiles' },
						{ label: 'Status Hooks', slug: 'configuration/status-hooks' },
						{ label: 'Worktree Hooks', slug: 'configuration/worktree-hooks' },
						{ label: 'Keyboard Shortcuts', slug: 'configuration/shortcuts' },
						{ label: 'Project Config', slug: 'configuration/project-config' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI Commands', slug: 'reference/cli-commands' },
						{ label: 'Environment Variables', slug: 'reference/environment-variables' },
						{ label: 'Configuration File', slug: 'reference/config-file' },
					],
				},
			],
			editLink: {
				baseUrl: 'https://github.com/Helmi/argusdev/edit/main/docs/',
			},
		}),
	],
});
