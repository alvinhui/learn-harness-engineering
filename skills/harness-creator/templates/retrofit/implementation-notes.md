# Implementation Notes

> Detailed notes on non-obvious algorithms, invariants, and empirical
> thresholds. This is where the "why it works this way" lives so agents do not
> re-derive (and break) subtle logic. Only document what is NOT obvious from
> reading the code.

## Key Algorithms

{{KEY_ALGORITHMS}}

## Invariants

Conditions that must always hold; violating them is a bug even if tests pass:

{{INVARIANTS}}

## Empirical Thresholds / Magic Numbers

Values tuned from real data — do not change without spec and evidence:

{{THRESHOLDS}}

## Known Edge Cases

{{EDGE_CASES}}
