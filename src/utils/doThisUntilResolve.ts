export default async function doThisUntilResolve<T>(func: () => Promise<T>, maxTry?: number, curr?: number, breakCondition?: (e: any) => boolean): Promise<T> {
  try {
    return await func()
  } catch(e) {
    console.error(e);
    curr = curr || 0;
    curr++;
    if (maxTry && (curr > maxTry)) {
      return Promise.reject("exceeding maximum trials!");
    }
    if (breakCondition && breakCondition(e)) {
      return Promise.reject(e);
    }
    return await doThisUntilResolve(func, maxTry, curr, breakCondition)
  }
}

