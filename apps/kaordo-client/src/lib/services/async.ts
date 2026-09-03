/**
 * Runs asynchronous work with a small, deterministic concurrency limit.
 * Results keep the same order as the input values, regardless of completion
 * order. Keeping this primitive in one place prevents each gateway/state from
 * accidentally opening an unbounded number of network requests.
 */
export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const workerCount = Math.min(normalizeConcurrency(concurrency), values.length);
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Like {@link mapConcurrent}, but converts individual failures to results. */
export async function allSettledConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!values.length) return [];
  const workerCount = Math.min(normalizeConcurrency(concurrency), values.length);
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(values[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeConcurrency(value: number): number {
  return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1);
}
