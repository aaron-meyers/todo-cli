import * as fs from "node:fs";
import { getTaskLists, getTasks, type TodoTaskList, type TodoTask } from "./graph.js";

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

/**
 * Render tasks to Markdown checkbox lines.
 * Incomplete tasks appear first, followed by completed tasks.
 * Subtasks are indented under their parent.
 */
export function renderMarkdown(
  tasks: TodoTask[],
  orderingSource?: string
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
    lines.push(`- ${checkbox} ${t.title.trimEnd()}`);
    for (const ci of t.checklistItems) {
      const subCheckbox = ci.isChecked ? "[x]" : "[ ]";
      lines.push(`    - ${subCheckbox} ${ci.displayName.trimEnd()}`);
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
  orderingSourcePath?: string
): Promise<void> {
  const lists = await getTaskLists();
  const list = await resolveList(identifier, lists);
  const resolvedPath = outPath ?? `${list.displayName}.md`;
  console.error(`Exporting list: ${list.displayName}`);

  const tasks = await getTasks(list.id);

  const orderingSource = orderingSourcePath
    ? fs.readFileSync(orderingSourcePath, "utf-8")
    : undefined;

  const markdown = renderMarkdown(tasks, orderingSource);
  fs.writeFileSync(resolvedPath, markdown, "utf-8");

  console.error(
    `Wrote ${tasks.length} task(s) to ${resolvedPath}`
  );
}
