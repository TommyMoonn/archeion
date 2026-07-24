let measurementSequence = 0;

function createBoundaryNames(name: string): { end: string; start: string } {
  const sequence = measurementSequence;
  measurementSequence += 1;
  return {
    start: `${name}:${sequence}:start`,
    end: `${name}:${sequence}:end`,
  };
}

export function measurePerformance<T>(name: string, task: () => T): T {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return task();
  }

  const { end, start } = createBoundaryNames(name);
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

export async function measurePerformanceAsync<T>(name: string, task: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return task();
  }

  const { end, start } = createBoundaryNames(name);
  performance.mark(start);
  try {
    return await task();
  } finally {
    performance.mark(end);
    performance.clearMeasures(name);
    performance.measure(name, start, end);
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
}

export function markPerformance(name: string): void {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return;
  }

  performance.clearMarks(name);
  performance.mark(name);
}
