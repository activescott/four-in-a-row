// Fails if a Prisma CLI call in a workflow, the Dockerfile or a package.json
// script runs without CHECKPOINT_DISABLE set (the CLI would call
// checkpoint.prisma.io). Static: it reads the files, it does not run Prisma.
// check-no-checkpoint.mjs is the runtime check that the config file alone works.
import { readFileSync, readdirSync } from "node:fs";

const CALL =
  /\b(npx prisma|npm run prisma|prisma (generate|migrate|validate|version|db|studio|format|init|debug))\b/;
const problems = [];

// Workflows: CHECKPOINT_DISABLE must appear at workflow, job or step level.
for (const f of readdirSync(".github/workflows")) {
  const path = `.github/workflows/${f}`;
  const text = readFileSync(path, "utf8");
  const [header, jobsPart = ""] = text.split(/^jobs:\s*$/m);
  if (/^ {2}CHECKPOINT_DISABLE:/m.test(header) && /^env:/m.test(header)) {
    // Workflow-level env covers everything.
    if (/^env:\s*\n(?:\s+.*\n)*?\s+CHECKPOINT_DISABLE:/m.test(header)) continue;
  }
  for (const job of jobsPart.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1)) {
    const name = job.split(":")[0];
    const [jobHead] = job.split(/^ {4}steps:/m);
    const jobCovered = /CHECKPOINT_DISABLE/.test(jobHead);
    for (let step of job.split(/^ {6}- /m).slice(1)) {
      step = step.replace(/^\s*#.*$/gm, ""); // comments may mention the variable
      const line = step
        .split("\n")
        .find((l) => !/^\s*#/.test(l) && CALL.test(l));
      if (line && !jobCovered && !/CHECKPOINT_DISABLE/.test(step))
        problems.push(`${path}: job ${name}: \`${line.trim()}\``);
    }
  }
}

// Dockerfile: an ENV before the call, in the same stage or an earlier stage it builds FROM.
const stages = new Map(); // name -> { parent, env: bool }
let cur = null;
let envSet = false;
readFileSync("Dockerfile", "utf8")
  .split(/\n(?=\S)/)
  .forEach((ins) => {
    const from = ins.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      cur = {
        name: from[2] ?? from[1],
        env: stages.get(from[1])?.env ?? false,
      };
      stages.set(cur.name, cur);
    }
    if (!cur) return;
    if (/^ENV\b[\s\S]*\bCHECKPOINT_DISABLE[=\s]/.test(ins)) cur.env = true;
    const line = ins
      .split("\n")
      .find((l) => CALL.test(l) || /ENTRYPOINT.*prisma/.test(l));
    if (!from && line && !cur.env)
      problems.push(`Dockerfile: stage ${cur.name}: \`${line.trim()}\``);
  });

// package.json scripts that call prisma directly (not via `npm run prisma`).
const { scripts = {} } = JSON.parse(readFileSync("package.json", "utf8"));
for (const [k, v] of Object.entries(scripts)) {
  const direct = /(^|[\s;&|])(npx )?prisma\b/.test(v);
  if (direct && !/CHECKPOINT_DISABLE=1/.test(v))
    problems.push(`package.json: script ${k}: \`${v}\``);
}

if (problems.length) {
  console.error("FAIL: Prisma CLI calls without CHECKPOINT_DISABLE set:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("ok: every Prisma CLI call has CHECKPOINT_DISABLE set");
