# Public release boundaries

> **Product direction note**: The Markdown knowledge base (Vault) modules are
> **not in scope and not exposed to users**. Overview, graph, wiki, materials,
> books, topics, the document reader, and full-text search are hidden;
> daily hot, social insights, and Douyin analytics remain available. The work
> management mainline (Today / tasks / reports / DingTalk / Outlook) is the
> product focus.

## What is reusable

The reusable product is the application shell, local sync and indexer, data contracts, and configuration mechanism.

## What is not transferable

- Personal Markdown, notes, cases, judgments, account exports, comments, messages, and analytics history
- Cookies, tokens, session parameters, browser profiles, local app state, or absolute home-directory paths
- Private Skill prompts and machine-specific executable paths
- Internal content strategies, client names, product plans, unpublished work, and operational archives
- Screenshots or test fixtures captured from a real Vault

## Demo-data rule

Demo records are authored from scratch. They use clearly fictional names, ids, dates, URLs, and metrics. Do not anonymize a real row by changing only its title or id; aggregation patterns and time series can still identify a source account.

## Public feature decisions

| Module | Public status | Reason |
|---|---|---|
| Today / tasks / weekly focus / reports | Included | Core work-management mainline |
| Meetings / DingTalk calendar | Included | Work-management data source |
| Daily report & team reports | Included | Team collaboration mainline |
| Outlook integration | Included | Mail workflow + AI classification |
| Daily Hot | Included with editable neutral defaults | Uses an anonymous public source |
| Social insights | Included, read-only | Reports remain local and user-owned |
| Douyin analytics | Included with schema and synthetic demo | Users must supply their own authorized export |
| Overview / Wiki / Graph | Hidden | Knowledge base is out of scope for now |
| Raw / reader / books / materials | Hidden | Knowledge base is out of scope for now |
| Topics and content | Hidden | Knowledge base is out of scope for now |
| Brainstorm | Hidden | Depends on a private runtime Skill and writeback policy |
| Run archive | Hidden | Commonly contains internal strategy and audit history |
| WeChat Official Account | Hidden | Depends on account-specific data and operating boundaries |

Hidden here means more than removing navigation. The public indexer skips
`Brainstorm/`, `90_runs/`, and `30_self_media/public-account/`; the related
Brainstorm and public-account Dashboard API routes return
`FEATURE_NOT_INCLUDED`. For the knowledge base modules hidden by product
direction (Overview / Wiki / Graph / Raw / reader / books / materials /
Topics), navigation entries are removed and the pages are not exposed to
users; the underlying indexer and contracts remain only as reusable
capability for the social-insights and Douyin data sources.

## Release checklist

- [ ] Owner selects and approves a software license.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run privacy:scan` passes.
- [ ] A fresh clone keeps synthetic knowledge content only in the repository-level `个人知识库/` folder.
- [ ] A second, unrelated Vault can be selected with `PERSONAL_DASHBOARD_VAULT_ROOT`.
- [ ] No screenshot, fixture, source map, build output, or Git history contains personal data.
- [ ] All demo analytics surfaces visibly say they are synthetic.
