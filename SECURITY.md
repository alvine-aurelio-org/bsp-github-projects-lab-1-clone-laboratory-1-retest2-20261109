# Security and privacy

- Use one private learner repository and one private Project; do not invite other attendees.
- The three published source repositories never initialize learner data. Only a private learner copy can start Mona. The full-workshop path stays in Lab 1; optional standalone copies of Lab 2 or 3 each start one issue through a commit-pinned reusable workflow.
- V2 bootstrap creates **one** exercise issue and no sample work issues. Work items are learner-created at Step 1-1; `/backlog` binds their immutable native IDs without editing them. All instructional content remains in the same exercise comments.
- Participants submit their Project URL directly. Internal normalization removes view/query/fragment decoration but does not fetch the Project or verify its privacy/access. All work is browser-based; no local tooling or extra credential is requested.
- Automation uses repository-scoped `GITHUB_TOKEN` with contents read, Issues write and PR read. It never uses the Projects API, an extra PAT, an App key or a cloud credential.
- Never paste secrets into a command comment or a laboratory file. Git authentication remains in your normal credential manager/browser.
- Comment text is parsed as data using an exact allowlist. It is never executed as shell code. Repository evidence is read only from the bound repository; GraphQL is used for PR issue links, not Projects.
- Official Actions are pinned to full commit SHAs; checkout does not persist credentials. The privileged Mona job reads default-branch code, never checks out or executes a PR branch or learner dependency.
- Mona accepts only new commands from the bound learner on the bot-created exercise issue. Bot state is not a security boundary against a malicious repository owner: an owner controls their own copy. Do not treat this workshop as an examination or compliance attestation.
- API failures, incomplete pagination, corrupted progress or mismatched identities stop checks. They are never converted into a pass.
- Unknown or legacy workshop markers fail closed before bootstrap writes. V1 copies are not silently migrated, reset or reseeded; obtain an explicit owner-reviewed migration or use a fresh copy. This release does not provide an automatic migration command.
- The private repository's settings, inherited access, entitlements and organization policy remain the owner's responsibility. No claim is made that a private Project hides content from authorized organization owners.
- Exported TSV files and account screenshots stay local. The course contains synthetic data only.

Report a problem privately to the repository owner via the contact listed on the organization profile. Do not publish a real credential in a public issue. If a credential was exposed, revoke it using its issuer's supported process.
