import {defineConfig, mergeConfig} from 'vitest/config'
import viteConfig from './vite.config'

// Run client-side DOM tests with the same Vite config as the dev server, so
// the @ alias, React copy and @xyflow/react resolution all match runtime.
export default mergeConfig(
	viteConfig({mode: 'test', command: 'serve'}),
	defineConfig({
		test: {
			globals: true,
			environment: 'jsdom',
			include: ['src/**/*.dom.test.tsx', 'src/**/*.dom.test.ts'],
		},
	}),
)
