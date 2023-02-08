# Reveal.Sdk

The Reveal SDK uses GitHub Issues as an official bug tracker.

[![Board Status](https://infragistics.visualstudio.com/14a7928c-44bc-4aed-b2ca-9a0ffbb14d7a/1b230d81-a651-4526-b94b-86fd3cab43e1/_apis/work/boardbadge/c5d794c3-94c4-482d-9905-b227402b4abd?columnOptions=1)](https://infragistics.visualstudio.com/14a7928c-44bc-4aed-b2ca-9a0ffbb14d7a/_boards/board/t/1b230d81-a651-4526-b94b-86fd3cab43e1/Microsoft.RequirementCategory/)

__This repository does not contain the actual source code of the SDK.__

# Issue Workflow

When working on an issue for the Reveal SDK, you need to be aware of and to follow a correct status workflow. We have created a number of status labels in order to communicate well what the current status of a single issue is. The statuses are as follows:

1. `status: new` this is the initial status of an issue. This label is placed automatically.
2. `status: in-review` this is the status once someone picks up the issue and starts looking at it. Change the status to in-review when you pick it up.
3. `status: awaiting-development` this is the status once the issue has been reviewed and is ready for development. At this point, an Azure DevOps bug should be created and linked to the issue. There is no timeline for when an issue will move to the next label of `status: in-development`
4. `status: in-development` this is the status once you start working on an issue. Assign the issue to yourself if it hasn't been assigned already and remove the previous status and assign it an in development status.
5. `status: by-design` this is the status of an issue that has been reviewed and has been determined that the current design of the feature is such that the issue describes the correct behavior as incorrect. Remove other statuses and place this status if you've reviewed the issue.
6. `status: not-to-fix` this is the status of issues that derive from our code, but have been decided to leave as is. This is done when fixes require general design and/or architecture changes and are very risky.
7. `status: resolved` this is the status of an issue that has been fixed and there are active pull requests related to it.

Example status workflows:

`status: new` => `status: in-review` => `status: awaiting-development` => `status: in-development` => `status: resolved` (Issue can be closed)

`status: new` => `status: in-review` => `status: by-design` (Issue can be closed)

`status: new` => `status: in-review` => `status: not-to-fix` (Issue can be closed)