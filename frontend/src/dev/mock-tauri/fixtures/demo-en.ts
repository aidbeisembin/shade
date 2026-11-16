// Вымышленные встречи для сценария «demo-en»: английский интерфейс и данные для
// снимков кейса портфолио (продуктовая команда, созвоны, итоги с решениями).
// Все компании, люди, продукты и цифры придуманы, совпадения случайны. Реальных
// имён и данных владельца здесь нет.
//
// Даты считаются от «сейчас», чтобы список встреч показывал все группы
// («Today», «Yesterday», «This week», «Earlier») в любой день, когда снимают кадры.

import { buildTranscript, type Line, type MockMeeting } from './types';

const folder = (id: string) => `/mock/Shade/recordings/${id}`;

/** Начало встречи: N дней назад в заданное время (локальное). */
function startedAt(daysAgo: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/**
 * Транскрипт на заданное число минут: реплик в вымышленных встречах немного, поэтому паузы
 * между ними растягиваются, чтобы длительность в списке выглядела как у настоящего созвона.
 */
function spread(id: string, start: Date, lines: Line[], minutes: number) {
  const spoken = lines.reduce((sum, [, text, sec]) => sum + (sec ?? Math.max(2.5, Math.min(14, text.length / 14))), 0);
  const gap = Math.max(1.2, (minutes * 60 - spoken - 2) / Math.max(1, lines.length - 1));
  return buildTranscript(id, start.toISOString(), lines, gap);
}

export function createDemoEnMeetings(): MockMeeting[] {
  const sync = startedAt(0, 9, 30);
  const planning = startedAt(1, 14, 0);
  const support = startedAt(1, 17, 20);
  const billing = startedAt(2, 11, 0);
  const interview = startedAt(3, 15, 30);
  const client = startedAt(4, 10, 0);
  const roadmap = startedAt(6, 13, 0);
  const retro = startedAt(9, 16, 0);

  const iso = (d: Date) => d.toISOString();
  const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000).toISOString();

  return [
    // 1. Weekly product sync: решения и задачи
    {
      id: 'demo-sync-weekly',
      title: 'Weekly product sync',
      created_at: iso(sync),
      updated_at: plusMin(sync, 34),
      folder_path: folder('demo-sync-weekly'),
      summaryLanguage: 'en',
      transcripts: spread('demo-sync-weekly', sync, [
        ['Maya Chen', 'Morning, everyone. Three things today: the onboarding numbers, the billing page, and whether we hold the March date.'],
        ['Daniel Okafor', 'Onboarding first. Completion went from 58 to 71 percent since we shortened the setup to three steps.'],
        ['Maya Chen', 'That is better than we hoped. Where do people still drop off?'],
        ['Daniel Okafor', 'Mostly on the team invite step. About a quarter of new workspaces never invite anyone.'],
        ['Priya Raman', 'In the interviews people said they were not ready to invite colleagues before they saw something useful. We could move the invite after the first summary.'],
        ['Maya Chen', 'I like that. Daniel, can you run it as an experiment for two weeks?'],
        ['Daniel Okafor', 'Yes, I will set it up behind a flag this week.'],
        ['Tom Becker', 'Billing page: design is done, engineering estimate is eight days. The risky part is tax handling for the EU.'],
        ['Maya Chen', 'Can we ship without the EU tax fields and add them in a follow-up?'],
        ['Tom Becker', 'We can. Invoices would show the net amount only for now.'],
        ['Sofia Alvarez', 'Support is fine with that if we put a note on the page. We get about five tax questions a week.'],
        ['Maya Chen', 'Then decision: billing ships without EU tax fields, with a note. March date holds if nothing else slips.'],
        ['Priya Raman', 'One more thing, I will share the interview summary by Thursday so we can plan the next round.'],
        ['Maya Chen', 'Great. Thanks, everyone, that was quick.'],
      ], 34),
      summary: {
        status: 'completed',
        templateId: 'project_sync',
        markdown: `# Weekly product sync

**Date:** ${longDate(sync)}

## Participants
- Maya Chen (product lead)
- Daniel Okafor (growth)
- Priya Raman (research)
- Tom Becker (engineering)
- Sofia Alvarez (support)

## Summary
Onboarding completion rose from 58% to 71% after the setup was cut to three steps. The team invite step is the main remaining drop-off. The billing page can ship on time if EU tax fields move to a follow-up.

## Decisions
| **Decision** | **Reason** | **Owner** |
| --- | --- | --- |
| Test moving the team invite after the first summary | A quarter of new workspaces never invite anyone | Daniel Okafor |
| Ship billing without EU tax fields, with a note on the page | Saves about two days, support gets around five tax questions a week | Tom Becker |
| Keep the March release date | Billing estimate fits if nothing else slips | Maya Chen |

## Action items
| **Task** | **Owner** | **Due** |
| --- | --- | --- |
| Set up the invite experiment behind a flag | Daniel Okafor | Friday |
| Add the note about net amounts to the billing page | Tom Becker | Next sprint |
| Share the interview summary | Priya Raman | Thursday |

## Open questions
- When do the EU tax fields get scheduled after the March release?`,
      },
    },

    // 2. Sprint planning
    {
      id: 'demo-planning-onboarding',
      title: 'Sprint planning: onboarding v2',
      created_at: iso(planning),
      updated_at: plusMin(planning, 52),
      folder_path: folder('demo-planning-onboarding'),
      summaryLanguage: 'en',
      transcripts: spread('demo-planning-onboarding', planning, [
        ['Maya Chen', 'Let us pick what goes into the sprint. Capacity is about thirty points with Liam out on Friday.'],
        ['Liam Foster', 'I would start with the empty states. They are small and they unblock design review.'],
        ['Tom Becker', 'Agreed. After that the sample workspace, that is the biggest one, thirteen points.'],
        ['Maya Chen', 'Does the sample workspace need real content or can it be static?'],
        ['Priya Raman', 'Static is fine for now. People only need to see what a finished summary looks like.'],
        ['Tom Becker', 'Then it drops to eight points.'],
        ['Sofia Alvarez', 'Please put the fix for the duplicate welcome email in. Support gets two or three complaints a day.'],
        ['Liam Foster', 'That is a small fix, three points, I can take it on Monday.'],
        ['Maya Chen', 'So: empty states, static sample workspace, welcome email fix. That is nineteen points, leaving room for bugs.'],
        ['Tom Becker', 'I would add the keyboard shortcuts for the record button, five points, if we have time left.'],
        ['Maya Chen', 'Stretch goal, then. Done, let us start.'],
      ], 52),
      summary: {
        status: 'completed',
        templateId: 'standard_meeting',
        markdown: `# Sprint planning: onboarding v2

**Date:** ${longDate(planning)}

## Participants
- Maya Chen, Tom Becker, Liam Foster, Priya Raman, Sofia Alvarez

## Sprint scope
| **Item** | **Points** | **Owner** |
| --- | --- | --- |
| Empty states for the meetings list | 3 | Liam Foster |
| Static sample workspace | 8 | Tom Becker |
| Fix for the duplicate welcome email | 3 | Liam Foster |
| Keyboard shortcuts for the record button (stretch) | 5 | Tom Becker |

## Decisions
- The sample workspace uses static content, which cuts it from 13 to 8 points.
- Committed scope is 19 points out of about 30, leaving room for bugs.

## Notes
- Liam is out on Friday, so the welcome email fix goes first on Monday.
- Support sees two or three complaints a day about the duplicate email.`,
      },
    },

    // 3. Короткий синк, итогов нет: «Transcript only»
    {
      id: 'demo-support-sync',
      title: 'Quick sync with support',
      created_at: iso(support),
      updated_at: plusMin(support, 9),
      folder_path: folder('demo-support-sync'),
      summaryLanguage: 'en',
      transcripts: spread('demo-support-sync', support, [
        ['Sofia Alvarez', 'Two things from the queue today. First, people cannot find where to change the summary language.'],
        ['Maya Chen', 'It lives under Settings, in the summary tab. We could link to it from the empty summary state.'],
        ['Sofia Alvarez', 'That would help. Second, a customer lost the microphone after updating macOS.'],
        ['Tom Becker', 'That is the permission reset after the system update. The app asks again on the next recording.'],
        ['Sofia Alvarez', 'I will add that to the help article, so I can answer in one line.'],
      ], 9),
      summary: { status: 'idle' },
    },

    // 4. Design review
    {
      id: 'demo-design-billing',
      title: 'Design review: billing page',
      created_at: iso(billing),
      updated_at: plusMin(billing, 41),
      folder_path: folder('demo-design-billing'),
      summaryLanguage: 'en',
      transcripts: spread('demo-design-billing', billing, [
        ['Priya Raman', 'I will walk through the billing page. The plan card is on the left, the invoice list on the right.'],
        ['Maya Chen', 'The upgrade button is easy to miss. Can it be the only filled button on the page?'],
        ['Priya Raman', 'Yes, I will make everything else outlined.'],
        ['Tom Becker', 'The invoice list needs pagination. Some workspaces have over a hundred invoices.'],
        ['Priya Raman', 'Ten per page with a download all button, would that work?'],
        ['Tom Becker', 'Download all is a separate job on our side. Let us leave it out of the first version.'],
        ['Liam Foster', 'On small screens the plan card pushes the invoices below the fold. Should we collapse it?'],
        ['Priya Raman', 'Good point. I will collapse it into a single line under 900 pixels.'],
        ['Maya Chen', 'Okay. Final designs by Wednesday, then hand over to Tom.'],
      ], 41),
      summary: {
        status: 'completed',
        templateId: 'standard_meeting',
        markdown: `# Design review: billing page

**Date:** ${longDate(billing)}

## Participants
- Priya Raman (design), Maya Chen, Tom Becker, Liam Foster

## Feedback
- The upgrade button should be the only filled button on the page, all others become outlined.
- The invoice list gets pagination, ten invoices per page.
- Under 900 px the plan card collapses into a single line so invoices stay above the fold.

## Decisions
| **Decision** | **Reason** |
| --- | --- |
| Leave “download all invoices” out of the first version | It is a separate job on the engineering side |
| Single filled button for the upgrade action | Easy to miss in the first mockup |

## Action items
| **Task** | **Owner** | **Due** |
| --- | --- | --- |
| Final designs with the feedback applied | Priya Raman | Wednesday |
| Hand over to engineering | Maya Chen | After the final designs |`,
      },
    },

    // 5. Интервью
    {
      id: 'demo-interview-admin',
      title: 'User interview: small-team admin',
      created_at: iso(interview),
      updated_at: plusMin(interview, 38),
      folder_path: folder('demo-interview-admin'),
      summaryLanguage: 'en',
      transcripts: spread('demo-interview-admin', interview, [
        ['Priya Raman', 'Thanks for joining. We would like to hear how your team handles meeting notes today.'],
        ['Participant', 'Honestly, one person types in a shared doc and half of it is missing by the afternoon.'],
        ['Priya Raman', 'What happens to the decisions?'],
        ['Participant', 'They live in somebody’s memory until the next meeting, when we argue about what we agreed.'],
        ['Priya Raman', 'Would you trust a tool that records the call?'],
        ['Participant', 'Only if the audio stays on my computer. Our clients would not accept a cloud upload.'],
        ['Priya Raman', 'That is exactly how it works here, everything stays local.'],
        ['Participant', 'Then I would try it. I would want to share the summary in chat with one click.'],
        ['Priya Raman', 'Noted. Last question, who would set it up for the team?'],
        ['Participant', 'Me, I am the admin. But I do not want to read a manual, it should just work.'],
      ], 38),
      summary: {
        status: 'completed',
        templateId: 'standard_meeting',
        markdown: `# User interview: small-team admin

**Date:** ${longDate(interview)}

## Participant
Admin of a small team that runs several client calls a week.

## Key findings
- Notes are typed by one person into a shared doc and are incomplete by the afternoon.
- Decisions are not written down, so they get argued about in the next meeting.
- Audio must stay on the user’s computer, because clients would not accept a cloud upload.
- Setup should not need a manual: the admin wants it to just work.

## Quotes
- “They live in somebody’s memory until the next meeting, when we argue about what we agreed.”
- “Only if the audio stays on my computer.”

## Follow-ups
| **Task** | **Owner** |
| --- | --- |
| Add one-click sharing of the summary to the backlog | Priya Raman |
| Schedule three more interviews with team admins | Priya Raman |`,
      },
    },

    // 6. Звонок с клиентом
    {
      id: 'demo-client-harbor',
      title: 'Customer call: Harbor Logistics',
      created_at: iso(client),
      updated_at: plusMin(client, 44),
      folder_path: folder('demo-client-harbor'),
      summaryLanguage: 'en',
      transcripts: spread('demo-client-harbor', client, [
        ['Maya Chen', 'Thanks for making time. We would like to hear how the pilot went for your dispatch team.'],
        ['Customer', 'Mostly good. The summaries save us about an hour a day, but our shift leads want action items split by person.'],
        ['Maya Chen', 'That is already in the summary, as a table by owner. Did it show up for you?'],
        ['Customer', 'Not on the longer calls, the table was missing.'],
        ['Tom Becker', 'That is probably a model timeout on calls over two hours. We can split long calls into parts.'],
        ['Customer', 'Please do. Also, we need a way to export to our ticketing tool.'],
        ['Maya Chen', 'Export to markdown works today. A direct integration is not planned yet, but I will take it to the roadmap review.'],
        ['Customer', 'Fair enough. If the table works on long calls, we would extend the pilot to the second depot.'],
        ['Maya Chen', 'We will fix that this month and write to you when it is ready.'],
      ], 44),
      summary: {
        status: 'completed',
        templateId: 'sales_marketing_client_call',
        markdown: `# Customer call: Harbor Logistics

**Date:** ${longDate(client)}

## Attendees
- Harbor Logistics: dispatch operations
- Maya Chen, Tom Becker (our side)

## Pilot feedback
- Summaries save about an hour a day for the dispatch team.
- Shift leads want action items split by person.
- On calls over two hours the action item table is missing.

## Customer requests
| **Request** | **Status** |
| --- | --- |
| Action items table on long calls | Fix this month, split long calls into parts |
| Export to the ticketing tool | Markdown export works, integration goes to the roadmap review |

## Next steps
| **Step** | **Owner** | **When** |
| --- | --- | --- |
| Fix summaries for calls over two hours | Tom Becker | This month |
| Write to the customer when the fix is ready | Maya Chen | After the fix |
| Raise the ticketing integration at the roadmap review | Maya Chen | Next review |

## Outcome
The customer would extend the pilot to the second depot if the table works on long calls.`,
      },
    },

    // 7. Roadmap review
    {
      id: 'demo-roadmap-q1',
      title: 'Q1 roadmap review',
      created_at: iso(roadmap),
      updated_at: plusMin(roadmap, 58),
      folder_path: folder('demo-roadmap-q1'),
      summaryLanguage: 'en',
      transcripts: spread('demo-roadmap-q1', roadmap, [
        ['Maya Chen', 'We have room for three bets this quarter. Let us rank the candidates.'],
        ['Daniel Okafor', 'Sharing summaries is the most requested thing in the interviews and in support.'],
        ['Tom Becker', 'Sharing is cheap if we only export, expensive if it needs accounts. I would start with export.'],
        ['Priya Raman', 'The second one for me is search across all meetings. People keep asking where they discussed something.'],
        ['Tom Becker', 'Search over text is mostly done already, the work is the interface.'],
        ['Sofia Alvarez', 'Third: templates for the summary. Customers want a standup format and a client call format.'],
        ['Maya Chen', 'Those exist, they just need a picker that is easier to find.'],
        ['Daniel Okafor', 'What about the team workspace? It keeps coming up.'],
        ['Maya Chen', 'It needs accounts and sync, which is a half-year project. Not this quarter.'],
        ['Maya Chen', 'So the bets are sharing by export, search across meetings, and a better template picker.'],
      ], 58),
      summary: {
        status: 'completed',
        templateId: 'project_sync',
        markdown: `# Q1 roadmap review

**Date:** ${longDate(roadmap)}

## Participants
- Maya Chen, Daniel Okafor, Tom Becker, Priya Raman, Sofia Alvarez

## Decisions
| **Bet** | **Why** | **Scope** |
| --- | --- | --- |
| Sharing summaries by export | Most requested in interviews and support | Export only, no accounts |
| Search across all meetings | People ask where they discussed something | Interface work, text search exists |
| Easier template picker | Templates exist but are hard to find | Picker redesign |

## Not this quarter
- Team workspace: needs accounts and sync, about a half-year project.

## Action items
| **Task** | **Owner** | **Due** |
| --- | --- | --- |
| Write one-page briefs for the three bets | Maya Chen | End of next week |
| Estimate the search interface | Tom Becker | Next review |`,
      },
    },

    // 8. Ретроспектива
    {
      id: 'demo-retro-42',
      title: 'Retrospective: release 4.2',
      created_at: iso(retro),
      updated_at: plusMin(retro, 47),
      folder_path: folder('demo-retro-42'),
      summaryLanguage: 'en',
      transcripts: spread('demo-retro-42', retro, [
        ['Maya Chen', 'Let us look at release 4.2. What went well?'],
        ['Liam Foster', 'The feature flags. We turned off the new export in ten minutes when it broke on one machine.'],
        ['Sofia Alvarez', 'Support had the release notes a day early, that helped a lot.'],
        ['Tom Becker', 'What did not go well: we found two bugs after the build was already signed.'],
        ['Daniel Okafor', 'And the changelog was written the night before. Half of it was vague.'],
        ['Maya Chen', 'What can we change for 4.3?'],
        ['Tom Becker', 'A short test checklist before signing, thirty minutes at most.'],
        ['Liam Foster', 'And the changelog gets written as we merge, not at the end.'],
        ['Maya Chen', 'Both accepted. Tom owns the checklist, Liam owns the changelog habit.'],
      ], 47),
      summary: {
        status: 'completed',
        templateId: 'retrospective',
        markdown: `# Retrospective: release 4.2

**Date:** ${longDate(retro)}

## What went well
- Feature flags let the team turn off the new export in ten minutes.
- Support received the release notes a day early.

## What did not go well
- Two bugs were found after the build was signed.
- The changelog was written the night before and was vague.

## Actions for 4.3
| **Action** | **Owner** | **By** |
| --- | --- | --- |
| Test checklist before signing, thirty minutes at most | Tom Becker | Before 4.3 build |
| Write the changelog while merging, not at the end | Liam Foster | Ongoing |`,
      },
    },
  ];
}
