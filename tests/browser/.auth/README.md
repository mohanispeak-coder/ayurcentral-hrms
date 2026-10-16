# Playwright auth storage (local only)

Save your storage state here after manual login, for example:

```bash
npx playwright codegen --save-storage=tests/browser/.auth/user.json "$HRMS_BASE_URL"
```

Set `HRMS_STORAGE_STATE=tests/browser/.auth/user.json` when running e2e tests.

**Never commit** `*.json` from this folder.
