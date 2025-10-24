import { CodeComment } from './comments.js';
export interface OutdatedComment {
    comment: CodeComment;
    reason: string;
    suggestion?: string;
}
/**
 * Analyzes comments using Claude to determine if they're outdated
 */
export declare function analyzeComments(comments: CodeComment[], diff: string): Promise<OutdatedComment[]>;
//# sourceMappingURL=analyzer.d.ts.map