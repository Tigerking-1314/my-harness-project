# When the Red Test Is the One That's Wrong

**Date**: 2026-11-12
**Authors**: Tether (Claude Opus 5.5), with Tiger Liu
**Topic**: The first run of the chat harness's test suite failed twice — and both times the code was right and the test was wrong, in two instructive ways.

## The Discovery

The v1 chat harness (ADRs 0001–0003) shipped with 38 `node --test` cases. On the first run, two were red.

**Failure 1 — a remembered constant.** The PKCE test pins `challengeFor()` to the RFC 7636 Appendix B test vector: verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` must hash to a known challenge. I wrote the expected value from memory:

```
- expected: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSuDXtTM'
+ actual:   'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
```

The first 34 characters matched; the tail didn't. SHA-256 doesn't produce near-misses — a bug in the code would scramble the whole string. A shared prefix with a divergent tail is the signature of a *mis-remembered* value, not a mis-computed one. The RFC's real value is the `actual`.

**Failure 2 — asserting on the surface.** The injection test fed `[x](https://ok.example/"onmouseover="alert(1))` to the markdown renderer and asserted the output didn't match `/<a [^>]*onmouseover=/`. It did match — because the renderer had correctly escaped the quotes to `&quot;`, leaving the harmless word `onmouseover=` sitting *inside* the href value. The regex checked for a word; the security property is about *structure* (does an unescaped quote end the attribute?). The fixed test asserts the structural fact: no raw `"onmouseover`, and the whole payload sits inside `href="…"`.

## Why This Matters

Both wrong tests would have pushed toward *breaking working code*. Failure 1 invites "fixing" a correct SHA-256/base64url pipeline until it matches a typo — which would make every real OpenRouter key exchange fail. Failure 2 invites over-escaping or stripping link text until a regex goes quiet, while proving nothing about safety.

## Fourth Directive at Work

"Tests must be meaningful, not contrived" usually reads as a rule against *weak* tests. This was the other edge: a meaningful test is one whose expected value comes from an **authority** (the RFC text, not recall) and whose assertion targets the **property** (attribute boundaries), not a proxy string. The fix in both cases was to make the test *more* faithful to what it claims, not to make it pass.

## Lessons Learned

- **A red test is a claim about two things — the code and the test. Check both before editing either.**
- **Pinned constants (test vectors, hashes, known answers) come from the source, not from memory.** If you can't fetch the source, say so in a comment.
- **The shape of a mismatch is evidence.** Hash outputs don't almost-match; a long shared prefix points at the expectation.
- **Security assertions should test structure, not spelling.** "The dangerous word is absent" is a proxy; "the attacker's text cannot leave the attribute" is the property.

## Metacognitive Insight

The model's fluent recall is exactly where errors hide — a 43-character constant that *looks* right is more dangerous than one I knew I'd have to look up. The useful reflex is: when the test I wrote from memory disagrees with code I derived from a spec, the spec-derived side gets the benefit of the doubt until checked.
