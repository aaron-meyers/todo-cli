import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TodoTask, TodoTaskList } from "../graph.js";

vi.mock("../graph.js", () => ({
  getTaskLists: vi.fn(),
  getTasks: vi.fn(),
  getTaskAttachments: vi.fn(),
  downloadAttachment: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() };
});

import * as fs from "node:fs";
import { getTaskLists, getTasks, getTaskAttachments, downloadAttachment } from "../graph.js";
import {
  resolveList,
  parseOrderingSource,
  applyOrdering,
  renderMarkdown,
  formatListOutput,
  formatMetadata,
  formatRecurrence,
  sanitizeFilename,
  toDateOnly,
  exportList,
  type RenderAttachment,
  type InlineLinkMode,
} from "../export.js";

const mockedGetTaskLists = vi.mocked(getTaskLists);
const mockedGetTasks = vi.mocked(getTasks);
const mockedGetTaskAttachments = vi.mocked(getTaskAttachments);
const mockedDownloadAttachment = vi.mocked(downloadAttachment);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(title: string, status = "notStarted", checklistItems: TodoTask["checklistItems"] = [], body = "", linkedResources: TodoTask["linkedResources"] = []): TodoTask {
  return { id: `id-${title}`, title, status, checklistItems, linkedResources, body };
}

const sampleLists: TodoTaskList[] = [
  { id: "list-1", displayName: "Shopping" },
  { id: "list-2", displayName: "Daily" },
  { id: "list-3", displayName: "Daily Standup" },
];

// ---------------------------------------------------------------------------
// formatListOutput
// ---------------------------------------------------------------------------

