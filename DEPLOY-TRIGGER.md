# Run the E2E tests when a staging deploy finishes

Merging a PR into `staging` already runs the app repo's `build_and_push.yaml`, which builds and deploys to CapRover.
Add one step at the **end** of that workflow so it tells the tests repo to run. The tests then start
right after the deploy, not up to 30 minutes later, and only once per deploy.

```
PR merged → app repo: build_and_push.yaml (staging) → deploy to CapRover
                                                     → last step: POST /dispatches
tests repo: staging-watch.yml (repository_dispatch: staging-deployed)
           → waits until staging answers fast → runs Playwright → uploads report
```

## 1. Create a token (once)

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token:

- Resource owner: the account that owns the tests repo (e.g. `Mueni-Doris`)
- Repository access: **Only select repositories** → the tests repo (`hrm-e2e-tests`, and the FMS tests repo)
- Permissions → Repository permissions → **Contents: Read and write** (required for `repository_dispatch`)
- Expiry: as your policy allows (put a reminder to rotate it)

## 2. Store it in each app repo

In `Kiotapay-org/hr-app-views`, `Kiotapay-org/hr-app` (and the FMS repos for the FMS suite):
Settings → Secrets and variables → Actions → **New repository secret**

- Name: `E2E_DISPATCH_TOKEN`
- Value: the token from step 1

(An org admin can add it once as an **organisation** secret shared by these repos instead.)

## 3. Add the trigger step to the app repo's deploy workflow

At the end of the deploy job in `.github/workflows/build_and_push.yaml`, after the CapRover deploy step:

```yaml
      - name: Trigger E2E tests
        if: success() && github.ref == 'refs/heads/staging'
        env:
          TOKEN: ${{ secrets.E2E_DISPATCH_TOKEN }}
        run: |
          curl -sSf -X POST \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/Mueni-Doris/hrm-e2e-tests/dispatches \
            -d '{"event_type":"staging-deployed","client_payload":{"repo":"${{ github.repository }}","sha":"${{ github.sha }}"}}'
```

For the FMS suite, use the same step in the FMS app repos with the FMS tests repo's URL.

## 4. In the tests repo

`staging-watch.yml` already listens for `repository_dispatch: staging-deployed`. Once the dispatch works,
delete the `schedule:` block so the 30-minute poll stops.

The workflow also:

- **waits until staging responds quickly** instead of a fixed `sleep 180` (CapRover can take longer, and
  staging is sometimes very slow; tests started too early fail with timeouts),
- uses `concurrency: staging-test-account`, so two runs never overlap. Staging allows **one session per
  account**: a second run (or you signing in locally) ends the first with "Access Terminated".

## Notes that explain past CI failures

- **Leave tests fail with "Could not apply for leave after 8 attempts (8 date conflicts)"**: test leaves
  left behind by cancelled/timed-out runs (every 30 min) filled every free weekday in the date window.
  The helper now deletes a conflicting PENDING leave when its reason contains "E2E" (real leaves are never
  touched), and waits for slow submits instead of retrying while the first request is still processing.
- **Leave tests fail with "Insufficient accrued leave balance"**: the limit is days *earned to date*
  (accrual), not the yearly allocation, so raising the allocation doesn't help straight away. The approve
  test also uses up one real day per run. Fixes: HR tops up / resets the test account's accrued balance, or
  set the leave type to grant days up front. Frequent runs can skip the approve test with
  `npx playwright test --grep-invert @consumes-balance`.
- **HRM and FMS suites use the same account**: if both tests repos run at once (both apps deployed together),
  they end each other's session. Use a separate test account per suite in CI, or run them one after the other.
- **Login changed on the auth UI (Nov 2026)**: apps are `<article>` cards with an "Open HRM in a new tab"
  link, and HRM now signs in via `/login?returnTo=/manage` (SSO). `tests/auth.setup.ts` handles both.
