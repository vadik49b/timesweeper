# Code style

- No `.then()` / `.catch()` / `.finally()` chains — use `async`/`await` with `try/catch` instead
- No wrapper functions that exist only to return another value — export and use directly
- No `void fn()` to suppress promise warnings — just call `fn()` or `await fn()`
- Keep simple logic inline; don't extract a function unless it's reused or has meaningful complexity