describe("formatListOutput", () => {
  it("formats lists with names only by default", () => {
    const output = formatListOutput(sampleLists);
    expect(output).toBe("Shopping\nDaily\nDaily Standup");
  });

  it("includes IDs when verbose is true", () => {
    const output = formatListOutput(sampleLists, true);
    expect(output).toBe(
      "Shopping (list-1)\nDaily (list-2)\nDaily Standup (list-3)"
    );
  });

  it("returns empty string for no lists", () => {
    expect(formatListOutput([])).toBe("");
  });

  it("handles a single list", () => {
    const output = formatListOutput([{ id: "abc", displayName: "My List" }]);
    expect(output).toBe("My List");
  });
});

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
  it("extracts task titles from send-a-copy format", () => {
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
      "    - [ ] Child 1",
      "    - [x] Child 2",
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
    expect(md).toContain("    - [ ] Sub\n");
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

  it("renders notes as indented bullet items", () => {
    const t = task("Task", "notStarted", [], "<p>Remember to check twice</p>");
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - Remember to check twice",
    ]);
  });

  it("renders multi-paragraph notes as separate bullets", () => {
    const t = task("Task", "notStarted", [], "<p>First paragraph</p><p>Second paragraph</p>");
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - First paragraph",
      "    - Second paragraph",
    ]);
  });

  it("renders notes with line breaks as separate bullets", () => {
    const t = task("Task", "notStarted", [], "<p>Line 1<br>Line 2<br>Line 3</p>");
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - Line 1",
      "    - Line 2",
      "    - Line 3",
    ]);
  });

  it("places notes after subtasks", () => {
    const t = task("Task", "notStarted", [
      { displayName: "Subtask", isChecked: false },
    ], "<p>A note</p>");
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [ ] Subtask",
      "    - A note",
    ]);
  });

  it("skips empty body", () => {
    const t = task("Task", "notStarted", [], "");
    const md = renderMarkdown([t]);
    expect(md).toBe("- [ ] Task\n");
  });

  it("skips whitespace-only body", () => {
    const t = task("Task", "notStarted", [], "   \n\n  ");
    const md = renderMarkdown([t]);
    expect(md).toBe("- [ ] Task\n");
  });

  it("converts HTML bold and italic in notes", () => {
    const t = task("Task", "notStarted", [], "<p>This is <b>bold</b> and <i>italic</i></p>");
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - This is **bold** and _italic_",
    ]);
  });

  it("renders linked resources as indented Markdown links", () => {
    const t = task("Task", "notStarted", [], "", [
      { displayName: "Important Email", webUrl: "https://outlook.office.com/mail/read/123", applicationName: "Outlook" },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [Important Email](https://outlook.office.com/mail/read/123) (Outlook)",
    ]);
  });

  it("renders linked resources after subtasks but before notes", () => {
    const t = task("Task", "notStarted", [
      { displayName: "Subtask", isChecked: false },
    ], "<p>A note</p>", [
      { displayName: "Link", webUrl: "https://example.com", applicationName: "Teams" },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [ ] Subtask",
      "    - [Link](https://example.com) (Teams)",
      "    - A note",
    ]);
  });

  it("renders multiple linked resources", () => {
    const t = task("Task", "notStarted", [], "", [
      { displayName: "Email", webUrl: "https://outlook.com/1", applicationName: "Outlook" },
      { displayName: "Note", webUrl: "https://onenote.com/2", applicationName: "OneNote" },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [Email](https://outlook.com/1) (Outlook)",
      "    - [Note](https://onenote.com/2) (OneNote)",
    ]);
  });

  it("inlines link in title when single linked resource matches task title", () => {
    const t = task("Review PR", "notStarted", [], "", [
      { displayName: "Review PR", webUrl: "https://github.com/pr/1", applicationName: "GitHub" },
    ]);
    const md = renderMarkdown([t]);
    expect(md).toBe("- [ ] [Review PR](https://github.com/pr/1)\n");
  });

  it("inlines link with metadata", () => {
    const t: TodoTask = {
      ...task("Review PR", "notStarted", [], "", [
        { displayName: "Review PR", webUrl: "https://github.com/pr/1", applicationName: "GitHub" },
      ]),
      dueDateTime: "2024-04-25T00:00:00.0000000",
    };
    const md = renderMarkdown([t], undefined, true);
    expect(md).toBe("- [ ] [Review PR](https://github.com/pr/1) 📅 2024-04-25\n");
  });

  it("does not inline when displayName differs from title", () => {
    const t = task("My Task", "notStarted", [], "", [
      { displayName: "Different Name", webUrl: "https://example.com", applicationName: "App" },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] My Task",
      "    - [Different Name](https://example.com) (App)",
    ]);
  });

  it("does not inline when there are multiple linked resources even if one matches", () => {
    const t = task("Task", "notStarted", [], "", [
      { displayName: "Task", webUrl: "https://example.com/1", applicationName: "App1" },
      { displayName: "Other", webUrl: "https://example.com/2", applicationName: "App2" },
    ]);
    const md = renderMarkdown([t]);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [Task](https://example.com/1) (App1)",
      "    - [Other](https://example.com/2) (App2)",
    ]);
  });

  it("inlineLink=always inlines first linked resource regardless of title match", () => {
    const t = task("My Task", "notStarted", [], "", [
      { displayName: "Different Name", webUrl: "https://example.com/1", applicationName: "App" },
    ]);
    const md = renderMarkdown([t], undefined, false, new Map(), "always");
    expect(md).toBe("- [ ] [My Task](https://example.com/1)\n");
  });

  it("inlineLink=always inlines first and renders remaining as bullets", () => {
    const t = task("My Task", "notStarted", [], "", [
      { displayName: "Link1", webUrl: "https://example.com/1", applicationName: "App1" },
      { displayName: "Link2", webUrl: "https://example.com/2", applicationName: "App2" },
    ]);
    const md = renderMarkdown([t], undefined, false, new Map(), "always");
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] [My Task](https://example.com/1)",
      "    - [Link2](https://example.com/2) (App2)",
    ]);
  });

  it("inlineLink=always does not inline when no linked resources", () => {
    const md = renderMarkdown([task("Task")], undefined, false, new Map(), "always");
    expect(md).toBe("- [ ] Task\n");
  });

  it("inlineLink=never renders all linked resources as bullets", () => {
    const t = task("Review PR", "notStarted", [], "", [
      { displayName: "Review PR", webUrl: "https://github.com/pr/1", applicationName: "GitHub" },
    ]);
    const md = renderMarkdown([t], undefined, false, new Map(), "never");
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Review PR",
      "    - [Review PR](https://github.com/pr/1) (GitHub)",
    ]);
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe("sanitizeFilename", () => {
  it("passes through safe names", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFilename('file<>:"/\\|?*.txt')).toBe("file_________.txt");
  });

  it("strips trailing dots", () => {
    expect(sanitizeFilename("file...")).toBe("file");
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown with attachments
// ---------------------------------------------------------------------------

describe("renderMarkdown with attachments", () => {
  it("renders attachments as indented links", () => {
    const t = task("Task");
    const attachmentMap = new Map<string, RenderAttachment[]>([
      ["id-Task", [{ displayName: "report.pdf", relativePath: "out.attachments/att1-report.pdf" }]],
    ]);
    const md = renderMarkdown([t], undefined, false, attachmentMap);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [report.pdf](out.attachments/att1-report.pdf)",
    ]);
  });

  it("renders attachments after linked resources and before notes", () => {
    const t = task("Task", "notStarted", [
      { displayName: "Subtask", isChecked: false },
    ], "<p>A note</p>", [
      { displayName: "Link", webUrl: "https://example.com", applicationName: "App" },
    ]);
    const attachmentMap = new Map<string, RenderAttachment[]>([
      ["id-Task", [{ displayName: "file.txt", relativePath: "out.attachments/att1-file.txt" }]],
    ]);
    const md = renderMarkdown([t], undefined, false, attachmentMap);
    const lines = md.trimEnd().split("\n");
    expect(lines).toEqual([
      "- [ ] Task",
      "    - [ ] Subtask",
      "    - [Link](https://example.com) (App)",
      "    - [file.txt](out.attachments/att1-file.txt)",
      "    - A note",
    ]);
  });

  it("URL-encodes attachment paths with special characters", () => {
    const t = task("Task");
    const attachmentMap = new Map<string, RenderAttachment[]>([
      ["id-Task", [{ displayName: "my file.pdf", relativePath: "out.attachments/att1-my file.pdf" }]],
    ]);
    const md = renderMarkdown([t], undefined, false, attachmentMap);
    expect(md).toContain("(out.attachments/att1-my%20file.pdf)");
  });

  it("omits attachments when map is empty", () => {
    const md = renderMarkdown([task("Task")]);
    expect(md).toBe("- [ ] Task\n");
  });
});

