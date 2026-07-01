export enum EncodingType {
  UTF8 = "utf8",
  Base64 = "base64",
}

export async function readAsStringAsync(uri: string, _opts?: { encoding?: EncodingType }): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`readAsStringAsync failed: ${uri} (${res.status})`);
  return res.text();
}
