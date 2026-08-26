import type { CliLanguage, SgResult } from './types';

/** 将搜索结果格式化为按文件分组的文本。 */
export function formatSearchResult(result: SgResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return 'No matches found.';
  }

  const lines: string[] = [];
  const byFile = new Map<string, SgResult['matches']>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    lines.push(`\n${file}:`);
    for (const match of matches) {
      const startLine = match.range.start.line + 1;
      const text = match.text.length > 100 ? `${match.text.substring(0, 100)}...` : match.text;
      lines.push(`  ${startLine}: ${text.replace(/\n/g, '\\n')}`);
    }
  }

  const fileCount = byFile.size;
  const summary = `Found ${result.totalMatches} matches in ${fileCount} files`;
  lines.push(
    `\n${summary}${result.truncated ? ` (output truncated: ${result.truncatedReason})` : ''}`,
  );

  return lines.join('\n');
}

/** 将替换结果格式化为文本，标注 dry-run 或已应用。 */
export function formatReplaceResult(result: SgResult, isDryRun: boolean): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return 'No matches found for replacement.';
  }

  const lines: string[] = [];
  const mode = isDryRun ? '[DRY RUN]' : '[APPLIED]';

  const byFile = new Map<string, SgResult['matches']>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    lines.push(`\n${file}:`);
    for (const match of matches) {
      const startLine = match.range.start.line + 1;
      const original = match.text.length > 60 ? `${match.text.substring(0, 60)}...` : match.text;
      const replacement = match.replacement
        ? match.replacement.length > 60
          ? `${match.replacement.substring(0, 60)}...`
          : match.replacement
        : '[no replacement]';
      lines.push(
        `  ${startLine}: "${original.replace(/\n/g, '\\n')}" → "${replacement.replace(/\n/g, '\\n')}"`,
      );
    }
  }

  const fileCount = byFile.size;
  lines.push(`\n${mode} ${result.totalMatches} replacements in ${fileCount} files`);
  if (isDryRun) {
    lines.push('\nTo apply changes, run with dryRun=false');
  }

  return lines.join('\n');
}

/** 当 pattern 为空结果时给出针对性提示。 */
export function getEmptyResultHint(pattern: string, lang: CliLanguage): string | null {
  const src = pattern.trim();

  if (lang === 'python') {
    if (src.startsWith('class ') && src.endsWith(':')) {
      return `Hint: Remove trailing colon. Try: "${src.slice(0, -1)}"`;
    }
    if ((src.startsWith('def ') || src.startsWith('async def ')) && src.endsWith(':')) {
      return `Hint: Remove trailing colon. Try: "${src.slice(0, -1)}"`;
    }
  }

  if (['javascript', 'typescript', 'tsx'].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return 'Hint: Function patterns need params and body. Try "function $NAME($$$) { $$$ }"';
    }
  }

  return null;
}
