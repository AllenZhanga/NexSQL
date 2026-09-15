/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // VS Code-inspired dark theme
        app: {
          bg: 'var(--app-bg)',
          sidebar: 'var(--app-sidebar)',
          panel: 'var(--app-panel)',
          header: 'var(--app-header)',
          border: 'var(--app-border)',
          hover: 'var(--app-hover)',
          active: 'var(--app-active)',
          input: 'var(--app-input)'
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          link: 'var(--text-link)'
        },
        accent: {
          blue: '#0078d4',
          green: '#4ec9b0',
          red: '#f44747',
          yellow: '#cca700',
          orange: '#ce9178'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Monaco', 'monospace']
      },
      fontSize: {
        '2xs': '0.6875rem'
      }
    }
  },
  plugins: []
}
