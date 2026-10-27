import { useRef } from "react";

type AnyFunction = (...args: never[]) => unknown;

/**
 * 组装 context 值：函数字段换成引用稳定、始终调用最新实现的代理；
 * 只有非函数字段（按 Object.is）变化时才返回新对象。
 * 这样消费者不会因为 action 闭包更新而重渲染，也不用手写 useMemo 依赖数组。
 * 字段集合在同一调用点必须固定。
 */
export function useStableSlice<T extends object>(value: T): T {
  const latestRef = useRef(value);
  latestRef.current = value;
  const proxiesRef = useRef(new Map<string, AnyFunction>());
  const sliceRef = useRef<T | null>(null);

  const previous = sliceRef.current;
  if (previous && hasSameData(previous, value)) return previous;

  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== "function") {
      next[key] = field;
      continue;
    }
    let proxy = proxiesRef.current.get(key);
    if (!proxy) {
      proxy = (...args) =>
        ((latestRef.current as Record<string, unknown>)[key] as AnyFunction)(...args);
      proxiesRef.current.set(key, proxy);
    }
    next[key] = proxy;
  }
  sliceRef.current = next as T;
  return next as T;
}

function hasSameData(previous: object, value: object): boolean {
  const before = previous as Record<string, unknown>;
  const after = Object.entries(value);
  if (after.length !== Object.keys(before).length) return false;
  return after.every(([key, field]) =>
    typeof field === "function"
      ? typeof before[key] === "function"
      : Object.is(before[key], field)
  );
}
