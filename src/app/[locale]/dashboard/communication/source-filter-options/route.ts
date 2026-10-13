import { getWorklistFacetsAction } from '@/features/school/source-worklist/facets-action';

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  let input: Parameters<typeof getWorklistFacetsAction>[0];
  try { input = await request.json(); }
  catch { return Response.json({ ok: false, code: 'VALIDATION' }, { status: 400, headers }); }
  return Response.json(await getWorklistFacetsAction(input), { headers });
}
