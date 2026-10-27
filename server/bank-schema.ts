import type {
  Bank,
  BookRecord,
  LatexSettings,
  ModuleKind,
  QuestionItem
} from "../shared/types.js";

export const defaultSettings: LatexSettings = {
  pageSize: "a4",
  spacing: {
    item: "0.5em",
    module: "0.25em"
  },
  preamble: `% 可在这里添加全局宏命令，例如：
% \\newcommand{\\R}{\\mathbb{R}}`
};

export const moduleKinds: ModuleKind[] = ["question", "solution", "note"];

export function createEmptyBank(): Bank {
  return {
    version: 4,
    settings: defaultSettings,
    chapters: [],
    books: [],
    imports: [],
    items: []
  };
}

export function createSampleBank(): Bank {
  const now = "2026-01-01T00:00:00.000Z";
  const chapters = [
    { id: "chapter-calculus", name: "微积分/极限", order: 1 },
    { id: "chapter-linear-algebra", name: "线性代数/矩阵", order: 2 }
  ];
  const books: BookRecord[] = [
    {
      id: "book-sample",
      title: "示例题库",
      filePath: null,
      fileHash: null,
      answerBookPath: null,
      answerBookHash: null,
      createdAt: now,
      updatedAt: now
    }
  ];
  const items: QuestionItem[] = [
    {
      id: "sample-limit",
      source: { bookId: "book-sample", label: "示例 1" },
      chapterId: chapters[0].id,
      chapterOrder: 1,
      topics: ["极限", "等价无穷小"],
      questionTypes: ["解答"],
      reviewPriority: "recheck",
      reviewStatus: "approved",
      solutionSource: "user",
      solutionRef: null,
      variantOf: null,
      importBatchId: null,
      importedAt: null,
      modules: {
        question: {
          tex: "求极限 $\\displaystyle \\lim_{x\\to 0}\\frac{\\sin x-x}{x^3}$。"
        },
        solution: {
          tex:
            "由泰勒公式 $\\sin x=x-\\dfrac{x^3}{6}+o(x^3)$，得\n\\[\n\\lim_{x\\to 0}\\frac{\\sin x-x}{x^3}=-\\frac16.\n\\]"
        },
        note: { tex: "这个示例用于体验实时公式预览、编译检查和导出。" }
      },
      assets: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-linear-algebra",
      source: { bookId: "book-sample", label: "示例 2" },
      chapterId: chapters[1].id,
      chapterOrder: 1,
      topics: ["矩阵", "行列式"],
      questionTypes: ["填空"],
      reviewPriority: "skip",
      reviewStatus: "approved",
      solutionSource: "user",
      solutionRef: null,
      variantOf: null,
      importBatchId: null,
      importedAt: null,
      modules: {
        question: {
          tex: "设 $A=\\begin{pmatrix}1&2\\\\0&3\\end{pmatrix}$，求 $\\det A$ 与 $A$ 的特征值。"
        },
        solution: {
          tex:
            "因为 $A$ 是上三角矩阵，所以\n\\[\n\\det A=1\\cdot 3=3,\n\\]\n特征值为主对角线元素 $1,3$。"
        },
        note: { tex: "上三角矩阵的行列式和特征值都可以直接从主对角线读取。" }
      },
      assets: [],
      createdAt: now,
      updatedAt: now
    }
  ];

  return {
    version: 4,
    settings: defaultSettings,
    chapters,
    books,
    imports: [],
    items
  };
}
