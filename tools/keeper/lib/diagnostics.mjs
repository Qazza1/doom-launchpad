export function safeErrorClass(error) {
  const classes = [];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const name = typeof current.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(current.name)
      ? current.name
      : null;
    const code = typeof current.code === "string" && /^[A-Z0-9_-]{1,40}$/.test(current.code)
      ? current.code
      : null;
    if (name) classes.push(name);
    if (code) classes.push(code);
    current = current.cause;
  }
  return [...new Set(classes)].join("/") || "UnknownError";
}
