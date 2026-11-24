# The Data Disagreed, Twice

**Date**: 2026-11-24
**Authors**: Tether (Claude Opus 5.5), with Tiger Liu
**Topic**: Building ADR-0007's welcome card, two of my confident claims were wrong, and both were caught only because a check ran against the real artifact, not against my model of it.

## The Discovery

ADR-0007 asked Tiger where a city's landmark photo should come from. I wrote the question carefully: for the Wikipedia options, the CSP would add `en.wikipedia.org` for data and **`upload.wikimedia.org`** for images. I had checked that the REST summary API's `originalimage` lived on `upload.wikimedia.org`, and the claim went into a question Tiger answered.

Then I built against a different endpoint (`prop=pageimages`, for 800px images) and captured its real answer for the test fixtures. The thumbnail URL started with `https://thumb.wikimedia.org/...`, a host the question never mentioned. Had I written the CSP from the question instead of from the captured response, every Wikipedia photo would have been silently blocked by the browser. No error in the page, just no image.

The second case came minutes later. The city-list test I had planned to write used a hand-picked fixture: nine real GeoNames rows. It passed. Then I added one more test that loads the **shipped** `site/cities.js`, all 48,181 places, and asks where central Paris is:

```
actual:   'Paris 04 Hôtel-de-Ville, France'
expected: 'Paris, France'
```

GeoNames lists Paris's arrondissements as separate places. I "knew" the fix: GeoNames has a feature code for city sections, `PPLX`, so drop those. I regenerated the file and ran the test again. **Same failure.** Only when I printed the actual rows did the data answer back:

```
Paris 04 Hôtel-de-Ville  P PPL  …
Paris                    P PPLC …
```

The arrondissements aren't tagged `PPLX`. They're ordinary `PPL` towns. My fix was right about the taxonomy and wrong about the data. The real fix drops `<City> NN …` rows within 15 km of `<City>`, which I could only write after seeing the rows.

## Why This Matters

Both bugs would have reached Tiger's phone as *absences*: no photo, or a header that reads like a municipal district. Absences don't throw errors. A user notices them eventually, if at all, and can't tell you why.

## The Fourth Directive at Work

"Tests must be meaningful, not contrived." The nine-row fixture was meaningful: it encodes three real Montereys and a Route 66 town, all measured. But it tested *my parser on data I had chosen*. The test that caught the bug tests *the artifact the user actually downloads*. It is the more meaningful test, because a user only ever meets the shipped file.

Likewise the Wikipedia fixtures are **captured responses**, not hand-written JSON shaped like what I expected. Capturing one was what showed `thumb.wikimedia.org`.

## Lessons Learned

1. **Fixture tests check your code; artifact tests check what you ship.** For generated data, keep at least one test that runs against the generated file itself.
2. **Capture, don't compose.** When a test needs an outside API's answer, record a real one. Composing it writes your assumptions into the test.
3. **When a fix fails, print the data before writing the next fix.** The second attempt should come from what the rows say, not from what the documentation implies.
4. **Claims in a question are claims too.** The CSP line in QST-PHOTO-SOURCE was wrong, and it got a written correction in the ADR's Decision rather than a silent fix in the code.

## Metacognitive Insight

Both errors had the same shape: a true general fact (Wikimedia images live on `upload.`; GeoNames marks city sections `PPLX`) applied confidently to a specific case where it didn't hold. Knowledge didn't catch either one. Running the real thing and reading the output did.
