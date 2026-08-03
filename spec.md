# todo CLI – Specification

## Description

`todo` is a command-line tool that interacts with **Microsoft To-Do** via the Microsoft Graph API. It can list all task lists and export the tasks from a specified list into a Markdown file with checkbox syntax.

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

### Multiple Accounts

The global `--account <nickname>` option selects which account's token cache to use:

- `default` (or omitting the option) uses `~/.todo-cli/token-cache.json` (the standard behavior).
- Any other nickname uses a separate cache at `~/.todo-cli/<nickname>-token-cache.json`, allowing multiple accounts to stay signed in simultaneously.

Nicknames may contain only letters, numbers, dots, dashes, and underscores; other values are rejected.

## Commands

### `todo list`

```
todo list [--verbose]
```

Print all task lists to stderr, one per line.

| Parameter | Required | Description |
|---|---|---|
| `-v, --verbose` | No | Include list IDs in the output. |

### `todo export`

```
todo export <list-identifier> [--out <markdown-path>] [--metadata] [--attachments] [--ordering-source <path>] [--sort-order <order>]
todo export --all [--out <directory>] [--metadata] [--attachments] [--ordering-source <directory>] [--sort-order <order>]
```

#### Parameters

| Parameter | Required | Description |
|---|---|---|
| `<list-identifier>` | Yes (unless `--all`) | Positional argument identifying the task list to export. Accepts a **list ID** or a **list name** (see *List Resolution* below). |
| `--all` | No | Export every task list in the account. Mutually exclusive with `<list-identifier>`. Changes the semantics of `--out` and `--ordering-source` (see *Exporting All Lists* below). |
| `--out <path>` | No | File path where the Markdown output is written. Defaults to `<list-name>.md` in the current directory. With `--all`, this is a directory (defaults to the current directory); per-list files are written as `<list-name>.md` inside it. |
| `-m, --metadata` | No | Include task metadata inline using Obsidian Tasks emoji format (see *Metadata* below). |
| `-a, --attachments` | No | Download task file attachments and include as Markdown links (see *Attachments* below). |
| `-c, --completed-attachments <mode>` | No | How to handle attachments on **completed** tasks when `--attachments` is set. One of: `default` (current behavior — download with all others), `skip` (do not download; render the name as plain text with a ` (skipped)` suffix), `subfolder` (download into a `completed/` subdirectory under the attachments folder; markdown links are adjusted accordingly). Has no effect without `--attachments`. |
| `--ordering-source <path>` | No | Path to a text file (or a directory of such files) produced by the To-Do app's "Send a copy" function. When provided, tasks are reordered to match the order in this file (see *Ordering Source* below). When combined with `--all`, this **must** be a directory. When combined with `--sort-order`, it establishes the baseline order used to break ties (see *Sort Order* below). |
| `-s, --sort-order <order>` | No | Sort tasks by a task property (see *Sort Order* below). Aliases: `--sort`. May be combined with `--ordering-source`. |

### Global Options

| Parameter | Description |
|---|---|
| `--verbose` | Show detailed error output including status codes, response bodies, request IDs, and stack traces. Useful for diagnosing Graph API errors. |
| `--account <nickname>` | Select the account whose token cache is used. `default` (or omitted) uses `~/.todo-cli/token-cache.json`; any other nickname uses `~/.todo-cli/<nickname>-token-cache.json` (see *Multiple Accounts* above). |

### List Resolution

The `<list-identifier>` is resolved in the following order:

1. **Exact ID match** – the identifier is compared against list IDs (case-sensitive).
2. **Exact name match** – the identifier is compared against list display names (case-insensitive).
3. **Partial name match** – the identifier is matched as a case-insensitive substring of display names.

If **no** list matches, the CLI prints an error listing all available lists and exits with code 1.

If the partial match is **ambiguous** (more than one list matches), the CLI prints the matching lists and exits with code 1.

## Ordering Source

Microsoft Graph does not expose the custom sort order of tasks as displayed in the To-Do app. As a workaround, the `--ordering-source` option accepts a text file produced by the To-Do app's **"Send a copy"** function, which preserves the user's custom task order.

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

Ordering is applied independently to the incomplete and completed groups (incomplete tasks still appear before completed tasks). When `--sort-order` is also specified, this ordering becomes the baseline that the sort is applied on top of, so it serves as the tie-breaker (see *Sort Order* below).

### Directory argument

If `--ordering-source` refers to a directory, the CLI searches it for a file matching the resolved list's display name. The following candidates are tried, in order, and the first existing file is used:

1. `<list-name>.md`
2. `<list-name>.txt`
3. `<list-name-without-emoji-prefix>.md`
4. `<list-name-without-emoji-prefix>.txt`

The "emoji prefix" is any sequence of leading emoji characters (and surrounding whitespace) before the first regular character — for example, `📅 Daily` falls back to `Daily`. If no candidate file exists, the export proceeds without applying any ordering and a warning is printed to stderr.

## Sort Order

The `--sort-order` (alias `--sort`, short `-s`) option sorts tasks by a task property. Sorting is applied independently to the incomplete and completed groups (incomplete tasks still appear before completed tasks).

Accepted values (canonical name and alias):

| Value | Alias | Behavior |
|---|---|---|
| `created-date` | `created` | By task creation date, ascending. Tasks with no creation date sort last. |
| `due-date` | `due` | By due date, ascending (earliest first). Tasks with no due date sort last. |
| `task-title` | `title` | Alphabetically by title, ignoring emoji. |
| `priority` | `starred` | Important ("starred") tasks first; all other tasks are treated as equal. |

### Tie-breaking

The sort is **stable**, so tasks with equal sort keys retain their relative order from the *baseline* order:

