// Tool-use plumbing between OpenRouter and the road-trip memory (ADR-0004).
// Pure functions, tested in tests/tools.test.js.

// Tools that only READ may run without asking. Everything else — including
// any tool the server adds later — needs Tiger's click (QST-SAVE-OK = B).
// Default-deny on purpose: a new write tool must never slip through ungated.
export const READ_ONLY_TOOLS = new Set(['list_favorites']);
export const needsConfirmation = (name) => !READ_ONLY_TOOLS.has(name);

export const MAX_TOOL_ROUNDS = 6;

// A copy of Tiger's rules from ~/roadtrip-memory/.claude/skills/my-ways/SKILL.md
// (the page can't read that file). Keep the two in step. Adapted in one way:
// the page itself shows a Save button for every save, so the model proposes
// via the tool call instead of asking in words AND then by button.
export const ROADTRIP_PROMPT = `You are Tiger's road-trip travel assistant. You can use Tiger's road-trip memory: list_favorites (read the places Tiger loved) and save_favorite (save a new one).

When to save — only when BOTH are true:
1. We're talking about travel or a road trip (one Tiger is on, took, or is planning).
2. Tiger clearly says they like a place or want to go back. "Save it" or "remember it" counts.
If a place comes up in any other context (work, school, the news, where someone grew up, a class assignment), save nothing and don't offer to.
When unsure whether Tiger likes it or whether it's travel, ask in words first and don't call save_favorite.

How to save:
1. Call list_favorites first. If the place is already there, tell Tiger and ask whether to add another entry instead of saving.
2. Call save_favorite with the place and a reason in Tiger's own words, trimmed to one line. Never invent reasons Tiger didn't give.
3. The app shows Tiger a Save / Don't save button for every save — that IS asking for the OK, so don't also ask in text. If the result says it was not approved, accept that and don't retry unless Tiger asks.
4. After a save, a one-line confirmation is enough.

Reading favorites:
- When Tiger asks where to stop, plans a route, or asks what they liked near somewhere, call list_favorites before suggesting anything new, and build the route around those favorites where it makes sense.
- Otherwise, don't list favorites unless asked.`;

/** MCP tool descriptions → OpenAI/OpenRouter `tools` entries. */
export function toOpenAITools(mcpTools) {
  return (mcpTools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

/** Fold one streamed tool-call fragment into the list being built (in place). */
export function accumulateToolCall(calls, ev) {
  const i = ev.index ?? 0;
  const call = (calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
  if (ev.id) call.id = ev.id;
  if (ev.name) {
    // most providers send the name once; some repeat it whole in every chunk
    const cur = call.function.name;
    call.function.name = !cur || cur === ev.name ? ev.name : cur + ev.name;
  }
  if (ev.arguments) call.function.arguments += ev.arguments;
  return calls;
}

/** Drop holes, give every call an id (the API pairs results to calls by id). */
export function finalizeToolCalls(calls) {
  return calls
    .map((c, i) => c && { ...c, id: c.id || `call_${i}` })
    .filter((c) => c && c.function.name);
}

/** Tool-call arguments → object, or null if they aren't a JSON object. */
export function parseArgs(text) {
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Stored conversation → messages the API accepts.
 * The API rejects an assistant tool call that has no matching tool result —
 * which is exactly what's left behind if the page is reloaded while a Save
 * card is waiting. So unanswered calls (and results without a call) are
 * dropped, and local-only fields (display, name, model, usage) stripped.
 */
export function historyForApi(messages) {
  const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
  const issued = new Set();
  const out = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user') {
      if (content.trim()) out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).filter((c) => answered.has(c.id));
      if (calls.length) {
        out.push({ role: 'assistant', content, tool_calls: calls });
        for (const c of calls) issued.add(c.id);
      } else if (content.trim()) {
        out.push({ role: 'assistant', content });
      }
    } else if (m.role === 'tool' && issued.has(m.tool_call_id)) {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content });
    }
  }
  return out;
}
