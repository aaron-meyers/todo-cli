import * as fs from "node:fs";
import * as path from "node:path";
import TurndownService from "turndown";
import { getTaskLists, getTasks, getTaskAttachments, downloadAttachment, type TodoTaskList, type TodoTask, type RecurrencePattern } from "./graph.js";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

/** Attachment info resolved for rendering (display name + relative path). */
export interface RenderAttachment {
  displayName: string;
  /** Relative path to the downloaded file. Undefined when the download was skipped. */
  relativePath?: string;
  /** True when the attachment was intentionally not downloaded (rendered as plain text with "(skipped)"). */
  skipped?: boolean;
}

/** Sanitize a filename for safe filesystem use.
 *
 * Also normalizes Unicode whitespace (e.g. the narrow no-break space U+202F
 * that macOS inserts into formatted times like "1.37 PM") to a regular ASCII
 * space so that on-disk filenames and URL-encoded links stay in sync.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/, "");
}

/**
 * URL-encode a single path segment for use in a Markdown link.
 *
 * Uses `encodeURIComponent` then decodes back a small set of characters that
 * are safe in Markdown link destinations and that some renderers (notably
 * Obsidian) refuse to follow when percent-encoded — currently just `,`.
 */
export function encodeAttachmentPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%2C/g, ",");
}

/**
 * Build the on-disk filename for an attachment as
 * `<sanitized-base>-<id-suffix><ext>`, where `id-suffix` is the last 7
 * alphanumeric characters of the attachment ID. If the original name has no
 * extension, none is appended. If the sanitized base is empty, the suffix
 * alone (plus extension) is used.
 */
export function attachmentDiskName(originalName: string, attachmentId: string): string {
  const safe = sanitizeFilename(originalName);
  const ext = path.extname(safe);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  const alnum = attachmentId.replace(/[^A-Za-z0-9]/g, "");
  const suffix = alnum.slice(-7) || attachmentId;
  return base ? `${base}-${suffix}${ext}` : `${suffix}${ext}`;
}

/**
 * Format task lists for display, one per line.
 * When verbose is true, includes the list ID in parentheses.
 */
export function formatListOutput(lists: TodoTaskList[], verbose = false): string {
  return lists
    .map((l) => (verbose ? `${l.displayName} (${l.id})` : l.displayName))
    .join("\n");
}

/**
 * Resolve a user-supplied identifier to exactly one task list.
 *
 * Resolution order:
 * 1. Exact ID match (case-sensitive).
 * 2. Exact display-name match (case-insensitive).
 * 3. Partial display-name match (case-insensitive substring).
 *
 * Throws if no list matches or if the partial match is ambiguous.
 */
export async function resolveList(
  identifier: string,
  lists: TodoTaskList[]
): Promise<TodoTaskList> {
  // 1. Exact ID match
  const byId = lists.find((l) => l.id === identifier);
  if (byId) return byId;

  const lower = identifier.toLowerCase();

  // 2. Exact name match (case-insensitive)
  const exactName = lists.filter(
    (l) => l.displayName.toLowerCase() === lower
  );
  if (exactName.length === 1) return exactName[0];

  // 3. Partial name match (case-insensitive substring)
  const partial = lists.filter((l) =>
    l.displayName.toLowerCase().includes(lower)
  );

  if (partial.length === 0) {
    throw new Error(
      `No task list found matching "${identifier}". Available lists:\n` +
        lists.map((l) => `  - ${l.displayName} (${l.id})`).join("\n")
    );
  }

  if (partial.length > 1) {
    throw new Error(
      `Ambiguous list identifier "${identifier}". Multiple lists match:\n` +
        partial.map((l) => `  - ${l.displayName} (${l.id})`).join("\n")
    );
  }

  return partial[0];
}

/** Strip a leading emoji (and following whitespace) from a list name. */
export function stripEmojiPrefix(name: string): string {
  return name.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]+\s*/u, "");
}

/**
 * Resolve a `--ordering-source` argument to a concrete file path.
 *
 * If the argument refers to a directory, search it for a file matching the
 * list name, falling back to the list name with any leading emoji prefix
 * removed. Both `.md` and `.txt` extensions are tried (in that order).
 *
 * Returns `undefined` if no matching file is found in the directory.
 * For non-directory arguments, returns the argument unchanged.
 */
