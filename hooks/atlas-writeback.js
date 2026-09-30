#!/usr/bin/env node
const { atlasSettings } = require('./atlas-config');
const { ingest } = require('./atlas-client');
const { projectName } = require('./atlas-session');
const {
  hasWritebackReceipt,
  hookOutput,
  markTurnDecisionSaved,
  readTurnScope,
  readWriteback,
  saveWritebackReceipt,
} = require('./atlas-runtime');

const PRIMARY = /\b(added|built|changed|completed|configured|created|decided|decision|fixed|implemented|migrated|removed|renamed|replaced|resolved|shipped|updated)\b/i;
const VERIFY = /\b(all tests pass|checks? pass(?:ed)?|tests? pass(?:ed)?|verified|validation pass(?:ed)?)\b/i;
const TRANSIENT = /\b(debug(?:ging)?|investigat(?:e|ing)|temporary|workaround|stack trace|still failing|failed|error remains|pending|not completed|not implemented|next step|todo)\b/i;
const FUTURE = /\b(i|we)\s+(?:will|can|could|plan to|intend to)\b/i;
const DECISION = /\b(decid(?:e|ed|ing)|decision|require(?:d|ment)?|constraint|preference|remember|must|need(?:s|ed)?\s+to|should|keep|use|enable|disable|do\s+not|don't|never)\b/i;
const QUESTION = /^(?:what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will)\b/i;
const CODE_LINE = /^\s*(?:[+$>]\s|@@|at\s+\S+\s+\(|(?:const|let|var|function|class|import|export|def)\s|(?:npm|pnpm|yarn|node|python|py|git|cargo|go|dotnet|mvn|gradle|docker|kubectl|curl|Invoke-WebRequest)\s|[{}[\]();])/i;

function redactSensitive(value) {
  return String(value || '')
    .replace(/-----BEGIN[\s\S]*?-----END[^\r\n]*-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:atlas|sk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{12,}\b/gi, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*)('[^']*'|"[^"]*"|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[REDACTED_HEX]')
    .replace(/\b[A-Za-z0-9+/]{48,}={0,2}\b/g, '[REDACTED_BLOB]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, '%USERPROFILE%')
    .replace(/\/home\/[^/\s]+/g, '$HOME');
}

function proseLines(message) {
  const withoutCodeBlocks = String(message || '').replace(/```[\s\S]*?```/g, '');
  return redactSensitive(withoutCodeBlocks)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !CODE_LINE.test(line))
    .map((line) => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`[^`\r\n]{1,160}`/g, '[code omitted]')
      .replace(/\s+/g, ' ')
      .trim());
}

function decisionCandidate(prompt, maxChars = 560) {
  const selected = proseLines(prompt)
    .filter((line) => DECISION.test(line))
    .filter((line) => !QUESTION.test(line) && !line.endsWith('?'))
    .filter((line) => !TRANSIENT.test(line))
    .slice(0, 2)
    .map((line) => line.length > 260 ? `${line.slice(0, 257)}...` : line);
  return selected.join('\n').slice(0, maxChars);
}

function summarize(message, project, maxChars = 1200, userDecision = '') {
  const lines = proseLines(message);
  const primary = lines.filter((line) => PRIMARY.test(line) && !TRANSIENT.test(line) && !FUTURE.test(line));
  const verification = lines.filter((line) => VERIFY.test(line) && !TRANSIENT.test(line));
  const decisions = String(userDecision || '').split(/\r?\n/).filter(Boolean)
    .map((line) => `Decision or requirement: ${line}`);
  if (!decisions.length && !primary.length) return '';
  const selected = [...decisions, ...primary, ...verification]
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 6)
    .map((line) => line.length > 280 ? `${line.slice(0, 277)}...` : line);
  const safeProject = redactSensitive(String(project || 'current project')).slice(0, 120);
  const header = `Project ${safeProject} continuity update:`;
  let result = header;
  for (const line of selected) {
    const candidate = `${result}\n- ${line}`;
    if (candidate.length > maxChars) break;
    result = candidate;
  }
  return result === header ? '' : result;
}

async function run(data, dependencies = {}) {
  const event = data.hook_event_name || 'Stop';
  if (!readWriteback(data.session_id)) return {};
  if (event === 'Stop' && hasWritebackReceipt(data.session_id, data.turn_id)) return {};
  const settings = atlasSettings();
  if (!settings.apiKey) return hookOutput(event, '', 'Atlas writeback skipped: ATLAS_API_KEY is not configured.');
  const project = projectName(data.cwd);
  const turnScope = readTurnScope(data.session_id, data.turn_id);
  if (!turnScope) return {};
  const atlasSessionId = turnScope.atlasSessionId;
  const pendingDecision = turnScope.decisionSaved ? '' : turnScope.decisionSummary;
  const assistantMessage = event === 'Stop' || event === 'SubagentStop' ? data.last_assistant_message : '';
  const summary = summarize(assistantMessage, project, settings.writebackMaxChars, pendingDecision);
  if (!summary) {
    const label = event === 'PreCompact' ? ' before compaction' : event === 'SessionEnd' ? ' at session end' : ' this turn';
    return hookOutput(event, '', `Atlas writeback checked${label}; no durable update was stored.`);
  }
  const write = dependencies.ingest || ingest;
  try {
    await write(summary, {
      sessionId: atlasSessionId,
      persona: turnScope.persona,
      source: 'automatic-writeback',
      metadata: {
        capture: `${event.toLowerCase()}-hook`,
        content_policy: 'durable-decisions-and-completed-changes',
        project,
        atlas_session_id: atlasSessionId,
        codex_session_id: data.session_id || undefined,
        turn_id: data.turn_id || undefined,
      },
    });
    if (pendingDecision) markTurnDecisionSaved(data.session_id, data.turn_id);
    if (event === 'Stop') saveWritebackReceipt(data.session_id, data.turn_id);
    return hookOutput(event, '', `Atlas stored this exact summary:\n${summary}`);
  } catch (cause) {
    const detail = redactSensitive(cause instanceof Error ? cause.message : String(cause)).slice(0, 240);
    return hookOutput(event, '', `Atlas writeback failed; nothing was stored. ${detail}`);
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', async () => {
    let data = {};
    try { data = JSON.parse(input.replace(/^\uFEFF/, '') || '{}'); } catch (_) {}
    let output = {};
    try { output = await run(data); } catch (_) {}
    process.stdout.write(JSON.stringify(output));
  });
}

module.exports = { decisionCandidate, proseLines, redactSensitive, run, summarize };
