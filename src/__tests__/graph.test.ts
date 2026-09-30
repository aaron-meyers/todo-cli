import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  get: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: vi.fn(() => ({ api: mocks.api })),
  },
}));

vi.mock("../auth.js", () => ({
  getAccessToken: mocks.getAccessToken,
}));

import { getTasks, type StatusFilter } from "../graph.js";

describe("getTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue("token");
    mocks.get.mockResolvedValue({ value: [] });
    mocks.api.mockReturnValue({ get: mocks.get });
  });

  it.each([
    [
      "all",
      "/me/todo/lists/list-1/tasks?$expand=checklistItems,linkedResources",
    ],
    [
      "incomplete",
      "/me/todo/lists/list-1/tasks?$filter=status%20ne%20'completed'&$expand=checklistItems,linkedResources",
    ],
    [
      "completed",
      "/me/todo/lists/list-1/tasks?$filter=status%20eq%20'completed'&$expand=checklistItems,linkedResources",
    ],
  ] as const)(
    "requests %s tasks from Graph",
    async (filterStatus: StatusFilter, expectedUrl: string) => {
      await getTasks("list-1", filterStatus);

      expect(mocks.api).toHaveBeenCalledOnce();
      expect(mocks.api).toHaveBeenCalledWith(expectedUrl);
    }
  );
});
