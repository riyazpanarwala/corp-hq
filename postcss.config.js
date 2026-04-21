// postcss.config.js
// Tailwind CSS v4 uses @tailwindcss/postcss instead of the old tailwindcss plugin.
// The autoprefixer is still supported but optional in v4 (it has vendor prefixing built-in).
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
