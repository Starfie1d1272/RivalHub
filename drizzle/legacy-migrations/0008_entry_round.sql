ALTER TABLE matches ADD COLUMN entry_round text;

ALTER TABLE matches ADD CONSTRAINT matches_entry_round_check
  CHECK (entry_round IN ('round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final', 'third_place'));
