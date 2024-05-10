export default async function doThisUntilResolve<T>(func: () => Promise<T>, maxTry?: number, curr?: number): Promise<T> {
  try {
    return await func()
  } catch(e) {
    console.error(e);
    curr = curr || 0;
    curr++;
    if (maxTry && (curr > maxTry)) {
      return Promise.reject("exceeding maximum trials!");
    }
    return await doThisUntilResolve(func, maxTry, curr)
  }
}
