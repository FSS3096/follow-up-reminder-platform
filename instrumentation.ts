/**
 * Next.js calls register() once when the server starts.
 * Loading the env here makes a misconfigured deployment refuse to boot
 * instead of failing on the first request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getServerEnv, EnvError } = await import('./lib/env');
  try {
    getServerEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      // Variable names and rule messages only; values are never printed.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
