import { execSync } from 'child_process';
import { loadConfig } from './config.js';
/**
 * Gets list of changed files compared to base branch
 */
export async function getChangedFiles(baseBranch) {
    const config = await loadConfig();
    try {
        const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
            encoding: 'utf-8',
        });
        const extensions = config.extensions || ['.ts', '.js', '.tsx', '.jsx'];
        return output
            .trim()
            .split('\n')
            .filter((file) => file.length > 0)
            .filter((file) => extensions.some(ext => file.endsWith(ext)));
    }
    catch (error) {
        throw new Error(`Failed to get changed files: ${error}`);
    }
}
/**
 * Gets full diff compared to base branch
 */
export async function getDiff(baseBranch) {
    try {
        const output = execSync(`git diff ${baseBranch}...HEAD`, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
        return output;
    }
    catch (error) {
        throw new Error(`Failed to get diff: ${error}`);
    }
}
//# sourceMappingURL=diff.js.map