/**
 * Vigorous test harness — runs the agent against questions the ops team
 * actually asks. Each prompt: time it, log tool calls + final answer.
 */
import 'dotenv/config';
import { runAgent } from '../lib/agent';

const PROMPTS = [
  // Cluster A: schema discovery (forces mongo_list_collections + mongo_find probes)
  'What collections are in the database?',
  'How many users are currently registered?',
  // Cluster B: specific user lookup (uses mongo_find with filter)
  'What is the package amount and ROI plan for user U737?',
  'Look up U13156 — show fullName, packageUSD, roiPlanType, parentId.',
  // Cluster C: ledger / bonus questions — the bread and butter
  'Show me the last 5 DIRECT bonus entries for U737.',
  'How much LP_YIELD has U2801 earned in the last 30 days?',
  // Cluster D: aggregation — the team usually pings about totals
  'What is the total package value of all active users (isPackageActive=true)?',
  // Cluster E: file/code introspection
  'What file defines the LP referral bonus percentage in sagenex-backend? Just give the file path and the constant value.',
];

async function runOne(prompt: string, idx: number) {
  const t0 = Date.now();
  console.log(`\n${'━'.repeat(80)}\n[${idx + 1}] PROMPT: ${prompt}\n${'━'.repeat(80)}`);
  let toolCalls = 0;
  let finalText = '';
  let errored = false;
  try {
    for await (const ev of runAgent([], prompt)) {
      if (ev.type === 'tool_call') {
        toolCalls++;
        const argsStr = JSON.stringify(ev.args).slice(0, 120);
        console.log(`  → tool: ${ev.name}  args=${argsStr}`);
      } else if (ev.type === 'tool_result') {
        const r = JSON.stringify(ev.result).slice(0, 200);
        const tag = ev.isError ? ' (ERROR)' : '';
        console.log(`    result${tag}: ${r}${r.length === 200 ? '…' : ''}`);
      } else if (ev.type === 'text') {
        finalText = ev.text;
      }
    }
  } catch (e: any) {
    errored = true;
    console.log(`  EXCEPTION: ${e?.message}`);
  }
  const ms = Date.now() - t0;
  console.log(`\nFINAL ANSWER (${ms} ms, ${toolCalls} tool calls):`);
  console.log(finalText.slice(0, 1500));
  return { prompt, ms, toolCalls, errored, finalText };
}

async function main() {
  const results: any[] = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    results.push(await runOne(PROMPTS[i], i));
  }
  console.log(`\n\n${'═'.repeat(80)}\nSUMMARY\n${'═'.repeat(80)}`);
  console.log('idx  ms      tools  errored  prompt');
  console.log('─'.repeat(80));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const err = r.errored ? 'YES' : ' no';
    console.log(`${String(i + 1).padStart(3)}  ${String(r.ms).padStart(6)}  ${String(r.toolCalls).padStart(5)}  ${err}      ${r.prompt.slice(0, 60)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
