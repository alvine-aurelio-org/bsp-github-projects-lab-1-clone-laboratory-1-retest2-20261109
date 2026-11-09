# Step 3 — Create a linked pull request

**Time: 12 minutes · Topic: browser editing, branches and linked pull requests**

## What and why

A branch isolates a proposed change; a PR lets you inspect it before merging. A closing reference links the change to the planned issue. This exercise changes **one file only**. Never edit workflows, lesson files or Mona's saved progress.

## Do

1. Open [your repository's Code tab](https://github.com/{{REPO}}). Select the branch menu showing **main**, type **workshop/release-checklist** and choose **Create branch: workshop/release-checklist from main**. Confirm that branch name appears in the menu before editing.
2. Open **work → release-checklist.md** and click the **pencil / Edit this file** button. Change only the first task to:

```markdown
- [x] Publish the service release checklist
```

Leave the second checkbox unchecked. Open **Preview changes** before committing: the only difference should be the first checkbox changing from `[ ]` to `[x]`, one removed line and one added line. Do not paste the example as an extra line or replace the whole document. Click **Commit changes…**, use message **Publish the service release checklist**, choose **Commit directly to the workshop/release-checklist branch** and confirm. Do not commit to main or edit any other file.

3. Open your repository on GitHub → **Compare & pull request**. Base: **main**; compare: **workshop/release-checklist**. Use title **Publish the service release checklist** and put this line in the description:

```text
Closes #{{ISSUE_implementation}}
```

    Create the PR, confirm its **Development** relationship points to implementation, and inspect **Files changed**: exactly one file, with only the first checkbox changed and the second still unchecked. Leave the PR **open**. Green quality checks do not replace Mona's Step 2-3 pass; do not merge until Mona posts Step 4. All actions in this step take place on the GitHub website.

![Issue Development entry point and Compare and pull request banner](../../assets/screenshots/lab-2-step-3.png)

_Use the browser's branch menu and pencil button to make the change, then open the PR. [Image attribution](https://github.com/alvine-aurelio-org/bsp-github-projects-lab-1/blob/main/assets/screenshots/SOURCES.md)._

## Ask Mona to check

In Mona's exercise issue, replace the placeholder with your actual PR number:

```text
/check 2-3 #YOUR_PR_NUMBER
```

**REPOSITORY-VERIFIED:** Mona checks author, same-repository head/base, exact branch, the native closing relationship, the only changed file and the required checked line. Never submit the sample issue number in place of the PR number. Do not change the PR's head after this passes.

**If blocked:** correct a specific failed-work message and post a fresh check. If the Mona Actions run instead says repository evidence could not be read, use **Re-run jobs → Re-run failed jobs** once. If it fails again, stop and save the run URL and exact error for the maintainer. Keep this PR open and preserve its head; do not create a replacement PR, change permissions or add an access token.