export function resolveOrderingSourcePath(
  orderingSourceArg: string,
  listName: string
): string | undefined {
  let isDir = false;
  try {
    isDir = fs.statSync(orderingSourceArg).isDirectory();
  } catch {
    return orderingSourceArg;
  }

  if (!isDir) return orderingSourceArg;

  const names = [listName];
  const stripped = stripEmojiPrefix(listName).trim();
  if (stripped && stripped !== listName) names.push(stripped);

  for (const name of names) {
    for (const ext of [".md", ".txt"]) {
      const candidate = path.join(orderingSourceArg, `${name}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

/**
 * Parse a "Send a copy" text from the To-Do app and return an ordered
 * list of task titles. The format uses ◯ for parent tasks, ◦/✔ for subtasks,
 * and optionally appends ★ for important tasks.
 */
export function parseOrderingSource(content: string): string[] {
  const titles: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    // Match parent task lines: "◯ <title>" (possibly with trailing ★)
    const match = line.match(/^◯\s+(.+)$/);
    if (match) {
      const title = match[1]
        .replace(/\s*★\s*$/, "") // strip importance marker
        .trimEnd();
      titles.push(title);
    }
  }

  return titles;
}

/**
 * Sort tasks based on an ordered list of titles.
 * Tasks found in the list are ordered by their position;
 * tasks not found are appended at the end in their original order.
 */
export function applyOrdering(tasks: TodoTask[], orderedTitles: string[]): TodoTask[] {
  const positionMap = new Map<string, number>();
  for (let i = 0; i < orderedTitles.length; i++) {
    positionMap.set(orderedTitles[i], i);
  }

  const matched: { task: TodoTask; pos: number }[] = [];
  const unmatched: TodoTask[] = [];

  for (const task of tasks) {
    const pos = positionMap.get(task.title.trimEnd());
    if (pos !== undefined) {
      matched.push({ task, pos });
    } else {
      unmatched.push(task);
    }
  }

  matched.sort((a, b) => a.pos - b.pos);
  return [...matched.map((m) => m.task), ...unmatched];
}

/** Extract just the date portion (YYYY-MM-DD) from an ISO datetime string. */
export function toDateOnly(dateTime: string): string {
  return dateTime.slice(0, 10);
}

/** Convert a Graph API recurrence pattern to an Obsidian Tasks recurrence string. */
export function formatRecurrence(pattern: RecurrencePattern): string {
  const { type, interval, daysOfWeek } = pattern;

  if (type === "daily") {
    return interval === 1 ? "every day" : `every ${interval} days`;
  }
  if (type === "weekly") {
    if (daysOfWeek && daysOfWeek.length > 0) {
      const days = daysOfWeek.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ");
      return interval === 1 ? `every week on ${days}` : `every ${interval} weeks on ${days}`;
    }
    return interval === 1 ? "every week" : `every ${interval} weeks`;
  }
  if (type === "absoluteMonthly") {
    return interval === 1 ? "every month" : `every ${interval} months`;
  }
  if (type === "absoluteYearly") {
    return interval === 1 ? "every year" : `every ${interval} years`;
  }
  return `every ${interval} ${type}`;
}

/** Build the Obsidian Tasks emoji metadata suffix for a task. */
export function formatMetadata(task: TodoTask): string {
  const parts: string[] = [];

  if (task.importance === "high") {
    parts.push("⏫");
  }
  if (task.recurrence) {
    parts.push(`🔁 ${formatRecurrence(task.recurrence)}`);
  }
  if (task.createdDateTime) {
    parts.push(`➕ ${toDateOnly(task.createdDateTime)}`);
  }
  if (task.dueDateTime) {
    parts.push(`📅 ${toDateOnly(task.dueDateTime)}`);
  }
  if (task.reminderDateTime) {
    parts.push(`⏳ ${toDateOnly(task.reminderDateTime)}`);
  }
  if (task.completedDateTime) {
    parts.push(`✅ ${toDateOnly(task.completedDateTime)}`);
  }

  return parts.join(" ");
}

export type InlineLinkMode = "auto" | "always" | "never";

/**
 * Render tasks to Markdown checkbox lines.
 * Incomplete tasks appear first, followed by completed tasks.
 * Subtasks are indented under their parent.
 */
export function renderMarkdown(
  tasks: TodoTask[],
  orderingSource?: string,
  metadata = false,
  attachmentMap: Map<string, RenderAttachment[]> = new Map(),
  inlineLink: InlineLinkMode = "auto"
): string {
  const incomplete = tasks.filter((t) => t.status !== "completed");
  const completed = tasks.filter((t) => t.status === "completed");

  let orderedIncomplete = incomplete;
  let orderedCompleted = completed;

  if (orderingSource) {
    const orderedTitles = parseOrderingSource(orderingSource);
    orderedIncomplete = applyOrdering(incomplete, orderedTitles);
    orderedCompleted = applyOrdering(completed, orderedTitles);
  }

  const ordered = [...orderedIncomplete, ...orderedCompleted];

  const lines: string[] = [];
  for (const t of ordered) {
    const checkbox = t.status === "completed" ? "[x]" : "[ ]";
    const metaStr = metadata ? formatMetadata(t) : "";
    const meta = metaStr ? ` ${metaStr}` : "";
    const titleText = t.title.trimEnd();

    // Determine whether to inline a linked resource in the title
    const shouldInline =
      t.linkedResources.length > 0 &&
      (inlineLink === "always" ||
        (inlineLink === "auto" &&
          t.linkedResources.length === 1 &&
          t.linkedResources[0].displayName === titleText));

    if (shouldInline) {
      lines.push(`- ${checkbox} [${titleText}](${t.linkedResources[0].webUrl})${meta}`);
    } else {
      lines.push(`- ${checkbox} ${titleText}${meta}`);
    }
    for (const ci of t.checklistItems) {
      const subCheckbox = ci.isChecked ? "[x]" : "[ ]";
      lines.push(`    - ${subCheckbox} ${ci.displayName.trimEnd()}`);
    }
    // Render remaining linked resources as nested items
    const remainingResources = shouldInline
      ? t.linkedResources.slice(1)
      : t.linkedResources;
    for (const lr of remainingResources) {
      lines.push(`    - [${lr.displayName}](${lr.webUrl}) (${lr.applicationName})`);
    }
    const taskAttachments = attachmentMap.get(t.id) ?? [];
    for (const att of taskAttachments) {
      if (att.skipped || !att.relativePath) {
        lines.push(`    - ${att.displayName} (skipped)`);
        continue;
      }
      const encodedPath = att.relativePath
        .split("/")
        .map(encodeAttachmentPathSegment)
        .join("/");
      lines.push(`    - [${att.displayName}](${encodedPath})`);
    }
    if (t.body) {
      const rendered =
        t.bodyContentType === "html"
          ? turndown.turndown(t.body)
          : t.body;
      for (const line of rendered.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          lines.push(`    - ${trimmed}`);
        }
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Export the tasks from a Microsoft To-Do list to a Markdown file.
 */
export type CompletedAttachmentsMode = "default" | "skip" | "subfolder";

export async function exportList(
  identifier: string,
  outPath?: string,
  orderingSourcePath?: string,
  metadata = false,
  attachments = false,
  attachmentPath?: string,
  inlineLink: InlineLinkMode = "auto",
  completedAttachments: CompletedAttachmentsMode = "default"
): Promise<void> {
  const lists = await getTaskLists();
  const list = await resolveList(identifier, lists);
  const resolvedPath = outPath ?? `${list.displayName}.md`;
  await exportResolvedList(list, resolvedPath, orderingSourcePath, metadata, attachments, attachmentPath, inlineLink, completedAttachments);
}

/**
 * Export every task list in the account to Markdown files in the given directory.
 *
 * `outDir` defaults to the current working directory. If `orderingSourcePath`
 * is provided it must point to a directory; per-list files are resolved using
 * the same lookup rules as {@link resolveOrderingSourcePath}.
 */
export async function exportAllLists(
  outDir = ".",
  orderingSourcePath?: string,
  metadata = false,
  attachments = false,
  attachmentPath?: string,
  inlineLink: InlineLinkMode = "auto",
  completedAttachments: CompletedAttachmentsMode = "default"
): Promise<void> {
  if (orderingSourcePath) {
    let isDir = false;
    try {
      isDir = fs.statSync(orderingSourcePath).isDirectory();
    } catch {
      throw new Error(`--ordering-source path does not exist: ${orderingSourcePath}`);
    }
    if (!isDir) {
      throw new Error(
        `--ordering-source must be a directory when used with --all (got file: ${orderingSourcePath})`
      );
    }
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const lists = await getTaskLists();
  console.error(`Exporting ${lists.length} list(s) to ${outDir}`);

  for (const list of lists) {
    const filename = `${sanitizeFilename(list.displayName) || list.id}.md`;
    const outPath = path.join(outDir, filename);
    await exportResolvedList(list, outPath, orderingSourcePath, metadata, attachments, attachmentPath, inlineLink, completedAttachments);
  }
}

async function exportResolvedList(
  list: TodoTaskList,
  resolvedPath: string,
  orderingSourcePath: string | undefined,
  metadata: boolean,
  attachments: boolean,
  attachmentPath: string | undefined,
  inlineLink: InlineLinkMode,
  completedAttachments: CompletedAttachmentsMode = "default"
): Promise<void> {
  console.error(`Exporting list: ${list.displayName}`);

  const tasks = await getTasks(list.id);

  let orderingSource: string | undefined;
  if (orderingSourcePath) {
    const resolvedOrderingPath = resolveOrderingSourcePath(orderingSourcePath, list.displayName);
    if (resolvedOrderingPath) {
      orderingSource = fs.readFileSync(resolvedOrderingPath, "utf-8");
      if (resolvedOrderingPath !== orderingSourcePath) {
        console.error(`Using ordering source: ${resolvedOrderingPath}`);
      }
    } else {
      console.error(
        `No ordering source file found for "${list.displayName}" in ${orderingSourcePath}`
      );
    }
  }

  const attachmentMap = new Map<string, RenderAttachment[]>();

  if (attachments) {
    const defaultDir = path.basename(resolvedPath, path.extname(resolvedPath)) + ".attachments";
    const attachDir = attachmentPath
      ? path.resolve(path.dirname(resolvedPath), attachmentPath)
      : path.join(path.dirname(resolvedPath), defaultDir);
    const attachDirRel = attachmentPath
      ? path.relative(path.dirname(resolvedPath), attachDir)
      : defaultDir;

    for (const task of tasks) {
      const taskAttachments = await getTaskAttachments(list.id, task.id);
      if (taskAttachments.length === 0) continue;

      const isCompleted = task.status === "completed";
      const skip = completedAttachments === "skip" && isCompleted;
      const useSubfolder = completedAttachments === "subfolder" && isCompleted;
      const taskAttachDir = useSubfolder ? path.join(attachDir, "completed") : attachDir;
      const taskAttachDirRel = useSubfolder ? `${attachDirRel}/completed` : attachDirRel;

      if (!skip && !fs.existsSync(taskAttachDir)) {
        fs.mkdirSync(taskAttachDir, { recursive: true });
      }

      const renderAttachments: RenderAttachment[] = [];
      for (const att of taskAttachments) {
        if (skip) {
          renderAttachments.push({ displayName: att.name, skipped: true });
          continue;
        }

        const diskName = attachmentDiskName(att.name, att.id);
        const diskPath = path.join(taskAttachDir, diskName);

        if (!fs.existsSync(diskPath)) {
          const content = await downloadAttachment(list.id, task.id, att.id);
          fs.writeFileSync(diskPath, content);
        }

        renderAttachments.push({
          displayName: att.name,
          relativePath: `${taskAttachDirRel}/${diskName}`,
        });
      }
      attachmentMap.set(task.id, renderAttachments);
    }
  }

  const markdown = renderMarkdown(tasks, orderingSource, metadata, attachmentMap, inlineLink);
  const filenameBase = path.basename(resolvedPath, path.extname(resolvedPath));
  const frontmatter = filenameBase === list.displayName
    ? ""
    : `---\ntitle: ${formatYamlScalar(list.displayName)}\n---\n`;
  fs.writeFileSync(resolvedPath, frontmatter + markdown, "utf-8");

  console.error(
    `Wrote ${tasks.length} task(s) to ${resolvedPath}`
  );
}

/**
 * Format a string as a YAML scalar suitable for a frontmatter value.
 * Uses double-quoted style with minimal escaping when needed; otherwise
 * returns the string unchanged.
 */
export function formatYamlScalar(value: string): string {
  // Quote when the value contains characters that would otherwise be ambiguous
  // in YAML, or when leading/trailing whitespace is present.
  const needsQuoting =
    value !== value.trim() ||
    value === "" ||
    /[:#&*!|>'"%@`,\[\]{}?\\]/.test(value) ||
    /^[-?]/.test(value) ||
    /\n/.test(value);

  if (!needsQuoting) return value;

  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
