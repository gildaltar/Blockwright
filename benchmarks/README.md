# Blockwright 0.6 acceptance corpus

This directory contains 100 deterministic, rights-cleared briefs created inside the Blockwright project. They are synthetic product acceptance fixtures, not customer commissions or testimonials.

- `briefs-v060.json` is the frozen input corpus.
- `results-v060.json` records the latest complete run, including the observed contract status, hash-bound certificate check, semantic-category coverage, and any non-passing hard clauses for every brief.
- `npm run benchmark:v060` regenerates both files and exits unsuccessfully if any expectation, certificate binding, or semantic audit category is missing.

The corpus deliberately includes 65 expected-valid cases and 35 expected-invalid cases. A useful fail-closed system must prove that it rejects unsupported or unsatisfied hard requirements; a benchmark made only of passing examples would not test that promise.
