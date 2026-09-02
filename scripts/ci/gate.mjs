const requiredJobs = parseRequiredJobs(process.env.REQUIRED_JOBS);
const statuses = {
  plan: process.env.PLAN_RESULT,
  static: process.env.STATIC_RESULT,
  postgres: process.env.POSTGRES_RESULT,
  system: process.env.SYSTEM_RESULT,
};

if (statuses.plan !== "success") {
  fail(`plan 未成功：${statuses.plan ?? "missing"}`);
}

for (const job of ["static", "postgres", "system"]) {
  const status = statuses[job];
  if (requiredJobs.includes(job)) {
    if (status !== "success") fail(`required job ${job} 未成功：${status ?? "missing"}`);
    console.log(`required ${job}: success`);
  } else if (status !== "skipped" && status !== "success") {
    fail(`非 required job ${job} 出现异常状态：${status ?? "missing"}`);
  } else {
    console.log(`optional ${job}: ${status}`);
  }
}

console.log(`ci-gate passed: required jobs = ${requiredJobs.join(",") || "none"}`);

function parseRequiredJobs(raw) {
  if (!raw) fail("plan 没有输出 required_jobs");
  try {
    const jobs = JSON.parse(raw);
    if (!Array.isArray(jobs) || jobs.some((job) => !["static", "postgres", "system"].includes(job))) {
      throw new Error("invalid job list");
    }
    return jobs;
  } catch {
    fail(`required_jobs 不是有效 capability 列表：${raw}`);
  }
}

function fail(message) {
  console.error(`ci-gate failed: ${message}`);
  process.exit(1);
}
