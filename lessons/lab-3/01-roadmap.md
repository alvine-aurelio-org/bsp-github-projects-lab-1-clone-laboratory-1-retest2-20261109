# Step 1 — Create a release roadmap

**Time: 10 minutes · Topic: date fields and roadmap planning**

## What and why

A Roadmap places the same work on a timeline using date or iteration fields. It makes timing and overlap easier to discuss. It is not a cross-Project portfolio roll-up or an automatic scheduling engine.

## Do

1. Open [your same Project]({{PROJECT_URL}}) → Backlog. Select the rightmost **+ (Add field)**, then **Add issue fields → Create a project field** (older layouts may offer **New field** directly). Create **Start date** and **Target date**, both type **Date**. Reuse an existing correctly typed field rather than duplicating it.
2. Read the actual Sprint 1 and Sprint 2 start/end dates in **… → Settings → Sprint**. Give implementation #{{ISSUE_implementation}} dates within Sprint 1 and verification #{{ISSUE_verification}} dates within Sprint 2. Ensure each start is on or before its target; do not copy screenshot dates or assume Monday starts.
3. Click **New view → Roadmap**, name it **Release roadmap**, and clear inherited filters so closed/Done implementation stays visible. Open **Dates** (shown as **Dates: Start date and Target date** after mapping; some layouts call it **Date fields**) and select the two fields you populated. Under **Markers**, show **Sprint** iteration markers. **Save** the view and confirm both timeline bars appear.

![New view entry point and the Roadmap Date fields toolbar control](../../assets/screenshots/lab-3-step-1.png)

*The screenshot highlights where to enter date mapping; it does not show your own dates. [Image attribution](https://github.com/alvine-aurelio-org/bsp-github-projects-lab-1/blob/main/assets/screenshots/SOURCES.md).*

## Expected result

Two timeline bars appear: completed implementation in Sprint 1 and planned verification in Sprint 2. If a bar is absent, check that its date cells are populated and its view filter does not hide it.

## Tell Mona

```text
/done 3-1
```

**SELF-CONFIRMED:** roadmap settings, dates and markers are not API-verified.
