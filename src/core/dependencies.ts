import { cruise } from 'dependency-cruiser';
import { loadConfig } from './config.js';
import * as path from 'path';

/**
 * Finds files that depend on the changed files using dependency-cruiser.
 * 
 * Key optimization: Instead of scanning the entire codebase, we only scan
 * the changed files and let dependency-cruiser traverse outward from there.
 */

export async function getDependents(
  changedFiles: string[],
  depth: number
): Promise<string[]> {
  if (changedFiles.length === 0) {
    return [];
  }

  const config = await loadConfig();
  console.log('   Changed files to analyze:', changedFiles);

  try {
    const cruiseOptions: any = {
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
    
    const result = await cruise(
      changedFiles, // Only scan changed files, not entire codebase!
      cruiseOptions
    );

    if (typeof result.output === 'string') {
      throw new Error('Unexpected string output from dependency-cruiser');
    }

    const dependents = new Set<string>();
    const changedSet = new Set(changedFiles.map(normalizeFilePath));

    // Build a reverse dependency map (file -> files that import it)
    const dependencyMap = new Map<string, Set<string>>();

    for (const module of result.output.modules) {
      for (const dep of module.dependencies) {
        const resolvedPath = normalizeFilePath(dep.resolved);
        if (!dependencyMap.has(resolvedPath)) {
          dependencyMap.set(resolvedPath, new Set());
        }
        dependencyMap.get(resolvedPath)!.add(normalizeFilePath(module.source));
      }
    }

    console.log(`   Built dependency map with ${dependencyMap.size} entries`);

    // BFS to find all dependents up to specified depth
    const queue: Array<{ file: string; currentDepth: number }> =
      Array.from(changedSet).map(file => ({ file, currentDepth: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { file, currentDepth } = queue.shift()!;

      if (visited.has(file) || currentDepth >= depth) {
        continue;
      }

      visited.add(file);

      const fileDependents = dependencyMap.get(file);
      if (fileDependents) {
        for (const dependent of fileDependents) {
          if (!changedSet.has(dependent)) {
            dependents.add(dependent);
            queue.push({ file: dependent, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    return Array.from(dependents);
  } catch (error) {
    console.warn('Failed to generate dependency graph:', error);
    return [];
  }
}

/**
 * Normalize file paths for consistent comparison
 */
function normalizeFilePath(filePath: string): string {
  // Remove leading ./ if present
  let normalized = filePath.startsWith('./') ? filePath.substring(2) : filePath;
  // Convert to forward slashes for consistency
  normalized = normalized.replace(/\\/g, '/');
  return normalized;
}
