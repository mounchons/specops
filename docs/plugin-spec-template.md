# <plugin> — one-page spec (constitution rule 2)

> Fill this before building. Delete it when the plugin ships; the commands and `checks.mjs` are then the spec.
> Names are proposals. Inputs, outputs and DoD are not.

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| e.g. `REQ` `BR@v` `NFR` | `req/<module>/*.json` | yes |

## Writes (outputs — only under `.sdlc/<plugin>/` and `trace.<plugin>.json`)
| id kinds minted | file | notes |
|---|---|---|

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `<question>`. It must be answered from `/core:query` and `/core:next`, never from memory.
