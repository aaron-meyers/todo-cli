# todo-cli

A command-line tool that exports [Microsoft To-Do](https://to-do.microsoft.com/) task lists to Markdown.

## Features

- Export any task list to a Markdown file with checkbox syntax
- Subtasks (checklist items) rendered as indented items
- Flexible list lookup — match by ID, exact name, or partial name (case-insensitive)
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

```
todo export -l <list-identifier> [-o <markdown-path>] [--ordering-source <file>]
```

| Option | Required | Description |
|---|---|---|
| `-l, --list <identifier>` | Yes | List ID or name (partial, case-insensitive) |
| `-o, --out <path>` | No | Output file path (defaults to `<list-name>.md`) |
| `--ordering-source <file>` | No | Text file from To-Do's "Share copy" to set task order |

### Examples

```bash
# Export by list name
todo export -l "Shopping"

# Export by partial name with custom output path
todo export -l "shop" -o shopping.md

# Export by list ID
todo export --list "AQMkADAwATMw..." --out work.md

# Export with ordering from a To-Do "Share copy" file
todo export -l Daily --ordering-source ~/To-Do/Daily-share.md
```

### Authentication

On first run you'll be prompted to sign in via the device-code flow — open the URL shown, enter the code, and sign in with your Microsoft account. Tokens are cached at `~/.todo-cli/token-cache.json` for subsequent runs.

### Output

```markdown
- [ ] Buy groceries
  - [x] Milk
  - [ ] Eggs
- [x] Send report
- [ ] Book flight
```

Incomplete tasks appear first, followed by completed tasks.

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
