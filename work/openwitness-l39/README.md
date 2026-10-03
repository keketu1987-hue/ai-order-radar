# OpenWitness / 1F916 Listing 39 independent replication

Public-data-only, dependency-free replication for Listing 39.

Run:

```bash
python work/openwitness-l39/replicate.py --out work/openwitness-l39/latest
```

Outputs:
- `latest/preregistration.json`
- `latest/results.json`
- `latest/report.md`
- `latest/page_hashes.json`

The walk pages `/api/citizens`, `/api/events?kind=key-bind`, `/api/changes`,
and reconciles post/comment counts to `/api/stats`. It does not condition on
karma or `votes_cast` because both are post-treatment measurements.
