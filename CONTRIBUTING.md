# Contributing

Intoponet is a project to change how people understand the world. It is free,
it is open, and it is maintained by one person, so replies can take a while.

## Before you start

- For anything larger than a small fix, open an issue first and say what you
  want to change and why.
- Security problems go to the address in [SECURITY.md](SECURITY.md), not to
  the issue tracker.

## Your contribution's licence

By contributing you agree that your contribution is under the Mozilla Public
License 2.0, the same as the rest of Intoponet's own code, and that you have
the right to contribute it.

## Rules that are not negotiable

1. **Nothing copied from filter lists.** The ad and tracker list
   (`packages/protection-engine/data/`) holds only hosts found by Intoponet's
   own measurement or written from knowledge of what a service does, each with
   its evidence. A rule taken from EasyList, EasyPrivacy, a tracker database or
   any other list will not be merged. To propose a host, say what you saw it do
   on which page. The method is in `docs/protection-measurement.md` and the
   history in `docs/protection-provenance.md`.
2. **No new outside code or data without its licence.** Say where anything you
   did not write comes from and what its licence is. It must be compatible
   with MPL-2.0 and it must be added to `THIRD_PARTY_NOTICES.md`.
3. **Privacy claims are tested.** Anything that makes the app contact a server
   has to be visible to the person using it and described in the privacy text.
   The app does not send what people read, save or type to Intoponet.
4. **Publishers come first.** The app links to the publisher's own page. It
   does not re-host articles, strip attribution or get around a publisher's
   access controls.

## Checks

```sh
npm install
npm run typecheck
npm test
npm run build
```

The end-to-end checks (`npm run verify:features`) drive the built app on
macOS, bring windows to the front and take the keyboard while they run.
