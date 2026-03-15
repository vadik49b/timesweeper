# TimeSweeper Pricing Research

Last updated: March 15, 2026

## Context

This research was done to answer a specific pricing question for TimeSweeper:

- The product should stay no-account.
- The product should stay trust-based.
- The question is whether to monetize participant count, and if so, where to set the free limit and what price to charge.

The current product positioning in the app and README is consistent:

- no login
- no tracking
- local-first
- one shared event link

That matters because aggressive gating will conflict with the core product promise.

## Main Takeaways

1. People will pay for scheduling tools, but mostly when the tool is clearly better, not when payment just removes friction added by the product itself.
2. Real scheduling groups often land in the 10-16 participant range, so a free cap of 10 is not a niche threshold.
3. For a trust-based, no-account product, a one-time per-event payment fits better than subscriptions.
4. If TimeSweeper launches with a 10-person free cap, the safest paid unlock price is about $3 per premium event.
5. The lower-risk move is to launch fully free first, measure actual event sizes, and then decide whether a participant cap is justified.

## Comparable Services

### Kittysplit

Kittysplit is the closest business-model analogue because it is lightweight, trust-based, and does not force a full account workflow for the core use case.

- Kittysplit introduced a paid "Super Kitty" upgrade.
- One of the premium triggers is more than 10 people.
- The price is 3 EUR per kitty.

Source:

- [Kittysplit premium features](https://blog.kittysplit.com/kittysplit-premium-features/)

Why it matters:

- This is strong evidence that a trust-based product can monetize a simple threshold without moving to subscriptions.
- It also provides a useful pricing anchor: charging much more than Kittysplit for "10+" is likely to feel expensive unless TimeSweeper bundles more value.

### Rallly

Rallly is relevant because it is a modern no-login scheduling poll tool.

- Rallly keeps free usage broad.
- Paid plans are more about retention and premium workflow than a strict participant gate.
- The FAQ says there is no participant limit on the free plan.

Sources:

- [Rallly pricing](https://rallly.co/pricing)
- [Rallly FAQ](https://support.rallly.co/faq)

Why it matters:

- A no-login scheduling product does not need to monetize via a hard participant cap.
- The market expectation is that the core scheduling flow remains usable for free.

### PollUnit

PollUnit is a useful pricing reference for participant caps.

- PollUnit free allows up to 40 participants per poll.
- Paid plans start at relatively low monthly pricing.

Source:

- [PollUnit pricing](https://pollunit.com/en/accounts)

Why it matters:

- A 10-person free cap would be much more restrictive than at least some competing poll tools.
- If TimeSweeper enforces a lower cap, the price should stay low enough that it feels like a lightweight trust-based unlock, not SaaS rent.

### Doodle

Doodle is relevant as a negative example.

- Doodle sells premium features such as hidden polls, deadlines, reminders, branding, and no ads.
- User sentiment around Doodle often centers on it becoming annoying, constrained, or worse over time.

Sources:

- [Doodle pricing](https://doodle.com/en/solutions/professional-services/agency/)
- [Doodle help: poll size limits](https://help.doodle.com/en/articles/9457330-what-is-the-maximum-group-poll-size)
- [Doodle help: premium poll options](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden)

Why it matters:

- People do pay for scheduling software.
- They are much less happy to pay when the free experience feels intentionally degraded.

## Anecdotal Signals

These anecdotes are useful because they show real usage patterns and user expectations.

### Users will pay for a better alternative, not for punishment

A longtime Doodle user on Reddit said they would happily pay for a decent alternative because Doodle had become frustrating, and the paid upgrade still did not feel good.

Source:

- [Reddit: Doodle alternative discussion](https://www.reddit.com/r/software/comments/zeq0u2)

Interpretation:

- This is willingness-to-pay.
- It is not evidence that users want a hard paywall on basic group sizes.
- It supports monetizing quality and convenience, not monetizing relief from artificial restrictions.

### Real scheduling groups frequently exceed 10

In discussion around a Doodle alternative, users described use cases including:

- a management team of 16 people
- a 100+ member student organization with a smaller management group
- groups of 10-15 people
- volunteer scheduling

Source:

- [Reddit: open source Doodle alternative discussion](https://www.reddit.com/r/opensource/comments/1klu471/i_made_a_doodle_alternative/)

Interpretation:

- 10 is not an edge-case threshold in scheduling.
- A hard free cap at 10 will hit normal use cases early.

### Users value no-signup and dislike paywalling the core

The same discussion included feedback along the lines of:

- people will actually use it if there is no signup
- do not paywall it

Source:

- [Reddit: open source Doodle alternative discussion](https://www.reddit.com/r/opensource/comments/1klu471/i_made_a_doodle_alternative/)

Interpretation:

- TimeSweeper's no-account model is part of its value.
- Monetization should preserve the "just use it" feel as long as possible.

## Implications for TimeSweeper

### If the app stays no-account and trust-based

The cleanest monetization model is:

- free basic event
- one-time premium event upgrade

This is a better fit than subscriptions because:

- there is no identity system
- many users will create occasional events, not recurring business workflows
- charging per event feels consistent with the product's simplicity

### What not to do

Avoid charging purely for moving from 10 to 11 participants unless the price is very low.

Why:

- 10-16 participants is already common in scheduling use cases
- users will perceive the cap as hitting too early
- that risks making the product feel artificially constrained

### If a 10-person free limit is used

Recommended price:

- $3 per premium event

Why $3:

- it is close to Kittysplit's 3 EUR trust-based upgrade anchor
- it is low enough to feel like a lightweight unlock
- it is less likely to trigger the "why am I paying for one more person?" reaction

What can justify more than $3:

- reminders
- auto-close deadline
- export improvements
- branding removal
- premium retention

If the paid event unlock includes those extras, $5 becomes more defensible.

## Recommendation

### Best product decision

Launch free first and gather real usage data before introducing a participant cap.

Reason:

- Right now the pricing decision is still based mostly on analogies and anecdotes.
- TimeSweeper should measure whether the actual successful-event distribution clusters below 10, around 11-16, or higher.

### Suggested beta approach

Run the product fully free for 4-8 weeks, or until there is enough data to make a confident call.

Suggested target:

- 200-500 created events
- 50-100 confirmed events

Track event-level metrics only:

- participant count at creation
- final participant count
- whether the event was confirmed
- time to confirmation
- share/copy usage
- ICS download usage

Suggested participant buckets:

- 1-4
- 5-10
- 11-15
- 16-20
- 21+

Decision rule:

- If fewer than 10-15% of confirmed events exceed 10 participants, do not monetize the cap yet.
- If 20% or more of confirmed events exceed 10 participants, a paid unlock becomes more reasonable.
- If successful events cluster around 11-16 participants, a 10-person free limit is probably too low.

### Soft-test option

If product validation is needed before charging, add a notice when an event exceeds 10 participants:

"Events over 10 participants may become a $3 premium event after beta."

This keeps the current experience free while testing:

- how often the threshold is crossed
- whether users object to the idea
- whether the threshold matches real demand

## Final Recommendation Summary

Current recommendation order:

1. Run TimeSweeper free first and collect real participant-size distribution data.
2. If a paid threshold is later needed, prefer one-time premium events over subscriptions.
3. If the free cap is set to 10, price the unlock at $3 per premium event.
4. If the price is $5, include extra value beyond just "more than 10 participants."
5. If the data shows many successful events in the 11-16 range, consider a 15 or 20 person free limit instead.
