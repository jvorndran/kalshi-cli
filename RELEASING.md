# Releasing

Releases are immutable npm packages published from a public GitHub Release. CI verifies the tag, package, installed executable, and package contents before publishing.

## One-time bootstrap for `0.1.0`

The package must exist on npm before npm trusted publishing can be configured. For the first release only:

1. Confirm the public GitHub repository is current and CI is green.
2. Enable 2FA on the npm account, run `npm login`, and confirm `npm whoami` returns `jvorndran`.
3. From a clean checkout of the release commit, run:

   ```sh
   npm ci
   npm run check
   npm run audit
   npm run release:check -- v0.1.0
   npm publish --access public
   ```

4. Upgrade to npm 11.15.0 or newer and configure the trusted publisher:

   ```sh
   npm trust github @jvorndran/kalshi-cli --file publish.yml --repo jvorndran/kalshi-cli --env npm --allow-publish
   ```

   The equivalent npm website settings are repository `jvorndran/kalshi-cli`, workflow `publish.yml`, environment `npm`, and allowed action `npm publish`.

5. In the npm package settings, require 2FA and disallow tokens. Remove any bootstrap token and run `npm logout` if local authentication is no longer needed.
6. Create the `v0.1.0` GitHub Release. The workflow recognizes that the immutable version already exists and records a successful no-op.

The initial local publish does not receive GitHub provenance. Subsequent trusted publishes do.

## Normal release

1. Update the version without creating a local tag:

   ```sh
   npm version patch --no-git-tag-version
   ```

   Use `minor`, `major`, or an explicit SemVer value when appropriate. The CLI reads its version from `package.json`, so there is no second version file to edit.

2. Run the release gates, replacing the example tag:

   ```sh
   npm ci
   npm run check
   npm run audit
   npm run release:check -- v0.1.1
   npm pack --dry-run
   ```

3. Commit and push the version change. Wait for CI and CodeQL to pass on `main`.
4. Create a draft GitHub Release for the matching `v<version>` tag, review its generated notes, and publish it.
5. The `publish.yml` workflow verifies the tag again and publishes through npm OIDC. Trusted publishing automatically adds provenance for this public package and repository.
6. Verify the registry result:

   ```sh
   npm view @jvorndran/kalshi-cli version
   npx --yes @jvorndran/kalshi-cli --version
   ```

If publishing fails, fix the trust or environment configuration and rerun the failed workflow. Never reuse a published version number.
