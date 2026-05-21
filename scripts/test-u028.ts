import 'dotenv/config';
import { runAgent } from '../lib/agent';

const PROMPTS = [
  "what's the multiplier of U028 ?",
  "what's the team business of U028 ?",
  "what's the team business of U028 last 10 days ?",
];

async function runOne(prompt: string, i: number) {
  const t0 = Date.now();
  console.log(`\n━━━━━ [${i+1}] ${prompt} ━━━━━`);
  let tools = 0, finalText = '';
  for await (const ev of runAgent([], prompt)) {
    if (ev.type === 'tool_call') {
      tools++;
      console.log(`  → ${ev.name}  ${JSON.stringify(ev.args).slice(0,140)}`);
    } else if (ev.type === 'tool_result') {
      console.log(`    ${ev.isError ? '✗' : '✓'} ${JSON.stringify(ev.result).slice(0,200)}`);
    } else if (ev.type === 'text') finalText = ev.text;
  }
  console.log(`\n[${Date.now()-t0}ms / ${tools} tools]`);
  console.log(finalText.slice(0, 1200));
  if (tools === 0) console.log('\n❌❌❌ NO TOOL CALL — STILL HALLUCINATING');
}
async function main() { for (let i = 0; i < PROMPTS.length; i++) await runOne(PROMPTS[i], i); }
main().then(() => process.exit(0));
