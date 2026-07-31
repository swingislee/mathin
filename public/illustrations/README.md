# Public scene illustration manifest

> Updated: 2026-07-31
>
> Release status: implementation complete; final visual sign-off by the repository owner is pending.

The `*-day.webp` files are web delivery derivatives of the pre-existing project PNG assets. They preserve the source composition and inherit the source asset's project usage status. The `*-night.webp` files are original lighting/atmosphere edits generated with the built-in OpenAI ImageGen workflow at the user's request, using the matching daytime project asset as the edit target.

Authoring credit for the night variants: OpenAI ImageGen, directed by Codex and the Mathin repository owner. Usage status: project-owned generated derivatives under the applicable OpenAI service terms; do not publish outside Mathin before the owner's visual sign-off. No asset contains embedded UI text.

## Prompt set

- Story: preserve the fox journey composition and watercolor-pencil texture; change only the time of day to a calm indigo starry night, with moonlit hills and warm lantern, star bottle, and path lights.
- Games: preserve the symmetrical royal hall; reveal a restrained starry indigo sky through the arches, with cool moonlit stone and warm burgundy/gold accents.
- Minds: preserve the lamplighter and large right-side UI safe area; make the lamp the restrained warm focal light in a deep, low-saturation star field.
- Tools: preserve the top-down workbench geometry; turn it into a dark walnut and charcoal-indigo ledger workspace with subtle stars and antique brass highlights.

All prompts explicitly prohibited text, logos, watermarks, photorealism, neon color, new characters, and composition changes.

## Delivery hashes

Hashes are SHA-256 over the binary WebP files.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `games-royal-hall-day.webp` | 105842 | `c9556cc9fa7d18a094cca381945c3b7a648d6886269f39afb95875f26e2f5f1d` |
| `games-royal-hall-night.webp` | 181116 | `bedc5096f7b11bccc5adcc880b8eeddf0c678a8e44c470ff8eb8790c673cfa1c` |
| `minds-lamplighter-day.webp` | 62748 | `2632c70b65fa6043e08c58fa895b951c4b410254c8c4e419d64379deece778c5` |
| `minds-lamplighter-night.webp` | 102326 | `99efda8736efd4f31a7af5ea275769088c38f3e8325aed7e4733a6738d84590e` |
| `story-journey-day.webp` | 130020 | `13a6d2b23513db1c0efc5a3d718b731b37bb3de9229b9c8e96657211abf7dd58` |
| `story-journey-night.webp` | 202156 | `0429c9e3957d46d5da2ceac23515cb369b02a8384468b8a9cae622c3f901ccdc` |
| `tools-workbench-day.webp` | 139730 | `7f97ed24b7b964e73d0d596a683886a8d4da0cceddc1c9365f5683a8e1fde49f` |
| `tools-workbench-night.webp` | 145474 | `ec7bacec80e9da9da1f029ace3a1b0b4692bb88a85c941499d5e8b63beb01e9e` |
