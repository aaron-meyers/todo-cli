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
- Multiple account support via `--account <nickname>` (separate token caches)
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
todo export <list-identifier> [-o <markdown-path>] [-m] [-a [path]] [-c <mode>] [--inline-link <mode>] [--ordering-source <path>]
todo export --all [-o <directory>] [-m] [-a [path]] [-c <mode>] [--inline-link <mode>] [--ordering-source <directory>]
```

| Option | Required | Description |
|---|---|---|
| `<list-identifier>` | Yes (unless `--all`) | List ID or name (partial, case-insensitive) — positional argument |
| `--all` | No | Export every task list. Disallows the `<list-identifier>` argument. `--out` becomes a directory (defaults to current directory) and `--ordering-source`, if provided, must be a directory. |
| `-o, --out <path>` | No | Output file path (defaults to `<list-name>.md`). With `--all`, a directory (defaults to current directory). |
| `-m, --metadata` | No | Include task metadata in Obsidian Tasks emoji format |
| `-a, --attachments [path]` | No | Download task file attachments and include as Markdown links. Optionally specify a custom attachments folder path. |
| `-c, --completed-attachments <mode>` | No | How to handle attachments on **completed** tasks: `default` (download alongside others), `skip` (don't download; render as plain text with a `(skipped)` suffix), or `subfolder` (download into a `completed/` subfolder under the attachments folder). |
| `--inline-link <mode>` | No | Control inlining of a linked resource into the task title: `auto` (inline when the resource name matches the task title — default), `always`, or `never`. |
| `--ordering-source <path>` | No | Text file (or directory of files) from To-Do's "Send a copy" to set task order. Must be a directory when combined with `--all`. |

### Global Options

| Option | Description |
|---|---|
| `--verbose` | Show detailed error output (status codes, response bodies, stack traces) |
| `--account <nickname>` | Account to use. `default` (or omitted) uses the standard token cache; any other nickname uses a separate `<nickname>-token-cache.json` cache |

### Examples

```bash
# List all task lists
todo list

# Export by list name
todo export "Shopping"

# Export by partial name with custom output path
todo export "shop" -o shopping.md

# Export by list ID
todo export "AQMkADAwATMw..." --out work.md

# Export with metadata (dates, recurrence, priority)
todo export "Shopping" -m

# Export with attachments downloaded to Shopping.attachments/
todo export "Shopping" -a

# Export with attachments downloaded to a custom folder
todo export "Shopping" -a ./shopping-files

# Always inline linked resources into the task title
todo export "Shopping" --inline-link always

# Export with ordering from a To-Do "Send a copy" file
todo export Daily --ordering-source ~/To-Do/Daily-send.md

# Export every list to the current directory
todo export --all

# Export every list to ./exports, with per-list ordering files in ~/To-Do
todo export --all -o ./exports --ordering-source ~/To-Do

# Verbose mode for debugging
todo --verbose export "Shopping" -a

# Use a second account (cached separately)
todo --account work list
```

### Authentication

On first run you'll be prompted to sign in via the device-code flow — open the URL shown, enter the code, and sign in with your Microsoft account. Tokens are cached at `~/.todo-cli/token-cache.json` for subsequent runs.

To sign in with more than one account, use `--account <nickname>`. Each non-default nickname is cached separately at `~/.todo-cli/<nickname>-token-cache.json`, so you can switch between accounts without re-authenticating each time. Nicknames may contain only letters, numbers, dots, dashes, and underscores.

### Output

```markdown
---
title: Shopping
---
- [ ] Buy groceries
    - [x] Milk
    - [ ] Eggs
    - [Grocery list](https://example.com) (OneNote)
    - [receipt.pdf](Buy%20groceries.attachments/receipt-2a9f1c7.pdf)
    - Check the pantry first
- [x] [Send report](https://outlook.office.com/mail/read/123)
- [ ] Book flight ⏫ 📅 2024-05-01
```

If the output filename (without extension) differs from the list's display name, a YAML frontmatter block with a `title:` field holding the list name is prepended to the file. When the filename matches the list name, no frontmatter is added.

Incomplete tasks appear first, followed by completed tasks. For each task:

1. Subtasks (checklist items) appear as indented checkbox items
2. Linked resources appear as indented Markdown links (or inlined in the title when the resource name matches the task title, controlled with `--inline-link`)
3. Attachments appear as indented Markdown links to downloaded files (when `--attachments` is enabled). With `--completed-attachments skip`, attachments on completed tasks are rendered as plain text with a `(skipped)` suffix instead.
4. Notes appear as indented bullet items (HTML converted to Markdown)

When `--attachments` is enabled, files are downloaded by default to a `<basename>.attachments/` folder next to the output Markdown file (override the folder with `-a <path>`). Each filename is suffixed with the last 7 alphanumeric characters of the attachment ID to avoid collisions (e.g. `receipt-2a9f1c7.pdf`).

When `--metadata` is enabled, task metadata is appended inline using Obsidian Tasks emoji format: `⏫` priority, `🔁` recurrence, `➕` created, `📅` due, `⏳` scheduled, `✅` completed.

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
