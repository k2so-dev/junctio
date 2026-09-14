import type { JwtClaims, JwtVerifier } from "../middleware.ts";
import type { JunctioOAuthProvider } from "./provider.ts";

export class LocalTokenVerifier implements JwtVerifier {
  constructor(private readonly provider: JunctioOAuthProvider) {}

  async verify(token: string, audience: string): Promise<JwtClaims> {
    const info = await this.provider.verifyAccessToken(token);
    if (info.resource && info.resource.href !== audience) {
      throw new Error("token was issued for another endpoint");
    }
    return { subject: info.clientId, scopes: info.scopes, clientId: info.clientId };
  }
}
