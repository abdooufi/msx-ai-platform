import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e6f7ff',
          100: '#b3e6ff',
          200: '#80d4ff',
          300: '#4dc2ff',
          400: '#1ab0ff',
          500: '#0099e6',
          600: '#007ab8',
          700: '#005c8a',
          800: '#003d5c',
          900: '#001f2e',
        },
        msx: {
          blue:  '#003d7a',
          gold:  '#c8a84b',
          light: '#e8f4fd',
        },
      },
      fontFamily: {
        sans:   ['Inter', 'ui-sans-serif', 'system-ui'],
        arabic: ['Cairo', 'Tajawal', 'ui-sans-serif'],
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-in-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'typing':     'typing 1.2s steps(3) infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        typing:  { '0%, 100%': { opacity: '0.2' }, '50%': { opacity: '1' } },
      },
    },
  },
  plugins: [],
}

export default config
