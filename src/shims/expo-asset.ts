/** Stub for amfiSchemeMap.web.ts — CSV is loaded via fetch, not expo-asset. */
export class Asset {
  localUri: string | null = null;

  static fromModule(_mod: unknown): Asset {
    const a = new Asset();
    a.localUri = "/unique_schemes.csv";
    return a;
  }

  async downloadAsync(): Promise<void> {}
}
