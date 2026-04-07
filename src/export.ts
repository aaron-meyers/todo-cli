import * as fs from "node:fs";
import { getTaskLists, getTasks, type TodoTaskList } from "./graph.js";

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
 * Export the tasks from a Microsoft To-Do list to a Markdown file.
 */
export async function exportList(
  identifier: string,
  outPath: string
): Promise<void> {
  const list = await resolveList(identifier);
  console.error(`Exporting list: ${list.displayName}`);

  const tasks = await getTasks(list.id);

  // Group incomplete tasks first, then completed, preserving API order within each group
  const incomplete = tasks.filter((t) => t.status !== "completed");
  const completed = tasks.filter((t) => t.status === "completed");
  const ordered = [...incomplete, ...completed];

  const lines = ordered.map((t) => {
    const checkbox = t.status === "completed" ? "[x]" : "[ ]";
    return `- ${checkbox} ${t.title}`;
  });

  const markdown = lines.join("\n") + "\n";
  fs.writeFileSync(outPath, markdown, "utf-8");

  console.error(
    `Wrote ${tasks.length} task(s) to ${outPath}`
  );
}
