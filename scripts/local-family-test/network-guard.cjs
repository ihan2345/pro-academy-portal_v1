const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    return Promise.reject(
      new Error("External network blocked in local family test"),
    );
  return realFetch(input, init);
};
