import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.*',
      // The Alexa Lambda is a separate deploy artifact with its own (Node/CJS)
      // runtime and toolchain — not part of the monorepo's TS lint.
      'apps/alexa/**',
      // Native iOS app (Swift/Xcode) — nothing for the TS toolchain to see.
      'apps/ios/**',
      // Claude Code worktrees are throwaway checkouts, not part of this tree.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
