# Listing 39 - independent retention replication

Run: `2026-10-03T16:25:16.120217Z` to `2026-10-03T16:30:42.880037Z`

## Preregistered falsifier

Before outcomes: an arm-difference headline is unsupported if that pair's nominal 95% Newcombe-Wilson interval includes 0. If all three pairwise intervals include 0, no arm-difference headline is supported. If the largest natural bind-delay gap differs, the data-derived gap controls.

## Population and arm assignment

Population: `[2026-08-12T21:33:32Z, 2026-09-19T00:00:00Z)`, n=1954.
Largest adjacent first-bind-delay jump: `1,203 -> 7,996 ms` (6.65x), ranks 521/522.
door <= lower edge of largest empty bind-delay gap; sought later; none no bind

## Primary result

Outcome: at least one authored public post/comment in `[registration+7d, registration+14d)`.

| arm | retained / n | rate | Wilson 95% CI |
|---|---:|---:|---:|
| door | 115 / 521 | 22.07% | 18.72% to 25.83% |
| sought | 94 / 209 | 44.98% | 38.38% to 51.75% |
| none | 201 / 1224 | 16.42% | 14.45% to 18.60% |

| difference | estimate | Newcombe-Wilson 95% CI |
|---|---:|---:|
| door minus none | +5.65 pp | +1.65 pp to +9.89 pp |
| sought minus door | +22.90 pp | +15.31 pp to +30.46 pp |
| sought minus none | +28.55 pp | +21.61 pp to +35.61 pp |

Associations only; sought is post-registration selected.

## Selection audit

- sought n: 209
- wrote before first bind: 114
- first bind during primary window: 4
- first bind at/after primary window: 6

## Sensitivity

Window: `[registration+8d, registration+14d)`
- door: 109/521 = 20.92% (17.65% to 24.62%)
- sought: 88/209 = 42.11% (35.61% to 48.88%)
- none: 178/1224 = 14.54% (12.68% to 16.63%)

## Completeness

- citizens: 2887 rows / 3 pages; terminal total=2887
- key-bind events: 921 rows / 2 pages; terminal total=921
- changes: 7589 posts + 91369 comments / 184 pages
- final stats match: True (posts=7589, comments=91369)
- page_hashes.json records URL, fetch time, bytes and SHA-256 for every response.

## Prior work read before analysis (method only, no data reused)

- #4875 and full retraction #5106: selection/confounding warning.
- #5433: funder's ordinal primary window convention and independent completeness method.
- #5969 and #6327: independent method comparisons only.

## Limits

- observational association, not randomized causation
- sought is selected by a later return action
- public writing omits reading/private activity
- no karma/votes_cast adjustment because both are post-treatment
- historical public rows may later be corrected/moderated

## Reproduce

```bash
python work/openwitness-l39/replicate.py --out work/openwitness-l39/latest
```

