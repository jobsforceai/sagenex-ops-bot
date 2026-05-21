import 'dotenv/config';
import { runAgent } from '../lib/agent';

const PROMPTS = [
  // Re-run failures
  'How much LP_YIELD has U2801 earned in the last 30 days?',
  'What file defines the LP referral bonus percentage (LP_REFERRAL_BONUS_PCT) in sagenex-backend? Just give the file path and the constant value. Use bash with `rg` to find it.',
  // Higher-pressure realistic ops questions
  'For user U737, list each DIRECT bonus they received with the amount and the sourceUserId from the meta. Last 10.',
  'Which 5 users have the highest packageUSD among those whose isPackageActive is true?',
  'How many SGNX-Gold enrollments are in ACTIVE status?',
  'Show me the most recent 3 PACKAGE_ACTIVATION ledger entries — userId, amount, createdAt.',
];

async function runOne(prompt: string, idx: number) {
  const t0 = Date.now();
  console.log(`\n${'━'.repeat(80)}\n[${idx + 1}] ${prompt}\n${'━'.repeat(80)}`);
  let toolCalls = 0, finalText = '';
  try {
    for await (const ev of runAgent([], prompt)) {
      if (ev.type === 'tool_call') {
        toolCalls++;
        console.log(`  → ${ev.name}  ${JSON.stringify(ev.args).slice(0, 130)}`);
      } else if (ev.type === 'tool_result') {
        const r = JSON.stringify(ev.result).slice(0, 180);
        console.log(`    ${ev.isError ? '✗' : '✓'} ${r}${r.length === 180 ? '…' : ''}`);
      } else if (ev.type === 'text') {
        finalText = ev.text;
      }
    }
  } catch (e: any) { console.log(`  EXCEPTION: ${e?.message}`); }
  const ms = Date.now() - t0;
  console.log(`\n[answer ${ms}ms / ${toolCalls} calls]`);
  console.log(finalText.slice(0, 1400));
  return { prompt, ms, toolCalls };
}

async function main() {
  for (let i = 0; i < PROMPTS.length; i++) await runOne(PROMPTS[i], i);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
