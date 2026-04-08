import * as fs from "node:fs";
import { getTaskLists, getTasks, type TodoTaskList, type TodoTask } from "./graph.js";

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
async function resolveList(identifier: string): Promise<TodoTaskList> {
  const lists = await getTaskLists();

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
 * Parse a "Share copy" text file from the To-Do app and return an ordered
 * list of task titles. The file uses ◯ for parent tasks, ◦/✔ for subtasks,
 * and optionally appends ★ for important tasks.
 */
function parseOrderingSource(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
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
 * Sort tasks based on the order from an ordering source file.
 * Tasks found in the source are ordered by their position there;
 * tasks not found are appended at the end in their original order.
 */
function applyOrdering(tasks: TodoTask[], orderingSourcePath: string): TodoTask[] {
  const orderedTitles = parseOrderingSource(orderingSourcePath);
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
 * Export the tasks from a Microsoft To-Do list to a Markdown file.
 */
export async function exportList(
  identifier: string,
  outPath?: string,
  orderingSourcePath?: string
): Promise<void> {
  const list = await resolveList(identifier);
  const resolvedPath = outPath ?? `${list.displayName}.md`;
  console.error(`Exporting list: ${list.displayName}`);

  const tasks = await getTasks(list.id);

  // Group incomplete tasks first, then completed, preserving API order within each group
  const incomplete = tasks.filter((t) => t.status !== "completed");
  const completed = tasks.filter((t) => t.status === "completed");

  // Apply ordering source if provided
  const orderedIncomplete = orderingSourcePath
    ? applyOrdering(incomplete, orderingSourcePath)
    : incomplete;
  const orderedCompleted = orderingSourcePath
    ? applyOrdering(completed, orderingSourcePath)
    : completed;
  const ordered = [...orderedIncomplete, ...orderedCompleted];

  const lines: string[] = [];
  for (const t of ordered) {
    const checkbox = t.status === "completed" ? "[x]" : "[ ]";
    lines.push(`- ${checkbox} ${t.title.trimEnd()}`);
    for (const ci of t.checklistItems) {
      const subCheckbox = ci.isChecked ? "[x]" : "[ ]";
      lines.push(`  - ${subCheckbox} ${ci.displayName.trimEnd()}`);
    }
  }

  const markdown = lines.join("\n") + "\n";
  fs.writeFileSync(resolvedPath, markdown, "utf-8");

  console.error(
    `Wrote ${tasks.length} task(s) to ${resolvedPath}`
  );
}
