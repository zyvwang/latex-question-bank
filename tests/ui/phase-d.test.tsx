import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Bank, QuestionAsset } from "../../shared/types.js";
import App from "../../src/App.js";
import { bank, setFixtureBank, setupAppFixture } from "../fixtures/app-ui.js";

vi.mock("../../src/components/LatexEditor.js", () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="latex-editor" readOnly value={value} />
  )
}));

setupAppFixture();

it("opens the original question from a variant and reports a deleted original", async () => {
  const user = userEvent.setup();
  setFixtureBank(withVariant("limit"));
  const { unmount } = render(<App />);
  await screen.findByText("2024-1");

  await user.click(screen.getByText("2024-2"));
  const variant = screen.getByLabelText("变式原题");
  expect(within(variant).getByText("2024-1")).toBeInTheDocument();
  await user.click(within(variant).getByRole("button", { name: /2024-1/ }));

  expect(
    within(screen.getByRole("region", { name: "题目元数据" }))
      .getByLabelText("来源题号")
  ).toHaveValue("2024-1");
  unmount();

  setFixtureBank(withVariant("deleted-question"));
  render(<App />);
  await screen.findByText("2024-1");
  await user.click(screen.getByText("2024-2"));
  expect(screen.getByText("原题已删除")).toBeInTheDocument();
});

it("shows an attachment thumbnail row and opens the image preview", async () => {
  const user = userEvent.setup();
  setFixtureBank(withAttachment());
  render(<App />);
  await screen.findByText("2024-1");

  const row = screen.getByLabelText("题目附件");
  const thumbnail = within(row).getByRole("button", {
    name: "查看附件 截图 2026-10-26.png"
  });
  expect(thumbnail.querySelector("img")).toHaveAttribute(
    "src",
    "/assets/screenshot-demo.png"
  );

  await user.click(thumbnail);
  const dialog = screen.getByRole("dialog", { name: "截图 2026-10-26.png" });
  expect(within(dialog).getByText(/image\/png/)).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "关闭附件预览" })
  );
  expect(
    screen.queryByRole("dialog", { name: "截图 2026-10-26.png" })
  ).not.toBeInTheDocument();
});

function withVariant(originalId: string): Bank {
  return {
    ...bank,
    items: bank.items.map((item) =>
      item.id === "matrix" ? { ...item, variantOf: originalId } : item
    )
  };
}

function withAttachment(): Bank {
  const asset = screenshotAsset();
  return {
    ...bank,
    items: bank.items.map((item) =>
      item.id === "limit"
        ? {
            ...item,
            assets: [asset],
            modules: {
              ...item.modules,
              question: {
                tex: "根据截图，求极限。\n\\begin{center}\n\\includegraphics[width=0.75\\linewidth]{assets/screenshot-demo.png}\n\\end{center}"
              }
            }
          }
        : item
    )
  };
}

function screenshotAsset(): QuestionAsset {
  return {
    id: "asset-screenshot-demo",
    fileName: "screenshot-demo.png",
    originalName: "截图 2026-10-26.png",
    relativePath: "assets/screenshot-demo.png",
    mimeType: "image/png",
    size: 2048,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    sha256: "b".repeat(64)
  };
}
