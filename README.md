![revealbi-github](https://user-images.githubusercontent.com/835562/224768071-b6440186-e8ad-460c-9ce0-84f065311ee7.svg)

<h1 align="center">
  The Official Bug Tracker for the Reveal SDK 
</h1>

[![Board Status](https://infragistics.visualstudio.com/14a7928c-44bc-4aed-b2ca-9a0ffbb14d7a/1b230d81-a651-4526-b94b-86fd3cab43e1/_apis/work/boardbadge/c5d794c3-94c4-482d-9905-b227402b4abd)](https://infragistics.visualstudio.com/14a7928c-44bc-4aed-b2ca-9a0ffbb14d7a/_boards/board/t/1b230d81-a651-4526-b94b-86fd3cab43e1/Microsoft.RequirementCategory/)

Reveal Embedded Analytics enables your teams and customers to drive data insights with embedded intelligence, accelerate time to market, and transform the user experience of your apps. Built with embedding in mind first, on today’s most modern architecture, Reveal’s powerful API removes the complexity of embedding analytics into your applications. Reveal’s native SDKs make integrating into your application seamless on any platform and tech stack, including .NET Core, Java, NodeJS (coming soon), and front-end technologies such as React, Angular, WebComponent, VueJS, jQuery, MVC, and Java Frameworks like Spring, Tomcat, and Apache. 

With intuitive drag-and-drop functionality, creating beautiful and informative dashboards on any device is simple. Quickly run predictive analysis and machine learning models with just a few clicks to make more educated business decisions. Reveal embed keeps your teams focused on your app's core value and lights up your user experience - with a simple, fixed price. 

_This repository does not contain the actual source code of the Reveal SDK._

### Feedback
 - [Report a Bug](https://github.com/RevealBi/Reveal.Sdk/issues/new?assignees=&labels=%3Abug%3A+bug%2C%3Aheavy_plus_sign%3A+status%3A+new&template=bug_report.yml&title=%5BBUG%5D%3A+)
 - Request a new [new feature](https://github.com/RevealBi/Reveal.Sdk/issues/new?assignees=&labels=%3Atoolbox%3A+feature-request&template=feature_request.md&title=)
 - Upvote [popular feature requests](https://github.com/RevealBi/Reveal.Sdk/issues?q=is%3Aissue+is%3Aopen+label%3A%22%3Atoolbox%3A+feature-request%22)
 - Ask a question by starting [a discussion](https://github.com/RevealBi/Reveal.Sdk/discussions)
 - Reach out to us through Discord. Contact your sales representative for an invite link.

## Issue Workflow

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
