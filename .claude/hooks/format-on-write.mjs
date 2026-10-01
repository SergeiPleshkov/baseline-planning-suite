// PostToolUse hook: formats a file Claude just wrote, honouring .prettierignore.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, tool_response: response = {} } = JSON.parse(raw);
const file = response.filePath ?? input.file_path;

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relative = typeof file === 'string' ? path.relative(root, file) : '..';

if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
  const info = await prettier.getFileInfo(file, {
    ignorePath: [path.join(root, '.prettierignore'), path.join(root, '.gitignore')],
  });
  if (!info.ignored && info.inferredParser) {
    const source = await readFile(file, 'utf8');
    const options = await prettier.resolveConfig(file);
    try {
      const formatted = await prettier.format(source, { ...options, filepath: file });
      if (formatted !== source) await writeFile(file, formatted);
    } catch {
      // A half-finished edit may not parse yet; the next write formats it.
    }
  }
}
