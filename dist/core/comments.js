import * as ts from 'typescript';
import * as fs from 'fs';
import { loadConfig } from './config.js';
/**
 * Extracts comments from source files using TypeScript compiler API
 */
export async function extractComments(files) {
    const comments = [];
    for (const file of files) {
        if (!fs.existsSync(file)) {
            continue;
        }
        const sourceText = fs.readFileSync(file, 'utf-8');
        const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
        const fileComments = await extractCommentsFromSourceFile(sourceFile, file, sourceText);
        comments.push(...fileComments);
    }
    return comments;
}
async function extractCommentsFromSourceFile(sourceFile, filePath, sourceText) {
    const comments = [];
    const lines = sourceText.split('\n');
    const commentRanges = [];
    function visit(node) {
        const leading = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) || [];
        const trailing = ts.getTrailingCommentRanges(sourceText, node.getEnd()) || [];
        for (const range of [...leading, ...trailing]) {
            commentRanges.push(range);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    // Sort by position and remove duplicates
    const uniqueRanges = Array.from(new Map(commentRanges.map(r => [r.pos, r])).values()).sort((a, b) => a.pos - b.pos);
    // Group consecutive single-line comments
    const groupedRanges = groupConsecutiveComments(uniqueRanges, sourceFile);
    for (const range of groupedRanges) {
        const commentText = sourceText.substring(range.pos, range.end);
        const cleanedComment = cleanComment(commentText);
        if (cleanedComment.length === 0 || await isNoiseComment(cleanedComment)) {
            continue;
        }
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
        const context = getContext(lines, lineNumber - 1);
        comments.push({
            file: filePath,
            line: lineNumber,
            text: cleanedComment,
            context,
        });
    }
    return comments;
}
function groupConsecutiveComments(ranges, sourceFile) {
    if (ranges.length === 0)
        return [];
    const grouped = [];
    let currentGroup = null;
    for (const range of ranges) {
        // Only group single-line comments
        if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia) {
            if (currentGroup) {
                grouped.push(currentGroup);
                currentGroup = null;
            }
            grouped.push(range);
            continue;
        }
        if (!currentGroup) {
            currentGroup = { ...range };
            continue;
        }
        // Check if this comment is on the next line
        const currentEndLine = sourceFile.getLineAndCharacterOfPosition(currentGroup.end).line;
        const nextStartLine = sourceFile.getLineAndCharacterOfPosition(range.pos).line;
        if (nextStartLine === currentEndLine + 1) {
            // Merge consecutive comments
            currentGroup.end = range.end;
            if (range.hasTrailingNewLine) {
                currentGroup.hasTrailingNewLine = true;
            }
        }
        else {
            grouped.push(currentGroup);
            currentGroup = { ...range };
        }
    }
    if (currentGroup) {
        grouped.push(currentGroup);
    }
    return grouped;
}
function cleanComment(comment) {
    return comment
        .replace(/^\/\*+|\*+\/$/g, '') // Remove /* */
        .replace(/^\/\//g, '') // Remove //
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim()) // Remove leading * from block comments
        .filter(line => line.length > 0)
        .join(' ')
        .trim();
}
async function isNoiseComment(comment) {
    const config = await loadConfig();
    const defaultPatterns = [
        /^TODO:/i,
        /^FIXME:/i,
        /^NOTE:/i,
        /^@ts-ignore$/,
        /^@ts-expect-error$/,
        /^eslint-disable/,
        /^prettier-ignore/,
    ];
    // Use config patterns if provided
    const ignorePatterns = config.commentFilters?.ignorePatterns || [];
    const patterns = ignorePatterns.length > 0
        ? ignorePatterns.map((p) => new RegExp(p, 'i'))
        : defaultPatterns;
    // Check minimum length
    const minLength = config.commentFilters?.minLength || 10;
    if (comment.length < minLength)
        return true;
    return patterns.some((pattern) => pattern.test(comment));
}
async function shouldIncludeComment(comment) {
    return !(await isNoiseComment(comment));
}
function getContext(lines, commentLine) {
    const contextRadius = 3;
    const start = Math.max(0, commentLine - contextRadius);
    const end = Math.min(lines.length, commentLine + contextRadius + 1);
    return lines.slice(start, end).join('\n');
}
//# sourceMappingURL=comments.js.map