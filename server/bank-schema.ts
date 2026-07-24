import type {
  Bank,
  LatexSettings,
  ModuleKind,
  QuestionItem,
  StarRating
} from "../shared/types.js";

export const defaultStarRating: StarRating = 5;

export const defaultSettings: LatexSettings = {
  pageSize: "a4",
  spacing: {
    item: "1.0em",
    module: "0.45em"
  },
  preamble: `% 可在这里添加全局宏命令，例如：
% \\newcommand{\\R}{\\mathbb{R}}`
};

export const moduleKinds: ModuleKind[] = ["question", "solution", "note"];

export function createEmptyBank(): Bank {
  return {
    version: 1,
    settings: defaultSettings,
    items: []
  };
}

export function createSampleBank(): Bank {
  const now = "2026-01-01T00:00:00.000Z";
  const items: QuestionItem[] = [
    {
      id: "sample-limit",
      order: 1,
      sourceNumber: "示例 1",
      chapter: "微积分/极限",
      tags: ["极限", "等价无穷小"],
      star: 3,
      modules: {
        question: { tex: "求极限 $\\displaystyle \\lim_{x\\to 0}\\frac{\\sin x-x}{x^3}$。" },
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
      order: 2,
      sourceNumber: "示例 2",
      chapter: "线性代数/矩阵",
      tags: ["矩阵", "行列式"],
      star: 2,
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
    version: 1,
    settings: defaultSettings,
    items
  };
}
