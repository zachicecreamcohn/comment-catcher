export interface CodeComment {
    file: string;
    line: number;
    text: string;
    context: string;
}
/**
 * Extracts comments from source files using TypeScript compiler API
 */
export declare function extractComments(files: string[]): Promise<CodeComment[]>;
//# sourceMappingURL=comments.d.ts.map