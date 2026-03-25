import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Read version from root package.json
function getVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, '../package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    return packageJson.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Read API port from dev config if available
function getApiPort(): number {
  try {
    const configPath = path.resolve(__dirname, '../.cacd-dev/config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.port || 3000
  } catch {
    return 3000
  }
}

const apiPort = getApiPort()
const version = getVersion()

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Inject version at build time - accessible as import.meta.env.VITE_APP_VERSION
    // Append -dev suffix in development mode
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      mode === 'development' ? `${version}-dev` : version
    ),
  },
  server: {
    host: true, // Listen on all interfaces (0.0.0.0) for LAN access
    allowedHosts: true, // Allow all hosts (localhost, IPs, custom domains)
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        cookieDomainRewrite: '',
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Proxying:', req.method, req.url, '→', `localhost:${apiPort}`);
          });
        },
      },
      '/socket.io': {
        target: `http://localhost:${apiPort}`,
        ws: true,
        changeOrigin: true,
      }
    }
  }
}))
