// `cloudflare:workers` only exists inside the Workers runtime. Under Node the OAuth library needs just this class, to
// tell a handler object from a WorkerEntrypoint subclass. The real module is exercised by the workerd smoke test
// (wrangler dev), not by these unit tests.
export class WorkerEntrypoint<Env = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: Env,
  ) {}
}
