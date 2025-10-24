import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface CommentCatcherConfig {
  // Patterns to exclude from dependency analysis
  excludePatterns?: string[];
  // File extensions to consider
  extensions?: string[];
  // Dependency cruiser options
  dependencyOptions?: {
    // Whether to use tsconfig paths
    tsConfig?: string;
    // Whether to resolve webpack aliases
    webpackConfig?: string;
    // Additional resolve options
    enhancedResolveOptions?: any;
  };
  // Comment filtering
  commentFilters?: {
    // Minimum comment length
    minLength?: number;
    // Patterns to ignore (like TODO, FIXME)
    ignorePatterns?: string[];
  };
  // LLM options
  llmOptions?: {
    model?: string;
    baseURL?: string;
    apiKeyEnvVar?: string;  // Name of environment variable containing API key
    baseURLEnvVar?: string; // Name of environment variable containing base URL
  };
}

const defaultConfig: CommentCatcherConfig = {
  excludePatterns: ['node_modules', 'dist', 'build', '.git'],
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  commentFilters: {
    minLength: 10,
    ignorePatterns: ['TODO:', 'FIXME:', 'NOTE:', 'HACK:', '@ts-', 'eslint-', 'prettier-'],
  },
};

export async function loadConfig(): Promise<CommentCatcherConfig> {
  const configPaths = [
    'comment-catcher.config.json',
    '.comment-catcher.json',
    'comment-catcher.config.js',
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      console.log(`📋 Loading config from ${configPath}`);
      
      if (configPath.endsWith('.js')) {
        // Dynamic import for JS config
        const module = await import(join(process.cwd(), configPath));
        return module.default || module;
      } else {
        const configContent = readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(configContent);
        return { ...defaultConfig, ...userConfig };
      }
    }
  }

  return defaultConfig;
}