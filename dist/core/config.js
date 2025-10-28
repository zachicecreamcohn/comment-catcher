import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
const defaultConfig = {
    excludePatterns: ['node_modules', 'dist', 'build', '.git'],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    commentFilters: {
        minLength: 10,
        ignorePatterns: ['TODO:', 'FIXME:', 'NOTE:', 'HACK:', '@ts-', 'eslint-', 'prettier-'],
    },
};
let cachedConfig = null;
export async function loadConfig() {
    if (cachedConfig !== null) {
        return cachedConfig;
    }
    const configPaths = [
        'comment-catcher.config.json',
        '.comment-catcher.json',
        'comment-catcher.config.js',
    ];
    for (const configPath of configPaths) {
        if (existsSync(configPath)) {
            console.log(`📋 Loading config from ${configPath}`);
            let loadedConfig;
            if (configPath.endsWith('.js')) {
                // Dynamic import for JS config
                const module = await import(join(process.cwd(), configPath));
                loadedConfig = module.default || module;
            }
            else {
                const configContent = readFileSync(configPath, 'utf-8');
                const userConfig = JSON.parse(configContent);
                loadedConfig = { ...defaultConfig, ...userConfig };
                // Debug logging for llmOptions
                if (userConfig.llmOptions) {
                    console.log(`   Loaded llmOptions from config: ${JSON.stringify(userConfig.llmOptions)}`);
                }
            }
            cachedConfig = loadedConfig;
            return loadedConfig;
        }
    }
    cachedConfig = defaultConfig;
    return defaultConfig;
}
//# sourceMappingURL=config.js.map