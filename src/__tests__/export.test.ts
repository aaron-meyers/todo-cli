import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TodoTask, TodoTaskList } from "../graph.js";

vi.mock("../graph.js", () => ({
  getTaskLists: vi.fn(),
  getTasks: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn() };
});

import * as fs from "node:fs";
import { getTaskLists, getTasks } from "../graph.js";
import {
  resolveList,
  parseOrderingSource,
  applyOrdering,
  renderMarkdown,
  exportList,
} from "../export.js";

const mockedGetTaskLists = vi.mocked(getTaskLists);
const mockedGetTasks = vi.mocked(getTasks);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(title: string, status = "notStarted", checklistItems: TodoTask["checklistItems"] = []): TodoTask {
  return { id: `id-${title}`, title, status, checklistItems };
}

const sampleLists: TodoTaskList[] = [
  { id: "list-1", displayName: "Shopping" },
  { id: "list-2", displayName: "Daily" },
  { id: "list-3", displayName: "Daily Standup" },
];

// ---------------------------------------------------------------------------
// resolveList
// ---------------------------------------------------------------------------

describe("resolveList", () => {
  it("resolves by exact ID", async () => {
    const result = await resolveList("list-2", sampleLists);
    expect(result.displayName).toBe("Daily");
  });

  it("resolves by exact name (case-insensitive)", async () => {
    const result = await resolveList("shopping", sampleLists);
    expect(result.id).toBe("list-1");
  });

  it("resolves by partial name when unambiguous", async () => {
    const result = await resolveList("shop", sampleLists);
    expect(result.id).toBe("list-1");
  });

  it("throws on ambiguous partial match", async () => {
    await expect(resolveList("dai", sampleLists)).rejects.toThrow("Ambiguous");
  });

  it("throws when no list matches", async () => {
    await expect(resolveList("nonexistent", sampleLists)).rejects.toThrow(
      "No task list found"
    );
  });

  it("prefers exact ID over name match", async () => {
    const lists: TodoTaskList[] = [
      { id: "Shopping", displayName: "Groceries" },
      { id: "list-x", displayName: "Shopping" },
    ];
    const result = await resolveList("Shopping", lists);
    expect(result.displayName).toBe("Groceries");
  });

  it("prefers exact name match over partial", async () => {
    const lists: TodoTaskList[] = [
      { id: "list-a", displayName: "Daily" },
      { id: "list-b", displayName: "Daily Standup" },
    ];
    const result = await resolveList("Daily", lists);
    expect(result.id).toBe("list-a");
  });
});

// ---------------------------------------------------------------------------
// parseOrderingSource
// ---------------------------------------------------------------------------

describe("parseOrderingSource", () => {
  it("extracts task titles from share format", () => {
    const content = [
      "📅 My List",
      "",
      "◯ First task",
      "   ◦ subtask a",
      "   ✔ subtask b",
      "◯ Second task",
      "◯ Third task",
    ].join("\n");

    expect(parseOrderingSource(content)).toEqual([
      "First task",
      "Second task",
      "Third task",
    ]);
  });

  it("strips importance marker ★", () => {
    const content = "◯ Important task ★\n◯ Normal task";
    expect(parseOrderingSource(content)).toEqual([
      "Important task",
      "Normal task",
    ]);
  });

  it("handles empty content", () => {
    expect(parseOrderingSource("")).toEqual([]);
  });

  it("ignores subtask lines", () => {
    const content = [
      "◯ Parent",
      "   ◦ child 1",
      "   ✔ child 2",
    ].join("\n");

    expect(parseOrderingSource(content)).toEqual(["Parent"]);
  });

  it("handles Windows line endings", () => {
    const content = "◯ Task A\r\n◯ Task B\r\n";
    expect(parseOrderingSource(content)).toEqual(["Task A", "Task B"]);
  });
});

// ---------------------------------------------------------------------------
// applyOrdering
// ---------------------------------------------------------------------------