// ---------------------------------------------------------------------------
// toDateOnly
// ---------------------------------------------------------------------------

describe("toDateOnly", () => {
  it("extracts date from ISO datetime", () => {
    expect(toDateOnly("2024-04-21T14:30:00Z")).toBe("2024-04-21");
  });

  it("extracts date from datetime with fractional seconds", () => {
    expect(toDateOnly("2024-04-21T15:30:00.0000000")).toBe("2024-04-21");
  });
});

// ---------------------------------------------------------------------------
// formatRecurrence
// ---------------------------------------------------------------------------

describe("formatRecurrence", () => {
  it("formats daily recurrence", () => {
    expect(formatRecurrence({ type: "daily", interval: 1 })).toBe("every day");
  });

  it("formats daily with interval", () => {
    expect(formatRecurrence({ type: "daily", interval: 3 })).toBe("every 3 days");
  });

  it("formats weekly recurrence", () => {
    expect(formatRecurrence({ type: "weekly", interval: 1 })).toBe("every week");
  });

  it("formats weekly with interval", () => {
    expect(formatRecurrence({ type: "weekly", interval: 2 })).toBe("every 2 weeks");
  });

  it("formats weekly with days", () => {
    expect(formatRecurrence({ type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday"] }))
      .toBe("every week on monday, wednesday");
  });

  it("formats monthly recurrence", () => {
    expect(formatRecurrence({ type: "absoluteMonthly", interval: 1 })).toBe("every month");
  });

  it("formats monthly with interval", () => {
    expect(formatRecurrence({ type: "absoluteMonthly", interval: 3 })).toBe("every 3 months");
  });

  it("formats yearly recurrence", () => {
    expect(formatRecurrence({ type: "absoluteYearly", interval: 1 })).toBe("every year");
  });

  it("handles unknown type gracefully", () => {
    expect(formatRecurrence({ type: "relativeMonthly", interval: 2 })).toBe("every 2 relativeMonthly");
  });
});

// ---------------------------------------------------------------------------
// formatMetadata
// ---------------------------------------------------------------------------

describe("formatMetadata", () => {
  it("formats all metadata fields", () => {
    const t: TodoTask = {
      ...task("Test"),
      createdDateTime: "2024-04-10T12:00:00Z",
      dueDateTime: "2024-04-25T00:00:00.0000000",
      reminderDateTime: "2024-04-24T09:00:00.0000000",
      completedDateTime: "2024-04-20T15:00:00.0000000",
      recurrence: { type: "weekly", interval: 1 },
    };
    expect(formatMetadata(t)).toBe(
      "➕ 2024-04-10 📅 2024-04-25 ⏳ 2024-04-24 🔁 every week ✅ 2024-04-20"
    );
  });

  it("returns empty string when no metadata", () => {
    expect(formatMetadata(task("Test"))).toBe("");
  });

  it("includes only present fields", () => {
    const t: TodoTask = {
      ...task("Test"),
      dueDateTime: "2024-04-25T00:00:00.0000000",
    };
    expect(formatMetadata(t)).toBe("📅 2024-04-25");
  });

  it("includes high priority emoji", () => {
    const t: TodoTask = {
      ...task("Test"),
      importance: "high",
      dueDateTime: "2024-04-25T00:00:00.0000000",
    };
    expect(formatMetadata(t)).toBe("⏫ 📅 2024-04-25");
  });

  it("omits priority for normal importance", () => {
    const t: TodoTask = {
      ...task("Test"),
      importance: "normal",
      dueDateTime: "2024-04-25T00:00:00.0000000",
    };
    expect(formatMetadata(t)).toBe("📅 2024-04-25");
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown with metadata
// ---------------------------------------------------------------------------

describe("renderMarkdown with metadata", () => {
  it("includes metadata inline when enabled", () => {
    const t: TodoTask = {
      ...task("Buy milk"),
      createdDateTime: "2024-04-10T12:00:00Z",
      dueDateTime: "2024-04-25T00:00:00.0000000",
    };
    const md = renderMarkdown([t], undefined, true);
    expect(md).toBe("- [ ] Buy milk ➕ 2024-04-10 📅 2024-04-25\n");
  });

  it("omits metadata when disabled", () => {
    const t: TodoTask = {
      ...task("Buy milk"),
      createdDateTime: "2024-04-10T12:00:00Z",
    };
    const md = renderMarkdown([t], undefined, false);
    expect(md).toBe("- [ ] Buy milk\n");
  });

  it("does not add trailing space when task has no metadata", () => {
    const md = renderMarkdown([task("Simple")], undefined, true);
    expect(md).toBe("- [ ] Simple\n");
  });
});
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

  it("downloads attachments when flag is set", async () => {
    const mockedWriteFileSync = vi.mocked(fs.writeFileSync);
    const mockedExistsSync = vi.mocked(fs.existsSync);
    const mockedMkdirSync = vi.mocked(fs.mkdirSync);
    mockedGetTasks.mockResolvedValue([task("Task A")]);
    mockedGetTaskAttachments.mockResolvedValue([
      { id: "att-1", name: "report.pdf", contentType: "application/pdf", size: 1024 },
    ]);
    mockedDownloadAttachment.mockResolvedValue(Buffer.from("fake-pdf"));
    mockedExistsSync.mockReturnValue(false);

    await exportList("Shopping", "out.md", undefined, false, true);

    expect(mockedGetTaskAttachments).toHaveBeenCalledWith("list-1", "id-Task A");
    expect(mockedDownloadAttachment).toHaveBeenCalledWith("list-1", "id-Task A", "att-1");
    expect(mockedMkdirSync).toHaveBeenCalled();
    // Markdown file + attachment file = 2 writes
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(2);
    const mdContent = mockedWriteFileSync.mock.calls.find(
      (c) => c[0] === "out.md"
    )?.[1] as string;
    expect(mdContent).toContain("[report.pdf]");
    expect(mdContent).toContain("out.attachments/att-1-report.pdf");
  });

  it("skips attachment download when flag is not set", async () => {
    mockedGetTasks.mockResolvedValue([task("Task A")]);

    await exportList("Shopping", "out.md");

    expect(mockedGetTaskAttachments).not.toHaveBeenCalled();
  });

  it("skips download when attachment file already exists on disk", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);
    mockedGetTasks.mockResolvedValue([task("Task A")]);
    mockedGetTaskAttachments.mockResolvedValue([
      { id: "att-1", name: "report.pdf", contentType: "application/pdf", size: 1024 },
    ]);
    // First call: attachDir doesn't exist; second call: file already exists
    mockedExistsSync.mockImplementation((p) => {
      return String(p).endsWith("att-1-report.pdf");
    });

    await exportList("Shopping", "out.md", undefined, false, true);

    expect(mockedDownloadAttachment).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledTimes(1); // only the markdown file
  });

  it("uses custom attachment folder path when provided", async () => {
    const mockedWriteFileSync = vi.mocked(fs.writeFileSync);
    const mockedExistsSync = vi.mocked(fs.existsSync);
    mockedGetTasks.mockResolvedValue([task("Task A")]);
    mockedGetTaskAttachments.mockResolvedValue([
      { id: "att-1", name: "report.pdf", contentType: "application/pdf", size: 1024 },
    ]);
    mockedDownloadAttachment.mockResolvedValue(Buffer.from("fake-pdf"));
    mockedExistsSync.mockReturnValue(false);

    await exportList("Shopping", "out.md", undefined, false, true, "my-files");

    const mdContent = mockedWriteFileSync.mock.calls.find(
      (c) => c[0] === "out.md"
    )?.[1] as string;
    expect(mdContent).toContain("[report.pdf](my-files/att-1-report.pdf)");
  });
});
