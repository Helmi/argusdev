// Map file extensions to language identifiers for syntax highlighting
export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Data formats
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    csv: 'csv',

    // Python
    py: 'python',
    pyw: 'python',
    pyi: 'python',

    // Ruby
    rb: 'ruby',
    rake: 'ruby',
    gemspec: 'ruby',

    // Go
    go: 'go',

    // Rust
    rs: 'rust',

    // Java/Kotlin
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',

    // C/C++
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',

    // C#
    cs: 'csharp',

    // PHP
    php: 'php',

    // Swift
    swift: 'swift',

    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',

    // Markdown
    md: 'markdown',
    mdx: 'markdown',

    // SQL
    sql: 'sql',

    // Docker
    dockerfile: 'docker',

    // Misc
    graphql: 'graphql',
    gql: 'graphql',
    prisma: 'prisma',
    vue: 'vue',
    svelte: 'svelte',
  }

  // Handle special filenames
  const specialFiles: Record<string, string> = {
    dockerfile: 'docker',
    makefile: 'makefile',
    'docker-compose.yml': 'yaml',
    'docker-compose.yaml': 'yaml',
    '.gitignore': 'gitignore',
    '.env': 'bash',
    '.env.local': 'bash',
    '.env.example': 'bash',
  }

  const lowerFilename = filename.toLowerCase()
  if (specialFiles[lowerFilename]) {
    return specialFiles[lowerFilename]
  }

  return ext ? (languageMap[ext] || 'text') : 'text'
}

export function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'mdx'
}