describe("applyOrdering", () => {
  it("reorders tasks to match title order", () => {
    const tasks = [task("C"), task("A"), task("B")];
    const ordered = applyOrdering(tasks, ["A", "B", "C"]);
    expect(ordered.map((t) => t.title)).toEqual(["A", "B", "C"]);
  });

  it("appends unmatched tasks at the end", () => {
    const tasks = [task("C"), task("X"), task("A")];
    const ordered = applyOrdering(tasks, ["A", "C"]);
    expect(ordered.map((t) => t.title)).toEqual(["A", "C", "X"]);
  });

  it("preserves original order for unmatched tasks", () => {
    const tasks = [task("Z"), task("Y"), task("A")];
    const ordered = applyOrdering(tasks, ["A"]);
    expect(ordered.map((t) => t.title)).toEqual(["A", "Z", "Y"]);
  });

  it("handles empty ordering list", () => {
    const tasks = [task("B"), task("A")];
    const ordered = applyOrdering(tasks, []);
    expect(ordered.map((t) => t.title)).toEqual(["B", "A"]);
  });

  it("handles empty tasks", () => {
    const ordered = applyOrdering([], ["A", "B"]);
    expect(ordered).toEqual([]);
  });

  it("trims trailing whitespace from task titles when matching", () => {
    const tasks = [{ ...task("Task A  "), title: "Task A  " }];
    const ordered = applyOrdering(tasks, ["Task A"]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0].title).toBe("Task A  ");
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown
// ---------------------------------------------------------------------------

describe("renderMarkdown", () => {
  it("renders incomplete tasks with [ ]", () => {
    const md = renderMarkdown([task("Buy milk")]);
    expect(md).toBe("- [ ] Buy milk\n");
  });

  it("renders completed tasks with [x]", () => {
    const md = renderMarkdown([task("Done", "completed")]);
    expect(md).toBe("- [x] Done\n");
  });

  it("places incomplete tasks before completed", () => {
    const tasks = [
      task("Completed", "completed"),
      task("Pending"),
    ];
    const md = renderMarkdown(tasks);
    const lines = md.trimEnd().split("\n");
    expect(lines[0]).toContain("[ ] Pending");
    expect(lines[1]).toContain("[x] Completed");
  });

  it("renders subtasks indented", () => {
    const t = task("Parent", "notStarted", [
      { displayName: "Child 1", isChecked: false },
      { displayName: "Child 2", isChecked: true },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Parent",
      "  - [ ] Child 1",
      "  - [x] Child 2",
    ]);
  });

  it("trims trailing whitespace from titles", () => {
    const t = { ...task("Trailing   "), title: "Trailing   " };
    const md = renderMarkdown([t]);
    expect(md).toBe("- [ ] Trailing\n");
  });

  it("trims trailing whitespace from subtask names", () => {
    const t = task("Parent", "notStarted", [
      { displayName: "Sub   ", isChecked: false },
    ]);
    const md = renderMarkdown([t]);
    expect(md).toContain("  - [ ] Sub\n");
  });

  it("applies ordering source when provided", () => {
    const tasks = [task("C"), task("A"), task("B")];
    const orderingContent = "◯ A\n◯ B\n◯ C";
    const md = renderMarkdown(tasks, orderingContent);
    const lines = md.trimEnd().split("\n");
    expect(lines.map((l) => l.replace("- [ ] ", ""))).toEqual(["A", "B", "C"]);
  });

  it("ends with trailing newline", () => {
    const md = renderMarkdown([task("A")]);
    expect(md.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exportList (integration with mocked Graph API)
// ---------------------------------------------------------------------------

describe("exportList", () => {
  const mockedWriteFileSync = vi.mocked(fs.writeFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTaskLists.mockResolvedValue(sampleLists);
    mockedWriteFileSync.mockImplementation(() => {});
  });

  it("writes markdown file for matching list", async () => {
    mockedGetTasks.mockResolvedValue([
      task("Task 1"),
      task("Task 2", "completed"),
    ]);

    await exportList("Shopping", "out.md");

    expect(mockedGetTasks).toHaveBeenCalledWith("list-1");
    expect(mockedWriteFileSync).toHaveBeenCalledOnce();
    const content = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(content).toContain("- [ ] Task 1");
    expect(content).toContain("- [x] Task 2");
  });

  it("defaults output path to list name + .md", async () => {
    mockedGetTasks.mockResolvedValue([task("A")]);

    await exportList("Shopping");

    expect(mockedWriteFileSync.mock.calls[0][0]).toBe("Shopping.md");
  });

  it("throws for ambiguous list identifier", async () => {
    await expect(exportList("dai", "out.md")).rejects.toThrow("Ambiguous");
  });

  it("throws for unknown list identifier", async () => {
    await expect(exportList("nope", "out.md")).rejects.toThrow("No task list found");
  });
});
