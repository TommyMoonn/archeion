export function measurePerformance<T>(name: string, task: () => T): T {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return task();
  }

  const start = `${name}:start`;
  const end = `${name}:end`;
  performance.mark(start);
  try {
    return task();
  } finally {
    performance.mark(end);
    performance.clearMeasures(name);
    performance.measure(name, start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
}
