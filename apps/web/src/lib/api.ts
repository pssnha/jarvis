export async function getHealth(): Promise<unknown> {
  const res = await fetch('/api/healthz');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
