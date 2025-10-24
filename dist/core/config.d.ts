export interface CommentCatcherConfig {
    excludePatterns?: string[];
    extensions?: string[];
    dependencyOptions?: {
        tsConfig?: string;
        webpackConfig?: string;
        enhancedResolveOptions?: any;
    };
    commentFilters?: {
        minLength?: number;
        ignorePatterns?: string[];
    };
    llmOptions?: {
        model?: string;
        baseURL?: string;
    };
}
export declare function loadConfig(): Promise<CommentCatcherConfig>;
//# sourceMappingURL=config.d.ts.map