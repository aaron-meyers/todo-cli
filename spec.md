# todo CLI – Specification

## Description

`todo` is a command-line tool that interacts with **Microsoft To-Do** via the Microsoft Graph API. Its primary function is exporting the tasks from a specified task list into a Markdown file with checkbox syntax.

## Prerequisites

| Prerequisite | Details |
|---|---|
| **Node.js** | v18 or later |

## Authentication

On first run the CLI performs the **OAuth 2.0 device-code flow**:

1. A URL and a one-time code are printed to stderr.
2. The user opens the URL in a browser, enters the code, and signs in.
3. The CLI receives an access token and caches it at `~/.todo-cli/token-cache.json`.

Subsequent runs reuse the cached token (or silently refresh it) until it expires. Delete the cache file to force re-authentication.

## Usage

```
todo export --list <list-identifier> [--out <markdown-path>] [--ordering-source <file>]
```

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `--list <identifier>` | Yes | Identifies the task list to export. Accepts a **list ID** or a **list name** (see *List Resolution* below). |
| `--out <path>` | No | File path where the Markdown output is written. Defaults to `<list-name>.md` in the current directory. The file is created or overwritten. |
| `--ordering-source <file>` | No | Path to a text file produced by the To-Do app's "Share copy" function. When provided, tasks are reordered to match the order in this file (see *Ordering Source* below). |

### List Resolution

The `<list-identifier>` is resolved in the following order:

1. **Exact ID match** – the identifier is compared against list IDs (case-sensitive).
2. **Exact name match** – the identifier is compared against list display names (case-insensitive).
3. **Partial name match** – the identifier is matched as a case-insensitive substring of display names.

If **no** list matches, the CLI prints an error listing all available lists and exits with code 1.

If the partial match is **ambiguous** (more than one list matches), the CLI prints the matching lists and exits with code 1.

## Ordering Source

Microsoft Graph does not expose the custom sort order of tasks as displayed in the To-Do app. As a workaround, the `--ordering-source` option accepts a text file produced by the To-Do app's **"Share copy"** function, which preserves the user's custom task order.

The file uses the following format:

```
📅 List Name

◯ Task title
   ◦ Incomplete subtask
   ✔ Completed subtask
◯ Another task ★
```

The CLI parses lines starting with `◯` to extract parent task titles (in order), stripping any trailing `★` (importance marker) and whitespace. Tasks from the API are then reordered to match:

1. Tasks whose titles match an entry in the ordering source are sorted by their position in that file.
2. Tasks not found in the ordering source are appended at the end in their original API order.

Ordering is applied independently to the incomplete and completed groups (incomplete tasks still appear before completed tasks).

## Output Format

The generated Markdown file contains one line per task. Incomplete tasks appear first, followed by completed tasks, preserving the API return order within each group.

If a task has subtasks (checklist items), they appear as indented items immediately below the parent task:

```markdown
- [ ] Buy groceries
    - [x] Milk
    - [ ] Eggs
- [x] Send report
- [ ] Book flight
```

* `- [ ]` – task/subtask is **not completed**.
* `- [x]` – task/subtask is **completed**.

The file ends with a trailing newline.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (authentication failure, network error, ambiguous/missing list, file-system error, etc.) |

## Examples

```bash
# Export by exact list name
todo export --list "Shopping" --out shopping.md

# Export by partial name (case-insensitive)
todo export --list "shop" --out shopping.md

# Export by list ID
todo export --list "AQMkADAwATMw..." --out work.md
```
