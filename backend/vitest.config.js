import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: "./test/vitest.setup.js",
        coverage: {
            reporter: ["text", "html"],
        },
    },
})
