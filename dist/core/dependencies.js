import { cruise } from 'dependency-cruiser';
import { loadConfig } from './config.js';
/**
 * Finds files related to the changed files using dependency-cruiser.
 * This includes both:
 * - Files that depend on (import) the changed files (dependents)
 * - Files that the changed files depend on (dependencies)
 *
 * Key optimization: Instead of scanning the entire codebase, we only scan
 * the changed files and let dependency-cruiser traverse outward from there.
 */
export async function getDependents(changedFiles, depth) {
    if (changedFiles.length === 0) {
        return [];
    }
    const config = await loadConfig();
    console.log('   Changed files to analyze:', changedFiles);
    try {
        const cruiseOptions = {
            maxDepth: depth,
            doNotFollow: {
                path: 'node_modules',
            },
            exclude: config.excludePatterns?.join('|'),
            // Performance optimizations
            progress: { type: 'none' },
            enhancedResolveOptions: {
                cachedInputFileSystem: {
                    cacheDuration: 100, // Low cache to reduce memory
                },
                extensions: config.extensions || ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
            },
        };
        // Add tsconfig if specified
        if (config.dependencyOptions?.tsConfig) {
            cruiseOptions.tsConfig = {
                fileName: config.dependencyOptions.tsConfig,
            };
        }
        // Add webpack config if specified
        if (config.dependencyOptions?.webpackConfig) {
            cruiseOptions.webpackConfig = {
                fileName: config.dependencyOptions.webpackConfig,
            };
        }
        // KEY OPTIMIZATION: Pass only the changed files as the starting point
        // dependency-cruiser will scan ONLY these files and traverse their dependents
        console.log(`   Starting dependency scan from ${changedFiles.length} changed file(s)...`);
        const result = await cruise(changedFiles, // Only scan changed files, not entire codebase!
        cruiseOptions);
        if (typeof result.output === 'string') {
            throw new Error('Unexpected string output from dependency-cruiser');
        }
        const relatedFiles = new Set();
        const changedSet = new Set(changedFiles.map(normalizeFilePath));
        // Build two maps:
        // 1. Reverse dependency map (file -> files that import it) - for finding dependents
        // 2. Forward dependency map (file -> files it imports) - for finding dependencies
        const dependentMap = new Map();
        const dependencyMap = new Map();
        for (const module of result.output.modules) {
            const source = normalizeFilePath(module.source);
            for (const dep of module.dependencies) {
                const resolvedPath = normalizeFilePath(dep.resolved);
                // Reverse map: resolvedPath is imported by source
                if (!dependentMap.has(resolvedPath)) {
                    dependentMap.set(resolvedPath, new Set());
                }
                dependentMap.get(resolvedPath).add(source);
                // Forward map: source imports resolvedPath
                if (!dependencyMap.has(source)) {
                    dependencyMap.set(source, new Set());
                }
                dependencyMap.get(source).add(resolvedPath);
            }
        }
        console.log(`   Built dependency maps with ${dependentMap.size} entries`);
        // BFS to find all related files (both dependents and dependencies) up to specified depth
        const queue = Array.from(changedSet).map(file => ({ file, currentDepth: 0 }));
        const visited = new Set();
        while (queue.length > 0) {
            const { file, currentDepth } = queue.shift();
            if (visited.has(file) || currentDepth >= depth) {
                continue;
            }
            visited.add(file);
            // Find files that import this file (dependents - traverse upward)
            const fileDependents = dependentMap.get(file);
            if (fileDependents) {
                for (const dependent of fileDependents) {
                    if (!changedSet.has(dependent)) {
                        relatedFiles.add(dependent);
                        queue.push({ file: dependent, currentDepth: currentDepth + 1 });
                    }
                }
            }
            // Find files that this file imports (dependencies - traverse downward)
            const fileDependencies = dependencyMap.get(file);
            if (fileDependencies) {
                for (const dependency of fileDependencies) {
                    if (!changedSet.has(dependency)) {
                        relatedFiles.add(dependency);
                        queue.push({ file: dependency, currentDepth: currentDepth + 1 });
                    }
                }
            }
        }
        return Array.from(relatedFiles);
    }
    catch (error) {
        console.warn('Failed to generate dependency graph:', error);
        return [];
    }
}
/**
 * Normalize file paths for consistent comparison
 */
function normalizeFilePath(filePath) {
    // Remove leading ./ if present
    let normalized = filePath.startsWith('./') ? filePath.substring(2) : filePath;
    // Convert to forward slashes for consistency
    normalized = normalized.replace(/\\/g, '/');
    return normalized;
}
//# sourceMappingURL=dependencies.js.map