import * as fs from "node:fs";
import * as path from "node:path";
import TurndownService from "turndown";
import { getTaskLists, getTasks, getTaskAttachments, downloadAttachment, type TodoTaskList, type TodoTask, type RecurrencePattern } from "./graph.js";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

/** Attachment info resolved for rendering (display name + relative path). */
export interface RenderAttachment {
  displayName: string;
  relativePath: string;
}

/** Sanitize a filename for safe filesystem use. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "");
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

/**
 * Parse a "Share copy" text from the To-Do app and return an ordered
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
      const days = daysOfWeek.join(", ");
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
  if (task.createdDateTime) {
    parts.push(`➕ ${toDateOnly(task.createdDateTime)}`);
  }
  if (task.dueDateTime) {
    parts.push(`📅 ${toDateOnly(task.dueDateTime)}`);
  }
  if (task.reminderDateTime) {
    parts.push(`⏳ ${toDateOnly(task.reminderDateTime)}`);
  }
  if (task.recurrence) {
    parts.push(`🔁 ${formatRecurrence(task.recurrence)}`);
  }
  if (task.completedDateTime) {
    parts.push(`✅ ${toDateOnly(task.completedDateTime)}`);
  }

  return parts.join(" ");
}

/**
 * Render tasks to Markdown checkbox lines.
 * Incomplete tasks appear first, followed by completed tasks.
 * Subtasks are indented under their parent.
 */
export function renderMarkdown(
  tasks: TodoTask[],
  orderingSource?: string,
  metadata = false,
  attachmentMap: Map<string, RenderAttachment[]> = new Map()
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

    // Inline the link in the title when there's exactly one linked resource
    // whose displayName matches the task title
    const inlineLink =
      t.linkedResources.length === 1 &&
      t.linkedResources[0].displayName === titleText;

    if (inlineLink) {
      lines.push(`- ${checkbox} [${titleText}](${t.linkedResources[0].webUrl})${meta}`);
    } else {
      lines.push(`- ${checkbox} ${titleText}${meta}`);
    }
    for (const ci of t.checklistItems) {
      const subCheckbox = ci.isChecked ? "[x]" : "[ ]";
      lines.push(`    - ${subCheckbox} ${ci.displayName.trimEnd()}`);
    }
    if (!inlineLink) {
      for (const lr of t.linkedResources) {
        lines.push(`    - [${lr.displayName}](${lr.webUrl}) (${lr.applicationName})`);
      }
    }
    const taskAttachments = attachmentMap.get(t.id) ?? [];
    for (const att of taskAttachments) {
      const encodedPath = att.relativePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      lines.push(`    - [${att.displayName}](${encodedPath})`);
    }
    if (t.body) {
      const markdown = turndown.turndown(t.body);
      for (const line of markdown.split(/\n/)) {
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
export async function exportList(
  identifier: string,
  outPath?: string,
  orderingSourcePath?: string,
  metadata = false,
  attachments = false
): Promise<void> {
  const lists = await getTaskLists();
  const list = await resolveList(identifier, lists);
  const resolvedPath = outPath ?? `${list.displayName}.md`;
  console.error(`Exporting list: ${list.displayName}`);

  const tasks = await getTasks(list.id);

  const orderingSource = orderingSourcePath
    ? fs.readFileSync(orderingSourcePath, "utf-8")
    : undefined;

  const attachmentMap = new Map<string, RenderAttachment[]>();

  if (attachments) {
    const basename = path.basename(resolvedPath, path.extname(resolvedPath));
    const outDir = path.dirname(resolvedPath);
    const attachDir = path.join(outDir, `${basename}.attachments`);
    const attachDirName = `${basename}.attachments`;

    for (const task of tasks) {
      const taskAttachments = await getTaskAttachments(list.id, task.id);
      if (taskAttachments.length === 0) continue;

      if (!fs.existsSync(attachDir)) {
        fs.mkdirSync(attachDir, { recursive: true });
      }

      const renderAttachments: RenderAttachment[] = [];
      for (const att of taskAttachments) {
        const safeName = sanitizeFilename(att.name) || att.id;
        const diskName = `${att.id}-${safeName}`;
        const diskPath = path.join(attachDir, diskName);

        const content = await downloadAttachment(list.id, task.id, att.id);
        fs.writeFileSync(diskPath, content);

        renderAttachments.push({
          displayName: att.name,
          relativePath: `${attachDirName}/${diskName}`,
        });
      }
      attachmentMap.set(task.id, renderAttachments);
    }
  }

  const markdown = renderMarkdown(tasks, orderingSource, metadata, attachmentMap);
  fs.writeFileSync(resolvedPath, markdown, "utf-8");

  console.error(
    `Wrote ${tasks.length} task(s) to ${resolvedPath}`
  );
}
