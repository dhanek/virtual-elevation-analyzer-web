import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: ['dist/**', 'pkg/**', 'node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            'no-console': 'error',
            'no-empty': 'off',
            'prefer-const': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
    {
        files: ['src/utils/log.ts'],
        rules: {
            'no-console': 'off',
        },
    },
    // The Node-side scripts. They were linted by nothing until this block
    // existed: `npm run lint` ran `eslint src`, and the rules above are scoped
    // to `src/**/*.ts`, so a scripts file matched neither.
    //
    // `no-console` is ERROR here, the same as in `src`, because every script
    // already writes its results through `process.stdout.write` — none of the
    // five contains a single `console.` call. Keeping the rule matched to `src`
    // means a script that reaches for `console.log` has to say why, rather than
    // quietly interleaving log lines with output a consumer parses.
    {
        files: ['scripts/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'error',
            'no-empty': 'off',
            'prefer-const': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
)
