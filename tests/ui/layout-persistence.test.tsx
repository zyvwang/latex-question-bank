import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LayoutPreferencesProvider } from "../../src/context/LayoutPreferencesContext.js";
import { useLayoutPreferences } from "../../src/context/layoutPreferences.js";
import { DEFAULT_UI_LAYOUT_PREFERENCES } from "../../shared/ui-layout-preferences.js";

let close: () => Promise<void>;
const save = vi.fn();
beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined);
  window.lqb = {
    platform: "darwin",
    selectWorkspaceDirectory: vi.fn(), openPath: vi.fn(), revealExportFolder: vi.fn(), openExternal: vi.fn(),
    readUiLayoutPreferences: vi.fn().mockResolvedValue(DEFAULT_UI_LAYOUT_PREFERENCES),
    saveUiLayoutPreferences: save,
    onBeforeClose: (listener) => { close = listener; return () => undefined; }
  };
});
function Controls() {
  const layout = useLayoutPreferences();
  return <>
    <button onClick={() => layout.updatePreferences({ questionSidebarWidth: 320 })}>320</button>
    <button onClick={() => layout.updatePreferences({ questionSidebarWidth: 350 })}>350</button>
    <button onClick={() => void layout.retryPersist().catch(() => undefined)}>retry</button>
    <output>{layout.persistError ?? "ok"}</output>
  </>;
}
function mount() { render(<LayoutPreferencesProvider><Controls /></LayoutPreferencesProvider>); }

it("keeps failures visible and retries the latest layout", async () => {
  save.mockRejectedValueOnce(new Error("disk full"));
  mount();
  fireEvent.click(screen.getByText("320"));
  await screen.findByText("界面布局未保存，请重试。");
  fireEvent.click(screen.getByText("350"));
  fireEvent.click(screen.getByText("retry"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ok"));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ questionSidebarWidth: 350 }));
});

it("flushes immediately on close and rejects a failed write", async () => {
  save.mockRejectedValue(new Error("disk full"));
  mount();
  fireEvent.click(screen.getByText("320"));
  await act(async () => { await expect(close()).rejects.toThrow("界面布局未保存"); });
  expect(save).toHaveBeenCalledTimes(1);
  save.mockResolvedValue(undefined);
  await act(async () => { await close(); });
  expect(screen.getByRole("status")).toHaveTextContent("ok");
});

it("serializes writes and drains changes made during an in-flight close flush", async () => {
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  mount();
  fireEvent.click(screen.getByText("320"));
  let closing!: Promise<void>;
  act(() => { closing = close(); });
  fireEvent.click(screen.getByText("350"));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await closing; });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ questionSidebarWidth: 350 }));
});

it("does not write merely because preferences were hydrated", async () => {
  mount();
  await act(async () => { await Promise.resolve(); await close(); });
  expect(save).not.toHaveBeenCalled();
});
