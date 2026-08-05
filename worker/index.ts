import { jobs } from "@/server/jobs";

/**
 * A single-process scheduler. Every job is idempotent and safe to run in
 * parallel with other workers, so scaling out means starting another container.
 */
async function runJob(job: (typeof jobs)[number]) {
  const startedAt = Date.now();
  try {
    await job.run();
  } catch (error) {
    console.error(`[worker] ${job.name} failed`, error);
    return;
  }
  const duration = Date.now() - startedAt;
  if (duration > 1000) console.log(`[worker] ${job.name} finished in ${duration}ms`);
}

async function main() {
  console.log(`Fluid Chat worker started with ${jobs.length} jobs`);
  await Promise.all(jobs.map(runJob));

  for (const job of jobs) {
    setInterval(() => {
      void runJob(job);
    }, job.intervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
