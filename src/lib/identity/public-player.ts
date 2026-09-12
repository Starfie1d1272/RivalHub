/** The smallest public identity contract shared by player-facing surfaces. */
export interface PublicPlayerIdentity {
  userId: string;
  name: string;
  avatarUrl: string | null;
}
