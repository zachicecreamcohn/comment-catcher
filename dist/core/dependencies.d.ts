/**
 * Finds files related to the changed files using dependency-cruiser.
 * This includes both:
 * - Files that depend on (import) the changed files (dependents)
 * - Files that the changed files depend on (dependencies)
 *
 * Key optimization: Instead of scanning the entire codebase, we only scan
 * the changed files and let dependency-cruiser traverse outward from there.
 */
export declare function getDependents(changedFiles: string[], depth: number): Promise<string[]>;
//# sourceMappingURL=dependencies.d.ts.map