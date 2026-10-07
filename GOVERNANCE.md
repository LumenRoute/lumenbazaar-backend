# Repository Governance

Changes to `main` use a pull request with the `checks` CI job, one approving review, resolved
conversations, and code-owner review for owned paths. Stale approvals are dismissed when the head
changes. Administrators follow the same rule during ordinary work.

Releases use annotated or signed tags and a GitHub release that records the source commit, migration
state, OpenAPI checksum, service image digest, environment, capability flags, and changelog. A tag or
passing CI run alone does not prove a deployment or paid flow.

An emergency exception is limited to an actively exploitable security issue or service/funds safety
incident. The maintainer records the reason and UTC time, uses the smallest change, runs all feasible
checks, restores protection immediately, and opens a retrospective pull request within one business
day. The exception never permits committing signing keys, credentials, or private payment payloads.
