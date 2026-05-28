---
name: security-review
description: Review pending changes for security issues (secrets, injections, SSRF, auth).
---

# security-review

Specialized review focusing on security regressions. Goes deeper than
`code-review` on these specific dimensions; ignores style/perf.

## When to invoke

- User says "security review", "look for vulnerabilities", "before deploy".
- Touched code is in: auth, sessions, file paths, HTTP fetches, subprocess
  exec, deserialization, template rendering, secrets handling.
- New external input enters the system (form fields, URL params, headers,
  webhook payloads, file uploads).

## Categories to check

### Secrets

- Hard-coded API keys / DB passwords / signing keys in source.
- Secret logged to stdout/stderr / written to disk un-redacted.
- Secret committed to git history (search with `git log -p -S '<prefix>'`).
- Environment variable leaked into a subprocess that doesn't need it.

### Injection

- **Shell**: `Bash` with user-controlled string concatenation — use argv
  arrays. Look for `\`${userInput}\`` in commands.
- **SQL**: parametrized? Or string concat into a query?
- **NoSQL**: `$where` / `$expr` / similar with user input.
- **Template**: SSTI in Jinja/EJS/Handlebars from user input.
- **LDAP / XPath / regex**: user input embedded into a query without escape.

### Path traversal

- File operations that join user input into a path — `path.join(uploadDir, userFileName)`
  is exploitable if `userFileName = '../../etc/passwd'`. Resolve + verify
  the result still starts with the expected prefix.

### SSRF

- `fetch(userUrl)` without an allowlist or denylist for internal addresses
  (169.254.169.254, 127.0.0.1, link-local IPv6).
- Image fetch / preview generation from user URLs (especially!).
- `redirect: 'follow'` lets an attacker hop from a benign host to internal.

### Auth / authz

- Missing auth check on a new endpoint.
- Authorization via user-supplied ID without ownership verification.
- Session fixation: session ID not rotated after login.
- JWT: `alg: none` accepted, or wrong key used for verification.
- CSRF: state-changing GET, or missing token check.

### Crypto

- `Math.random()` for tokens — use `crypto.randomBytes`.
- Custom encryption — flag for review by a domain expert.
- Comparing secrets with `===` (timing attack) — use `crypto.timingSafeEqual`.

### Deserialization

- `JSON.parse` of untrusted input → mostly fine, but watch for prototype
  pollution (`__proto__`, `constructor.prototype`).
- `eval` / `Function()` / `vm.runInThisContext` with user input — never.
- `yaml.load` (not `safeLoad`), `pickle.loads`, `unserialize` — all dangerous.

## Reporting

Same shape as `code-review` but tag each finding with severity:

```
N findings:

  · HIGH  src/api/users.ts:42  — Missing authz check; any logged-in user
       can read any other user's data. Add `requireOwner(req, user.id)`.
  · MEDIUM  src/upload.ts:88  — Path-traversal: user-controlled filename
       joined to dir without resolve+prefix check.
  · LOW  src/util/random.ts:12  — Math.random for session token. Use
       crypto.randomBytes(32).toString('hex').

Severity guide: HIGH = exploitable today; MEDIUM = exploitable with
  attacker effort; LOW = defense-in-depth gap.
```
