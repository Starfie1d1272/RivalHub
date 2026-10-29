-- rivalhub:migration-risk: forward-compatible Restore the receive-only policy after a new hosted Realtime tenant initializes its managed schema.
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'realtime' AND tablename = 'messages'
        AND policyname = 'rivalhub_match_live_receive'
    ) THEN
    EXECUTE $policy$
      CREATE POLICY rivalhub_match_live_receive ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        extension = 'broadcast'
        AND (select auth.jwt() ->> 'scope') = 'live-viewer'
        AND (select auth.jwt() ->> 'matchId') = substring((select realtime.topic()) from '^match-live:([0-9a-f-]{36})$')
      )
    $policy$;
  END IF;
END $$;
