/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brain: {
          object: '#8b5cf6',
          array: '#06b6d4',
          string: '#22c55e',
          number: '#f59e0b',
          boolean: '#ec4899',
          null: '#64748b',
        },
      },
    },
  },
  plugins: [],
};
