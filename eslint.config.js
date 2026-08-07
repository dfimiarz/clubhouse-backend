const js = require('@eslint/js');
const globals = require('globals');

const unusedVars = ['error', { argsIgnorePattern: '^_' }];

module.exports = [
    {
        ignores: ['.yarn/**', '.pnp.*', 'node_modules/**']
    },
    js.configs.recommended,
    {
        //Application and script code is CommonJS
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node
        },
        rules: {
            'no-unused-vars': unusedVars
        }
    },
    {
        //The test suite is ESM and runs under mocha
        files: ['**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.mocha }
        },
        rules: {
            'no-unused-vars': unusedVars
        }
    }
];
