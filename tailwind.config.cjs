/** @type {import('tailwindcss').Config} */
module.exports = {
  // Explicitly list project sources to avoid accidentally scanning node_modules (performance + stability).
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};


