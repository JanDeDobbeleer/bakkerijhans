# Bakkerij Hans

Static website for bakkerijhans.be. No build step is required.

## Deployment

The [deployment workflow](.github/workflows/deploy.yml) uploads the site over
explicit FTPS after every push to `main`. You can also run **Deploy website**
manually from the **Actions** tab with `main` selected.

In the GitHub repository, open **Settings > Secrets and variables > Actions**
and add these repository secrets:

- `FTP_SERVER`: the FTP hostname, without a protocol prefix.
- `FTP_USERNAME`: the FTP account username.
- `FTP_PASSWORD`: the FTP account password.
- `FTP_SERVER_DIR`: the website directory as seen by this FTP account, ending
  with `/`, such as `/public_html/`. For accounts that open directly in the
  website directory, use `./`.

Use the hostname, account, port, and remote directory from your working FileZilla
connection. If the port differs from `21`, add a repository variable named
`FTP_PORT` under the **Variables** tab.

The server must support explicit FTP over TLS. The workflow uses `security: loose`
to allow the provider's FTP hostname when its certificate names the shared
hosting server instead. Transfers remain encrypted, but certificate verification
is disabled, so an attacker impersonating the server could obtain FTP credentials
and website files. Prefer `security: strict` when the provider supplies a
certificate matching `FTP_SERVER`. Use an FTP account restricted to the website
directory.

The upload contains `index.html`, `banner.json`, `llms.txt`, `llms-full.txt`,
`robots.txt`, `sitemap.xml`, and `assets/`. Git metadata, workflow files, and this
README stay out of the upload. Add any new public root files to the workflow's
**Prepare public files** step.

The first deployment uploads all public files. Later deployments transfer
changes and delete files removed since the previous deployment. Files on the
server that the action has never tracked remain untouched. Keep the generated
`.ftp-deploy-sync-state.json` file on the server so the action can track changes.

Deployments run one at a time without cancelling an active upload. Keep using
GitHub for site updates after enabling deployment; a later deployment can
overwrite manual changes made through FileZilla.
