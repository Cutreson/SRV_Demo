/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'] },
      colors: {
        ink: { 50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e1', 300: '#b0b7c6', 400: '#8590a6', 500: '#64708a', 600: '#4e5871', 700: '#40485c', 800: '#2b3140', 900: '#1b1f29' },
        brand: { 50: '#fff4ec', 100: '#ffe4d1', 500: '#e8772e', 600: '#d0621b', 700: '#a94d14' },
      },
    },
  },
  plugins: [],
};
