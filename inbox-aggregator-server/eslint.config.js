// Lint rules for the server. It has no ESLint of its own (nothing to install
// on Render); run the frontend's from this folder:
//   ../inbox-aggregator/node_modules/.bin/eslint .
const nodeGlobals = Object.fromEntries([
  'require', 'module', 'exports', '__dirname', 'process', 'console', 'Buffer', 'URL', 'URLSearchParams',
  'fetch', 'AbortSignal', 'TextDecoder', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
].map(name => [name, 'readonly']));

module.exports = [
  { ignores: ['node_modules/'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