- With `--ordering-source`, the baseline is the order from the ordering-source file (applied before sorting). This is the recommended combination, since it makes ties fall back to the user's custom order as shown in the To-Do app.
- Without `--ordering-source`, the baseline is the raw order returned by the Graph API, which is arbitrary and does **not** reflect the To-Do app's display order.

Combining `--sort-order` with `--ordering-source` is allowed: the ordering source is applied first to establish the baseline, then the stable sort is applied on top of it.

### Ignoring emoji when sorting by title

When sorting by `task-title`, emoji are ignored for comparison purposes. All emoji characters are extracted from the title (in their original order) and moved to the end of the string, so that they only affect ordering as a tie-breaker between titles that are otherwise identical once emoji are removed. For example, `🍎 Apple` sorts as `Apple` and `🍌 Banana` sorts as `Banana`.

## Exporting All Lists

When `--all` is passed, the CLI exports every task list returned by the Graph API to its own Markdown file:

- The `<list-identifier>` argument **must be omitted** (specifying both is an error).
- `--out` is treated as a **directory** (defaults to the current working directory). It is created if missing. Each list is written to `<out-dir>/<list-name>.md`, with the list display name sanitized for filesystem safety.
- `--ordering-source`, if provided, **must be a directory**. Per-list ordering files are resolved via the same lookup rules as the single-list case.
- All other options (`--metadata`, `--attachments`, `--inline-link`, `--sort-order`) apply uniformly to every exported list.

## Output Format

The generated Markdown file contains one line per task. Incomplete tasks appear first, followed by completed tasks, preserving the API return order within each group.

### YAML Frontmatter

When the output filename (without extension) does **not** match the list's original display name — for example, when the name was sanitized for filesystem safety during `--all` export, or when the user supplied a different `--out` path — the file begins with a YAML frontmatter block containing the original list name:

```markdown
---
title: 📅 Daily Review
---
```

When the filename already matches the display name exactly, no frontmatter is emitted.

Each task is rendered as a checkbox line. Below the task line, indented child items appear in this order:

1. **Subtasks** (checklist items) — indented checkboxes.
2. **Linked resources** — indented Markdown links in the format `- [displayName](webUrl) (applicationName)`.
3. **Attachments** — indented Markdown links to downloaded files in the format `- [fileName](relativePath)` (only when `--attachments` is enabled).
4. **Notes** — the task body (HTML) converted to Markdown via Turndown, with each line rendered as an indented bullet item.

**Linked resource inlining:** When a task has exactly one linked resource whose `displayName` matches the task title, the link is inlined in the task title (e.g., `- [ ] [Task title](url)`) instead of appearing as a separate indented item. The comparison ignores leading `Re:`, `Fw:`, and `Fwd:` prefixes on either side, so a resource named `Re: Task title` still matches a task named `Task title`.

```markdown
- [ ] Buy groceries
    - [x] Milk
    - [ ] Eggs
    - [Grocery list](https://example.com) (OneNote)
    - [receipt.pdf](Buy%20groceries.attachments/att1-receipt.pdf)
    - Check the pantry first
- [x] [Send report](https://outlook.office.com/mail/read/123)
- [ ] Book flight
```

* `- [ ]` – task/subtask is **not completed**.
* `- [x]` – task/subtask is **completed**.

The file ends with a trailing newline.

## Metadata

When `--metadata` is enabled, task metadata is appended inline after the task title (or linked title) using [Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji format:

| Emoji | Field | Source (Graph API) |
|---|---|---|
| `⏫` | High priority | `importance === "high"` |
| `🔁` | Recurrence | `recurrence.pattern` (e.g., "every day", "every week on Monday") |
| `➕` | Created date | `createdDateTime` |
| `📅` | Due date | `dueDateTime` |
| `⏳` | Scheduled date | `reminderDateTime` (date only, time ignored) |
| `✅` | Completion date | `completedDateTime` |

Fields are emitted in the order listed above. Weekday names in recurrence definitions are capitalized (e.g., `Monday`, `Wednesday`).

Example with metadata:

```markdown
- [ ] Buy groceries ⏫ ➕ 2024-04-10 📅 2024-04-25
- [x] Send report ➕ 2024-04-08 ✅ 2024-04-20
```

Only present fields are included; tasks with no metadata have no emoji suffix.

## Attachments

When `--attachments` is enabled, the CLI fetches file attachments for each task via the Graph API and downloads them to a folder next to the output Markdown file.

### Storage

- Attachments are stored in a `<basename>.attachments/` folder (e.g., `Shopping.attachments/` for `Shopping.md`).
- Each file is named `<attachmentId>-<sanitizedName>` to avoid collisions between tasks.
- Unsafe filesystem characters in filenames are replaced with `_`.

### Rendering

Each attachment is rendered as an indented Markdown link after linked resources and before notes:

```markdown
- [ ] Buy groceries
    - [receipt.pdf](Buy%20groceries.attachments/att1-receipt.pdf)
    - [photo.jpg](Buy%20groceries.attachments/att2-photo.jpg)
```

Path segments are URL-encoded in the Markdown link to handle spaces and special characters.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (authentication failure, network error, ambiguous/missing list, file-system error, etc.) |

## Examples

```bash
# List all task lists
todo list

# List with IDs
todo list --verbose

# Export by exact list name
todo export "Shopping" --out shopping.md

# Export by partial name (case-insensitive)
todo export "shop" --out shopping.md

# Export by list ID
todo export "AQMkADAwATMw..." --out work.md

# Export with metadata
todo export "Shopping" -m

# Export with attachments
todo export "Shopping" -a

# Export with ordering
todo export "Daily" --ordering-source ~/To-Do/Daily-send.md

# Verbose mode for debugging API errors
todo --verbose export "Shopping" -a
```
