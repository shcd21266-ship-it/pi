/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        glass: {
          DEFAULT: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.1)',
        }
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
};
