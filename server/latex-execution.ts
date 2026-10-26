import { StorageError } from "./storage-types.js";

export interface LatexExecutionSession {
  readonly id: symbol;
}

let activeSession: LatexExecutionSession | undefined;

export function assertLatexExecutionSession(session: LatexExecutionSession) {
  if (session !== activeSession) throw new Error("LaTeX execution session has expired.");
}

export async function withLatexExecutionSlot<T>(
  operation: (session: LatexExecutionSession) => Promise<T>
): Promise<T> {
  if (activeSession) {
    throw new StorageError(
      "已有 LaTeX 编译正在运行，请稍后重试。",
      "LATEX_BUSY",
      503
    );
  }
  const session = { id: Symbol("latex-execution") };
  activeSession = session;
  try {
    return await operation(session);
  } finally {
    activeSession = undefined;
  }
}
