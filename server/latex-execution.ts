import { StorageError } from "./storage-types.js";

let latexExecutionActive = false;

export async function withLatexExecutionSlot<T>(
  operation: () => Promise<T>
): Promise<T> {
  if (latexExecutionActive) {
    throw new StorageError(
      "已有 LaTeX 编译正在运行，请稍后重试。",
      "LATEX_BUSY",
      503
    );
  }
  latexExecutionActive = true;
  try {
    return await operation();
  } finally {
    latexExecutionActive = false;
  }
}
