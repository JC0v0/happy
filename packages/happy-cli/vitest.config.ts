import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        globalSetup: ['./src/test-setup.ts'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
                    exclude: ['src/**/*.integration.test.ts'],
                    sequence: {
                        groupOrder: 0,
                    },
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@': resolve('./src'),
        },
    },
})
