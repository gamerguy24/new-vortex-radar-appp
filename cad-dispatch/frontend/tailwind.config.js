/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        neon: '0 0 24px rgba(14, 116, 144, 0.35)',
      },
      colors: {
        cad: {
          ink: '#020617',
          panel: 'rgba(4, 12, 24, 0.78)',
          accent: '#06b6d4',
          alert: '#fb7185',
        },
      },
    },
  },
  plugins: [],
};
