import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		watch: false,
		pool: 'threads',
		environment: 'node',
		setupFiles: ['./src/test/setup.ts'],
		// Exclude worktree directories from test discovery
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'.dev-projects/**',
			'.agents/**',
			'.claude/**',
			// DOM tests live in the client workspace where the vite config
			// (and React copy) match the runtime tree.
			'**/*.dom.test.tsx',
		],
		coverage: {
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'dist/',
				'test/',
				'**/*.d.ts',
				'**/*.config.*',
				'**/mockups/**',
			],
		},
	},
});
