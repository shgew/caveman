---
description: Compress a Markdown file with caveman-compress
---
Compress Markdown file: $ARGUMENTS

Use the caveman-compress skill/instructions. If no file path is provided, ask
for one. Only compress the target Markdown file.

Before overwriting, write backup as `<filename>.original.md`. Do not compress an
`.original.md` backup file.

Preserve byte-for-byte:
- fenced code blocks
- inline code
- URLs and Markdown links
- file paths
- commands

Compress prose only. Preserve headings, list structure, tables, frontmatter,
technical terms, proper nouns, dates, versions, and numeric values.

Validate after writing. If validation fails, restore from backup and report the
problem. If validation passes, report original size, compressed size, and savings.
