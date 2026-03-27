import { ReactNode } from 'react'

// TUI-style ASCII logo using gradient block characters
const ASCII_LOGO = `░▒▓░
░▒▓███████▓▒░ ░▒▓███████▓▒░ ░▒▓▓▒ ░▒▓███████▓▒░ ░▒▓████████▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓██▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓██▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█████████▓▒░ ░▒▓███████▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓██▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓██▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓███████▓▒░ ░▒▓█▓▒░ ░▒▓█▓▒░ ░▒▓▓▒░ ░▒▓███████▓▒░ ░▒▓████████▓▒░
░▓▒░`

interface TerminalScreenProps {
  title?: string
  status?: { label: string; value: string; color?: 'green' | 'red' | 'yellow' }
  children: ReactNode
  showLogo?: boolean
}

export function TerminalScreen({ title = 'argusdev://auth', status, children, showLogo = true }: TerminalScreenProps) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0f0a] relative overflow-hidden">
      {/* CRT scanlines overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
        }}
      />

      {/* Subtle vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,255,255,0.04) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Main container */}
      <div className="relative z-20 w-full max-w-2xl mx-4">
        {/* Terminal window */}
        <div className="bg-[#0d120d] border border-[#1a3a3a] rounded-sm shadow-2xl overflow-hidden">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-[#0a0f0a] border-b border-[#1a3a3a]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
            </div>
            <span className="flex-1 text-center text-[10px] text-[#3a6a6a] uppercase tracking-[0.2em] font-mono">
              {title}
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-6 space-y-6">
            {/* ASCII art header */}
            {showLogo && (
              <pre className="text-[#00d4ff] text-[6px] sm:text-[7px] md:text-[8px] leading-tight font-mono text-center select-none opacity-90 overflow-x-auto">
                {ASCII_LOGO}
              </pre>
            )}

            {/* Status line */}
            {status && (
              <div className="font-mono text-xs">
                <div className="text-[#3a6a6a]">
                  <span className="text-[#00d4ff]">[{status.label}]</span>{' '}
                  <span className={
                    status.color === 'red' ? 'text-[#ff6b6b]' :
                    status.color === 'yellow' ? 'text-[#febc2e]' :
                    'text-[#00d4ff]'
                  }>
                    {status.value}
                  </span>
                </div>
              </div>
            )}

            {/* Content */}
            {children}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-[10px] text-[#2a4a4a] font-mono">
          ArgusDev v{import.meta.env.VITE_APP_VERSION || '0.0.0'}
        </div>
      </div>
    </div>
  )
}
