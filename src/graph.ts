import { Client } from "@microsoft/microsoft-graph-client";
import { getAccessToken } from "./auth.js";

export interface TodoTaskList {
  id: string;
  displayName: string;
}

export interface ChecklistItem {
  displayName: string;
  isChecked: boolean;
}

export interface RecurrencePattern {
  type: string; // "daily" | "weekly" | "absoluteMonthly" | "absoluteYearly" | ...
  interval: number;
  daysOfWeek?: string[];
}

export interface LinkedResource {
  displayName: string;
  webUrl: string;
  applicationName: string;
}

export interface TodoTask {
  id: string;
  title: string;
  status: string; // "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  checklistItems: ChecklistItem[];
  linkedResources: LinkedResource[];
  body: string;
  importance?: string; // "low" | "normal" | "high"
  createdDateTime?: string;
  completedDateTime?: string;
  dueDateTime?: string;
  reminderDateTime?: string;
  recurrence?: RecurrencePattern;
}

function createClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

/**
 * Fetch all To-Do task lists for the authenticated user.
 * Uses the delta endpoint as a workaround for a known Graph API bug
 * where the standard /me/todo/lists endpoint omits some lists.
 */
export async function getTaskLists(): Promise<TodoTaskList[]> {
  const token = await getAccessToken();
  const client = createClient(token);

  const seen = new Set<string>();
  const lists: TodoTaskList[] = [];
  let url: string | null | undefined = "/me/todo/lists/delta";

  while (url) {
    const response = await client.api(url).get();
    for (const item of response.value) {
      if (item.id && item.displayName && !seen.has(item.id)) {
        seen.add(item.id);
        lists.push({ id: item.id, displayName: item.displayName });
      }
    }
    url = response["@odata.nextLink"] ?? null;
  }

  return lists;
}

/** Fetch all tasks (with checklist items) in a given task list. */
export async function getTasks(listId: string): Promise<TodoTask[]> {
  const token = await getAccessToken();
  const client = createClient(token);

  const tasks: TodoTask[] = [];
  let url: string | null | undefined = `/me/todo/lists/${listId}/tasks?$expand=checklistItems,linkedResources`;

  while (url) {
    const response = await client.api(url).get();
    for (const item of response.value) {
      const checklistItems: ChecklistItem[] = (item.checklistItems ?? []).map(
        (ci: { displayName: string; isChecked: boolean }) => ({
          displayName: ci.displayName,
          isChecked: ci.isChecked,
        })
      );
      const linkedResources: LinkedResource[] = (item.linkedResources ?? [])
        .filter((lr: { webUrl?: string }) => lr.webUrl)
        .map((lr: { displayName: string; webUrl: string; applicationName: string }) => ({
          displayName: lr.displayName,
          webUrl: lr.webUrl,
          applicationName: lr.applicationName,
        }));
      tasks.push({
        id: item.id,
        title: item.title,
        status: item.status,
        checklistItems,
        linkedResources,
        body: item.body?.content?.trim() ?? "",
        importance: item.importance ?? undefined,
        createdDateTime: item.createdDateTime ?? undefined,
        completedDateTime: item.completedDateTime?.dateTime ?? undefined,
        dueDateTime: item.dueDateTime?.dateTime ?? undefined,
        reminderDateTime: item.reminderDateTime?.dateTime ?? undefined,
        recurrence: item.recurrence?.pattern
          ? {
              type: item.recurrence.pattern.type,
              interval: item.recurrence.pattern.interval,
              daysOfWeek: item.recurrence.pattern.daysOfWeek,
            }
          : undefined,
      });
    }
    url = response["@odata.nextLink"] ?? null;
  }

  return tasks;
}
