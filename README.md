# todo-cli

A command-line tool that exports [Microsoft To-Do](https://to-do.microsoft.com/) task lists to Markdown.

## Features

- Export any task list to a Markdown file with checkbox syntax
- List all available task lists
- Subtasks (checklist items) rendered as indented items
- Task notes (HTML body) converted to Markdown via [Turndown](https://github.com/mixmark-io/turndown)
- Linked resources (Outlook emails, Teams messages, etc.) rendered as Markdown links
- File attachments downloaded and linked in the Markdown output
- Optional task metadata in [Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji format (dates, recurrence, priority)
- Flexible list lookup — match by ID, exact name, or partial name (case-insensitive)
- Global `--verbose` flag for detailed error diagnostics
- OAuth 2.0 device-code flow with automatic token caching

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

## Installation

```bash
git clone <repo-url>
cd todo-cli
npm install
npm run build
npm link
```

## Usage

### `todo list`

```
todo list [-v, --verbose]
```

Print all task lists. Use `--verbose` to include list IDs.

### `todo export`

```
todo export -l <list-identifier> [-o <markdown-path>] [-m] [-a] [--ordering-source <file>]
```

| Option | Required | Description |
|---|---|---|
| `-l, --list <identifier>` | Yes | List ID or name (partial, case-insensitive) |
| `-o, --out <path>` | No | Output file path (defaults to `<list-name>.md`) |
| `-m, --metadata` | No | Include task metadata in Obsidian Tasks emoji format |
| `-a, --attachments` | No | Download task file attachments and include as Markdown links |
| `--ordering-source <file>` | No | Text file from To-Do's "Send a copy" to set task order |

### Global Options

| Option | Description |
|---|---|
| `--verbose` | Show detailed error output (status codes, response bodies, stack traces) |

### Examples

```bash
# List all task lists
todo list

# Export by list name
todo export -l "Shopping"

# Export by partial name with custom output path
todo export -l "shop" -o shopping.md

# Export by list ID
todo export --list "AQMkADAwATMw..." --out work.md

# Export with metadata (dates, recurrence, priority)
todo export -l "Shopping" -m

# Export with attachments downloaded to Shopping.attachments/
todo export -l "Shopping" -a

# Export with ordering from a To-Do "Send a copy" file
todo export -l Daily --ordering-source ~/To-Do/Daily-send.md

# Verbose mode for debugging
todo --verbose export -l "Shopping" -a
```

### Authentication

On first run you'll be prompted to sign in via the device-code flow — open the URL shown, enter the code, and sign in with your Microsoft account. Tokens are cached at `~/.todo-cli/token-cache.json` for subsequent runs.

### Output

```markdown
- [ ] Buy groceries
    - [x] Milk
    - [ ] Eggs
    - [Grocery list](https://example.com) (OneNote)
    - [receipt.pdf](Buy%20groceries.attachments/att1-receipt.pdf)
    - Check the pantry first
- [x] [Send report](https://outlook.office.com/mail/read/123)
- [ ] Book flight ⏫ 📅 2024-05-01
```

Incomplete tasks appear first, followed by completed tasks. For each task:

1. Subtasks (checklist items) appear as indented checkbox items
2. Linked resources appear as indented Markdown links (or inlined in the title when the resource name matches the task title)
3. Attachments appear as indented Markdown links to downloaded files (when `--attachments` is enabled)
4. Notes appear as indented bullet items (HTML converted to Markdown)

When `--attachments` is enabled, files are downloaded to a `<basename>.attachments/` folder next to the output Markdown file. Filenames are prefixed with the attachment ID to avoid collisions.

When `--metadata` is enabled, task metadata is appended inline using Obsidian Tasks emoji format: `⏫` priority, `➕` created, `📅` due, `⏳` scheduled, `🔁` recurrence, `✅` completed.

## Development

```bash
npm install       # install dependencies
npm run build     # compile TypeScript to dist/
npm test          # run unit tests
npm link          # symlink the CLI globally
```

After making changes, run `npm run build` to recompile and `npm test` to verify.

## Specification

See [spec.md](spec.md) for the detailed specification including list resolution rules, output format, and exit codes.

## License

[MIT](LICENSE)
